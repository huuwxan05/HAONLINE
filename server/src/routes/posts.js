import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import {
  canViewPost, visibilityClause, isBlocked, isGroupMember, groupRole, pageRole,
  notify, track, publicUser,
} from '../lib/social.js';

const router = Router();

const REACTIONS = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];

function mentionNotify(text, actorId, targetType, targetId, actorName) {
  const names = [...new Set((text.match(/@([a-z0-9._]{3,32})/gi) || []).map((m) => m.slice(1).toLowerCase()))];
  for (const name of names.slice(0, 10)) {
    const user = get("SELECT id FROM users WHERE username = ? AND status = 'active'", name);
    if (user && user.id !== actorId) {
      notify({ userId: user.id, kind: 'mention', actorId, targetType, targetId, data: { by: actorName } });
    }
  }
}

function mediaFromInput(input) {
  if (!input) return [];
  if (!Array.isArray(input)) throw badRequest('media phải là mảng');
  if (input.length > 10) throw badRequest('Tối đa 10 tệp mỗi bài viết');
  return input.map((item, index) => {
    const url = v.str(item.url, { field: 'media.url', max: 1000 });
    if (!/^\/uploads\/[\w.\-/]+$/.test(url) && !/^https?:\/\//.test(url)) throw badRequest('URL media không hợp lệ');
    const kind = v.oneOf(item.kind, ['image', 'video', 'audio', 'file'], 'media.kind', 'image');
    return {
      kind,
      url,
      thumb_url: item.thumb_url ? v.str(item.thumb_url, { field: 'thumb_url', max: 1000 }) : null,
      width: v.int(item.width, { fallback: null }),
      height: v.int(item.height, { fallback: null }),
      duration: item.duration ? Number(item.duration) : null,
      position: index,
    };
  });
}

function loadPosts(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const media = all(`SELECT * FROM post_media WHERE post_id IN (${marks}) ORDER BY position`, ...ids);
  const reactionRows = all(
    `SELECT target_id, kind, COUNT(*) AS c FROM reactions WHERE target_type = 'post' AND target_id IN (${marks}) GROUP BY target_id, kind`,
    ...ids,
  );
  const mine = viewerId
    ? all(`SELECT target_id, kind FROM reactions WHERE user_id = ? AND target_type = 'post' AND target_id IN (${marks})`, viewerId, ...ids)
    : [];
  const commentCounts = all(
    `SELECT post_id, COUNT(*) AS c FROM comments WHERE deleted_at IS NULL AND post_id IN (${marks}) GROUP BY post_id`, ...ids,
  );
  const shareCounts = all(`SELECT post_id, COUNT(*) AS c FROM shares WHERE post_id IN (${marks}) GROUP BY post_id`, ...ids);
  const bookmarked = viewerId
    ? new Set(all(`SELECT target_id FROM bookmarks WHERE user_id = ? AND target_type = 'post' AND target_id IN (${marks})`, viewerId, ...ids).map((r) => r.target_id))
    : new Set();
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authors = new Map(all(`SELECT * FROM users WHERE id IN (${authorIds.map(() => '?').join(',')})`, ...authorIds).map((u) => [u.id, u]));
  const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))];
  const pageIds = [...new Set(rows.map((r) => r.page_id).filter(Boolean))];
  const groups = new Map(groupIds.length ? all(`SELECT id, name, slug, privacy FROM groups WHERE id IN (${groupIds.map(() => '?').join(',')})`, ...groupIds).map((g) => [g.id, g]) : []);
  const pages = new Map(pageIds.length ? all(`SELECT id, name, slug, avatar_url FROM pages WHERE id IN (${pageIds.map(() => '?').join(',')})`, ...pageIds).map((p) => [p.id, p]) : []);
  const sharedIds = [...new Set(rows.map((r) => r.shared_post_id).filter(Boolean))];
  let sharedMap = new Map();
  if (sharedIds.length) {
    const sharedRows = all(
      `SELECT p.*, u.username, u.display_name, u.avatar_url FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.id IN (${sharedIds.map(() => '?').join(',')}) AND p.deleted_at IS NULL`, ...sharedIds,
    );
    const sharedMedia = all(`SELECT * FROM post_media WHERE post_id IN (${sharedIds.map(() => '?').join(',')}) ORDER BY position`, ...sharedIds);
    sharedMap = new Map(sharedRows.map((p) => [p.id, {
      id: p.id,
      body: p.body,
      visibility: p.visibility,
      created_at: p.created_at,
      author: { ...publicUser(p), id: p.author_id },
      media: sharedMedia.filter((m) => m.post_id === p.id),
    }]));
  }

  return rows.map((row) => {
    const counts = {};
    for (const r of reactionRows) {
      if (r.target_id === row.id) counts[r.kind] = r.c;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      id: row.id,
      body: row.body,
      visibility: row.visibility,
      feeling: row.feeling,
      location: row.location,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: publicUser(authors.get(row.author_id) || { id: row.author_id }),
      media: media.filter((m) => m.post_id === row.id),
      reactions: {
        counts,
        total,
        mine: mine.find((r) => r.target_id === row.id)?.kind || null,
      },
      comments_count: commentCounts.find((c) => c.post_id === row.id)?.c || 0,
      shares_count: shareCounts.find((s) => s.post_id === row.id)?.c || 0,
      bookmarked: bookmarked.has(row.id),
      group: row.group_id ? groups.get(row.group_id) || null : null,
      page: row.page_id ? pages.get(row.page_id) || null : null,
      shared_post: row.shared_post_id ? sharedMap.get(row.shared_post_id) || null : null,
    };
  });
}

function fetchPostRow(postId) {
  return get(
    `SELECT p.*, u.username, u.display_name, u.avatar_url FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
    postId,
  );
}

router.get('/feed', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const vis = visibilityClause(viewerId, 'p');
  const clauses = ['p.deleted_at IS NULL', "p.status = 'active'", vis.sql];
  const params = [...vis.params];
  if (req.query.author) {
    clauses.push('p.author_id = ?');
    params.push(String(req.query.author));
  }
  if (req.query.group_id) {
    clauses.push('p.group_id = ?');
    params.push(String(req.query.group_id));
  }
  if (req.query.page_id) {
    clauses.push('p.page_id = ?');
    params.push(String(req.query.page_id));
  }
  if (req.query.scope === 'friends' && viewerId) {
    clauses.push(`p.author_id IN (SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?))`);
    params.push(viewerId, viewerId, viewerId);
  }
  if (req.query.scope === 'following' && viewerId) {
    clauses.push(`(p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR p.author_id = ?)`);
    params.push(viewerId, viewerId);
  }
  if (req.query.q) {
    clauses.push('p.body LIKE ?');
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
  }
  const rows = all(
    `SELECT p.* FROM posts p WHERE ${clauses.join(' AND ')} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const total = get(`SELECT COUNT(*) AS c FROM posts p WHERE ${clauses.join(' AND ')}`, ...params).c;
  ok(res, { items: loadPosts(rows, viewerId), total, limit, offset });
}));

router.post('/posts', requireAuth, wrap(async (req, res) => {
  const body = v.str(req.body.body, { field: 'Nội dung', max: 20000, required: false });
  const media = mediaFromInput(req.body.media);
  if (!body && media.length === 0 && !req.body.shared_post_id) throw badRequest('Bài viết cần nội dung hoặc media');
  const visibility = v.oneOf(req.body.visibility, ['public', 'friends', 'private'], 'visibility', 'public');
  const groupId = req.body.group_id ? String(req.body.group_id) : null;
  const pageId = req.body.page_id ? String(req.body.page_id) : null;
  if (groupId && pageId) throw badRequest('Bài viết chỉ thuộc nhóm hoặc trang');
  if (groupId) {
    const group = get('SELECT * FROM groups WHERE id = ?', groupId);
    if (!group) throw notFound('Không tìm thấy nhóm');
    if (!isGroupMember(groupId, req.user.user_id)) throw forbidden('Bạn cần tham gia nhóm để đăng bài');
  }
  if (pageId) {
    const role = pageRole(pageId, req.user.user_id);
    if (!role) throw forbidden('Bạn không có quyền đăng bài trên trang này');
  }
  let sharedPostId = null;
  if (req.body.shared_post_id) {
    const original = fetchPostRow(String(req.body.shared_post_id));
    if (!original || !canViewPost(original, req.user.user_id)) throw notFound('Không tìm thấy bài viết được chia sẻ');
    sharedPostId = original.id;
  }
  const postId = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO posts (id, author_id, page_id, group_id, body, visibility, feeling, location, shared_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    postId, req.user.user_id, pageId, groupId, body, visibility,
    v.optionalStr(req.body.feeling, { field: 'Cảm xúc', max: 60 }),
    v.optionalStr(req.body.location, { field: 'Vị trí', max: 200 }),
    sharedPostId, ts, ts,
  );
  const insertMedia = db.prepare(
    'INSERT INTO post_media (id, post_id, kind, url, thumb_url, width, height, duration, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const m of media) insertMedia.run(crypto.randomUUID(), postId, m.kind, m.url, m.thumb_url, m.width, m.height, m.duration, m.position);
  if (sharedPostId) {
    db.prepare('INSERT INTO shares (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), sharedPostId, req.user.user_id, body, ts);
    const original = fetchPostRow(sharedPostId);
    notify({ userId: original.author_id, kind: 'share', actorId: req.user.user_id, targetType: 'post', targetId: sharedPostId });
  }
  if (groupId) {
    const members = all("SELECT user_id FROM group_members WHERE group_id = ? AND status = 'active' AND user_id != ?", groupId, req.user.user_id);
    const group = get('SELECT name FROM groups WHERE id = ?', groupId);
    for (const m of members.slice(0, 200)) {
      notify({ userId: m.user_id, kind: 'group_post', actorId: req.user.user_id, targetType: 'group', targetId: groupId, data: { group: group?.name } });
    }
  }
  if (pageId) {
    const followers = all('SELECT user_id FROM page_followers WHERE page_id = ? AND user_id != ?', pageId, req.user.user_id);
    for (const f of followers.slice(0, 200)) {
      notify({ userId: f.user_id, kind: 'page_post', actorId: req.user.user_id, targetType: 'page', targetId: pageId });
    }
  }
  mentionNotify(body, req.user.user_id, 'post', postId, req.user.username);
  track(req.user.user_id, 'post_create', 'post', postId, { visibility, group_id: groupId, page_id: pageId });
  created(res, { post: loadPosts([fetchPostRow(postId)], req.user.user_id)[0] });
}));

router.get('/posts/:id', wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || !canViewPost(row, req.user?.user_id || null)) throw notFound('Không tìm thấy bài viết');
  track(req.user?.user_id || null, 'post_view', 'post', row.id);
  ok(res, { post: loadPosts([row], req.user?.user_id || null)[0] });
}));

router.patch('/posts/:id', requireAuth, wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || row.deleted_at) throw notFound('Không tìm thấy bài viết');
  const isAuthor = row.author_id === req.user.user_id;
  const canModerate = req.user.role === 'admin' || req.user.role === 'moderator'
    || (row.group_id && ['owner', 'admin', 'moderator'].includes(groupRole(row.group_id, req.user.user_id)))
    || (row.page_id && ['owner', 'admin'].includes(pageRole(row.page_id, req.user.user_id)));
  if (!isAuthor && !canModerate) throw forbidden('Bạn không thể sửa bài viết này');
  const fields = [];
  const params = [];
  if (req.body.body !== undefined) { fields.push('body = ?'); params.push(v.str(req.body.body, { field: 'Nội dung', max: 20000, required: false })); }
  if (req.body.visibility !== undefined) { fields.push('visibility = ?'); params.push(v.oneOf(req.body.visibility, ['public', 'friends', 'private'], 'visibility')); }
  if (req.body.feeling !== undefined) { fields.push('feeling = ?'); params.push(v.optionalStr(req.body.feeling, { field: 'Cảm xúc', max: 60 })); }
  if (req.body.location !== undefined) { fields.push('location = ?'); params.push(v.optionalStr(req.body.location, { field: 'Vị trí', max: 200 })); }
  if (req.body.media !== undefined) {
    const media = mediaFromInput(req.body.media);
    db.prepare('DELETE FROM post_media WHERE post_id = ?').run(row.id);
    const insert = db.prepare('INSERT INTO post_media (id, post_id, kind, url, thumb_url, width, height, duration, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const m of media) insert.run(crypto.randomUUID(), row.id, m.kind, m.url, m.thumb_url, m.width, m.height, m.duration, m.position);
  }
  if (!fields.length) return ok(res, { post: loadPosts([row], req.user.user_id)[0] });
  fields.push('updated_at = ?');
  params.push(now(), row.id);
  db.prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  ok(res, { post: loadPosts([fetchPostRow(row.id)], req.user.user_id)[0] });
}));

router.delete('/posts/:id', requireAuth, wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || row.deleted_at) throw notFound('Không tìm thấy bài viết');
  const isAuthor = row.author_id === req.user.user_id;
  const canModerate = ['admin', 'moderator'].includes(req.user.role)
    || (row.group_id && ['owner', 'admin', 'moderator'].includes(groupRole(row.group_id, req.user.user_id)));
  if (!isAuthor && !canModerate) throw forbidden('Bạn không thể xóa bài viết này');
  db.prepare("UPDATE posts SET deleted_at = ?, status = 'removed', updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  track(req.user.user_id, 'post_delete', 'post', row.id);
  noContent(res);
}));

router.post('/posts/:id/react', requireAuth, wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || !canViewPost(row, req.user.user_id)) throw notFound('Không tìm thấy bài viết');
  const kind = v.oneOf(req.body.kind || req.body.reaction, REACTIONS, 'reaction');
  const existing = get("SELECT * FROM reactions WHERE user_id = ? AND target_type = 'post' AND target_id = ?", req.user.user_id, row.id);
  if (existing && existing.kind === kind) {
    db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    return ok(res, { reaction: null });
  }
  if (existing) {
    db.prepare('UPDATE reactions SET kind = ?, created_at = ? WHERE id = ?').run(kind, now(), existing.id);
  } else {
    db.prepare('INSERT INTO reactions (id, user_id, target_type, target_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), req.user.user_id, 'post', row.id, kind, now());
  }
  notify({ userId: row.author_id, kind: 'reaction', actorId: req.user.user_id, targetType: 'post', targetId: row.id, data: { reaction: kind } });
  track(req.user.user_id, 'reaction', 'post', row.id, { kind });
  ok(res, { reaction: kind });
}));

router.post('/reactions', requireAuth, wrap(async (req, res) => {
  const targetType = v.oneOf(req.body.target_type, ['post', 'comment', 'reel', 'video', 'live', 'product'], 'target_type');
  const targetId = v.str(req.body.target_id, { field: 'target_id', min: 1, max: 64 });
  const kind = v.oneOf(req.body.kind, REACTIONS, 'kind');
  const table = { post: 'posts', comment: 'comments', reel: 'reels', video: 'videos', live: 'live_streams', product: 'products' }[targetType];
  const exists = get(`SELECT 1 AS x FROM ${table} WHERE id = ?`, targetId);
  if (!exists) throw notFound('Không tìm thấy nội dung');
  let ownerId = null;
  if (targetType === 'post') {
    const post = fetchPostRow(targetId);
    if (!canViewPost(post, req.user.user_id)) throw forbidden('Không thể tương tác');
    ownerId = post.author_id;
  } else if (targetType === 'comment') {
    ownerId = get('SELECT author_id FROM comments WHERE id = ?', targetId)?.author_id;
  } else if (targetType === 'reel') ownerId = get('SELECT author_id FROM reels WHERE id = ?', targetId)?.author_id;
  else if (targetType === 'video') ownerId = get('SELECT owner_id FROM videos WHERE id = ?', targetId)?.owner_id;
  else if (targetType === 'live') ownerId = get('SELECT host_id FROM live_streams WHERE id = ?', targetId)?.host_id;
  else if (targetType === 'product') ownerId = get('SELECT seller_id FROM products WHERE id = ?', targetId)?.seller_id;
  const existing = get('SELECT * FROM reactions WHERE user_id = ? AND target_type = ? AND target_id = ?', req.user.user_id, targetType, targetId);
  if (existing && existing.kind === kind) {
    db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    return ok(res, { reaction: null });
  }
  if (existing) db.prepare('UPDATE reactions SET kind = ? WHERE id = ?').run(kind, existing.id);
  else db.prepare('INSERT INTO reactions (id, user_id, target_type, target_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.user_id, targetType, targetId, kind, now());
  if (ownerId) notify({ userId: ownerId, kind: 'reaction', actorId: req.user.user_id, targetType, targetId, data: { reaction: kind } });
  ok(res, { reaction: kind });
}));

router.get('/posts/:id/comments', wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || !canViewPost(row, req.user?.user_id || null)) throw notFound('Không tìm thấy bài viết');
  const { limit, offset } = pagination(req.query);
  const parentId = req.query.parent_id ? String(req.query.parent_id) : null;
  const clauses = ['c.post_id = ?', 'c.deleted_at IS NULL'];
  const params = [row.id];
  if (parentId) { clauses.push('c.parent_id = ?'); params.push(parentId); }
  else clauses.push('c.parent_id IS NULL');
  const rows = all(
    `SELECT c.*, u.username, u.display_name, u.avatar_url FROM comments c JOIN users u ON u.id = c.author_id
     WHERE ${clauses.join(' AND ')} ORDER BY c.created_at ASC LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  const ids = rows.map((r) => r.id);
  const reactionCounts = ids.length ? all(
    `SELECT target_id, kind, COUNT(*) AS c FROM reactions WHERE target_type = 'comment' AND target_id IN (${ids.map(() => '?').join(',')}) GROUP BY target_id, kind`,
    ...ids,
  ) : [];
  const mine = ids.length && req.user ? all(
    `SELECT target_id, kind FROM reactions WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${ids.map(() => '?').join(',')})`,
    req.user.user_id, ...ids,
  ) : [];
  const replyCounts = ids.length ? all(
    `SELECT parent_id, COUNT(*) AS c FROM comments WHERE deleted_at IS NULL AND parent_id IN (${ids.map(() => '?').join(',')}) GROUP BY parent_id`,
    ...ids,
  ) : [];
  ok(res, {
    items: rows.map((c) => {
      const counts = {};
      for (const r of reactionCounts) if (r.target_id === c.id) counts[r.kind] = r.c;
      return {
        id: c.id,
        post_id: c.post_id,
        parent_id: c.parent_id,
        body: c.body,
        created_at: c.created_at,
        author: { ...publicUser(c), id: c.author_id },
        reactions: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), mine: mine.find((r) => r.target_id === c.id)?.kind || null },
        replies_count: replyCounts.find((r) => r.parent_id === c.id)?.c || 0,
      };
    }),
    total: get(`SELECT COUNT(*) AS c FROM comments c WHERE ${clauses.join(' AND ')}`, ...params).c,
    limit, offset,
  });
}));

router.post('/posts/:id/comments', requireAuth, wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || !canViewPost(row, req.user.user_id)) throw notFound('Không tìm thấy bài viết');
  const body = v.str(req.body.body, { field: 'Bình luận', min: 1, max: 5000 });
  const parentId = req.body.parent_id ? String(req.body.parent_id) : null;
  if (parentId) {
    const parent = get('SELECT * FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL', parentId, row.id);
    if (!parent) throw notFound('Không tìm thấy bình luận gốc');
  }
  const commentId = crypto.randomUUID();
  db.prepare('INSERT INTO comments (id, post_id, author_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(commentId, row.id, req.user.user_id, parentId, body, now());
  notify({ userId: row.author_id, kind: 'comment', actorId: req.user.user_id, targetType: 'post', targetId: row.id, data: { comment_id: commentId } });
  if (parentId) {
    const parent = get('SELECT author_id FROM comments WHERE id = ?', parentId);
    if (parent) notify({ userId: parent.author_id, kind: 'reply', actorId: req.user.user_id, targetType: 'comment', targetId: commentId });
  }
  mentionNotify(body, req.user.user_id, 'comment', commentId, req.user.username);
  track(req.user.user_id, 'comment_create', 'post', row.id);
  const c = get('SELECT c.*, u.username, u.display_name, u.avatar_url FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?', commentId);
  created(res, { comment: { id: c.id, post_id: c.post_id, parent_id: c.parent_id, body: c.body, created_at: c.created_at, author: { ...publicUser(c), id: c.author_id }, reactions: { counts: {}, total: 0, mine: null }, replies_count: 0 } });
}));

router.delete('/comments/:id', requireAuth, wrap(async (req, res) => {
  const comment = get('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!comment) throw notFound('Không tìm thấy bình luận');
  const post = fetchPostRow(comment.post_id);
  const can = comment.author_id === req.user.user_id || ['admin', 'moderator'].includes(req.user.role)
    || (post.group_id && ['owner', 'admin', 'moderator'].includes(groupRole(post.group_id, req.user.user_id)));
  if (!can) throw forbidden('Bạn không thể xóa bình luận này');
  db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(now(), comment.id);
  noContent(res);
}));

router.post('/posts/:id/share', requireAuth, wrap(async (req, res) => {
  const row = fetchPostRow(req.params.id);
  if (!row || !canViewPost(row, req.user.user_id)) throw notFound('Không tìm thấy bài viết');
  const body = v.str(req.body.body, { field: 'Nội dung', max: 20000, required: false });
  const visibility = v.oneOf(req.body.visibility, ['public', 'friends', 'private'], 'visibility', 'public');
  const postId = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO posts (id, author_id, body, visibility, shared_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(postId, req.user.user_id, body, visibility, row.id, ts, ts);
  db.prepare('INSERT INTO shares (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), row.id, req.user.user_id, body, ts);
  notify({ userId: row.author_id, kind: 'share', actorId: req.user.user_id, targetType: 'post', targetId: row.id });
  track(req.user.user_id, 'share', 'post', row.id);
  created(res, { post: loadPosts([fetchPostRow(postId)], req.user.user_id)[0] });
}));

router.get('/feed/sponsored', wrap(async (req, res) => {
  const ads = all(
    `SELECT * FROM ad_campaigns WHERE status = 'active' AND budget_cents > spent_cents
     AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
     ORDER BY RANDOM() LIMIT 1`, now(), now(),
  );
  ok(res, { items: ads.map((a) => ({ id: a.id, name: a.name, text: a.creative_text, url: a.creative_url, advertiser_id: a.advertiser_id })) });
}));

export default router;
export { loadPosts, fetchPostRow, REACTIONS, mentionNotify, mediaFromInput };
