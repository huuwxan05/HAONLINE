import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { saveUpload, mediaLimits } from '../lib/media.js';
import { requireFeature } from '../lib/features.js';
import { isBlocked, areFriends, friendIds, followIds, notify, track, publicUser } from '../lib/social.js';
import { sendTo, sendToMany } from '../lib/realtime.js';
import { REACTIONS } from './posts.js';

const router = Router();

function decorateTargets(rows, targetType, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const counts = all(
    `SELECT target_id, kind, COUNT(*) AS c FROM reactions WHERE target_type = ? AND target_id IN (${marks}) GROUP BY target_id, kind`,
    targetType, ...ids,
  );
  const mine = viewerId
    ? all(`SELECT target_id, kind FROM reactions WHERE user_id = ? AND target_type = ? AND target_id IN (${marks})`, viewerId, targetType, ...ids)
    : [];
  return rows.map((row) => {
    const c = {};
    for (const r of counts) if (r.target_id === row.id) c[r.kind] = r.c;
    return {
      ...row,
      author: { ...publicUser(row), id: row.author_id },
      reactions: { counts: c, total: Object.values(c).reduce((a, b) => a + b, 0), mine: mine.find((r) => r.target_id === row.id)?.kind || null },
    };
  });
}

router.get('/media/limits', (_req, res) => ok(res, mediaLimits()));

router.post('/media', requireAuth, express.raw({ type: () => true, limit: '210mb' }), wrap(async (req, res) => {
  let mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
  if (mime === 'application/octet-stream' && req.query.mime) mime = String(req.query.mime);
  const filename = String(req.headers['x-filename'] || req.query.filename || 'upload.bin');
  const kindHint = req.query.kind ? String(req.query.kind) : undefined;
  const result = await saveUpload({ ownerId: req.user.user_id, buffer: req.body, filename, mime, kindHint });
  created(res, { media: result });
}));

router.post('/stories', requireAuth, wrap(async (req, res) => {
  const kind = v.oneOf(req.body.kind, ['image', 'video'], 'kind', 'image');
  const url = v.str(req.body.url, { field: 'url', max: 1000 });
  const caption = v.optionalStr(req.body.caption, { field: 'Chú thích', max: 300 });
  const storyId = crypto.randomUUID();
  db.prepare('INSERT INTO stories (id, author_id, kind, url, thumb_url, caption, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(storyId, req.user.user_id, kind, url, req.body.thumb_url || null, caption, new Date(Date.now() + 86400000).toISOString(), now());
  const friends = friendIds(req.user.user_id);
  for (const friendId of friends.slice(0, 200)) {
    notify({ userId: friendId, kind: 'story', actorId: req.user.user_id, targetType: 'story', targetId: storyId });
  }
  track(req.user.user_id, 'story_create', 'story', storyId);
  created(res, { story: { id: storyId, kind, url, thumb_url: req.body.thumb_url || null, caption, expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: now() } });
}));

router.get('/stories/feed', requireAuth, wrap(async (req, res) => {
  const authors = new Set([req.user.user_id, ...friendIds(req.user.user_id), ...followIds(req.user.user_id)]);
  const list = [...authors].filter((a) => !isBlocked(a, req.user.user_id));
  if (!list.length) return ok(res, { items: [] });
  const rows = all(
    `SELECT s.*, u.username, u.display_name, u.avatar_url FROM stories s JOIN users u ON u.id = s.author_id
     WHERE s.author_id IN (${list.map(() => '?').join(',')}) AND s.deleted_at IS NULL AND s.expires_at > ?
     ORDER BY s.created_at ASC LIMIT 300`,
    ...list, now(),
  );
  const viewed = new Set(all('SELECT story_id FROM story_views WHERE viewer_id = ?', req.user.user_id).map((r) => r.story_id));
  const groups = new Map();
  for (const story of rows) {
    if (!groups.has(story.author_id)) groups.set(story.author_id, { author: { ...publicUser(story), id: story.author_id }, items: [] });
    groups.get(story.author_id).items.push({
      id: story.id, kind: story.kind, url: story.url, thumb_url: story.thumb_url, caption: story.caption,
      created_at: story.created_at, expires_at: story.expires_at, viewed: viewed.has(story.id),
      viewers_count: story.author_id === req.user.user_id ? get('SELECT COUNT(*) AS c FROM story_views WHERE story_id = ?', story.id).c : undefined,
    });
  }
  ok(res, { items: [...groups.values()] });
}));

router.get('/stories/:id', requireAuth, wrap(async (req, res) => {
  const story = get(
    'SELECT s.*, u.username, u.display_name, u.avatar_url FROM stories s JOIN users u ON u.id = s.author_id WHERE s.id = ? AND s.deleted_at IS NULL',
    req.params.id,
  );
  if (!story) throw notFound('Không tìm thấy tin');
  if (story.expires_at <= now()) throw notFound('Tin đã hết hạn');
  const viewers = story.author_id === req.user.user_id
    ? all('SELECT u.*, sv.created_at AS viewed_at FROM story_views sv JOIN users u ON u.id = sv.viewer_id WHERE sv.story_id = ? ORDER BY sv.created_at DESC', story.id)
    : [];
  ok(res, {
    story: { ...story, author: { ...publicUser(story), id: story.author_id }, viewer_ids: viewers.map((u) => u.id) },
    viewers: viewers.map((u) => ({ ...publicUser(u), viewed_at: u.viewed_at })),
    viewed: !!get('SELECT 1 AS x FROM story_views WHERE story_id = ? AND viewer_id = ?', story.id, req.user.user_id),
  });
}));

router.post('/stories/:id/view', requireAuth, wrap(async (req, res) => {
  const story = get('SELECT * FROM stories WHERE id = ? AND deleted_at IS NULL AND expires_at > ?', req.params.id, now());
  if (!story) throw notFound('Không tìm thấy tin');
  db.prepare('INSERT INTO story_views (story_id, viewer_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(story.id, req.user.user_id, now());
  ok(res, { viewed: true });
}));

router.delete('/stories/:id', requireAuth, wrap(async (req, res) => {
  const story = get('SELECT * FROM stories WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!story) throw notFound('Không tìm thấy tin');
  if (story.author_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa tin này');
  db.prepare('UPDATE stories SET deleted_at = ? WHERE id = ?').run(now(), story.id);
  noContent(res);
}));

router.get('/reels', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const clauses = ['r.deleted_at IS NULL'];
  const params = [];
  if (viewerId) {
    clauses.push('r.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)');
    params.push(viewerId);
  }
  if (req.query.author) { clauses.push('r.author_id = ?'); params.push(String(req.query.author)); }
  if (req.query.following === 'true' && viewerId) {
    clauses.push('r.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)');
    params.push(viewerId);
  }
  const rows = all(
    `SELECT r.*, u.username, u.display_name, u.avatar_url FROM reels r JOIN users u ON u.id = r.author_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY (r.view_count + 3 * (SELECT COUNT(*) FROM reactions WHERE target_type = 'reel' AND target_id = r.id)) DESC, r.created_at DESC
     LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  const items = decorateTargets(rows, 'reel', viewerId).map((r) => ({
    ...r,
    bookmarked: viewerId ? !!get("SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND target_type = 'reel' AND target_id = ?", viewerId, r.id) : false,
    following: viewerId ? !!get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', viewerId, r.author_id) : false,
  }));
  ok(res, { items, total: get(`SELECT COUNT(*) AS c FROM reels r WHERE ${clauses.join(' AND ')}`, ...params).c, limit, offset });
}));

router.post('/reels', requireAuth, wrap(async (req, res) => {
  const url = v.str(req.body.url, { field: 'url', max: 1000 });
  const reelId = crypto.randomUUID();
  db.prepare('INSERT INTO reels (id, author_id, url, thumb_url, caption, audio, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(reelId, req.user.user_id, url, req.body.thumb_url || null, v.optionalStr(req.body.caption, { field: 'Chú thích', max: 500 }) || '',
      v.optionalStr(req.body.audio, { field: 'Âm thanh', max: 200 }), req.body.duration ? Number(req.body.duration) : null, now());
  track(req.user.user_id, 'reel_create', 'reel', reelId);
  const row = get('SELECT r.*, u.username, u.display_name, u.avatar_url FROM reels r JOIN users u ON u.id = r.author_id WHERE r.id = ?', reelId);
  created(res, { reel: decorateTargets([row], 'reel', req.user.user_id)[0] });
}));

router.post('/reels/:id/view', requireAuth, wrap(async (req, res) => {
  const reel = get('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!reel) throw notFound('Không tìm thấy reel');
  const inserted = db.prepare('INSERT INTO reel_views (reel_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(reel.id, req.user.user_id, now());
  if (inserted.changes > 0) db.prepare('UPDATE reels SET view_count = view_count + 1 WHERE id = ?').run(reel.id);
  ok(res, { views: reel.view_count + (inserted.changes > 0 ? 1 : 0) });
}));

router.delete('/reels/:id', requireAuth, wrap(async (req, res) => {
  const reel = get('SELECT * FROM reels WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!reel) throw notFound('Không tìm thấy reel');
  if (reel.author_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa reel này');
  db.prepare('UPDATE reels SET deleted_at = ? WHERE id = ?').run(now(), reel.id);
  noContent(res);
}));

router.get('/videos', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const scope = String(req.query.scope || 'public');
  const clauses = ['v.deleted_at IS NULL'];
  const params = [];
  if (scope === 'mine') {
    if (!viewerId) throw forbidden('Cần đăng nhập');
    clauses.push('v.owner_id = ?');
    params.push(viewerId);
  } else if (scope === 'following' && viewerId) {
    clauses.push(`(v.visibility = 'public' OR v.owner_id = ? OR v.owner_id IN (SELECT following_id FROM follows WHERE follower_id = ?))`);
    params.push(viewerId, viewerId);
  } else {
    clauses.push("(v.visibility = 'public' OR v.owner_id = ?)");
    params.push(viewerId || '');
  }
  if (viewerId) {
    clauses.push('v.owner_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)');
    params.push(viewerId);
  }
  if (req.query.q) { clauses.push('(v.title LIKE ? OR v.description LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = all(
    `SELECT v.*, u.username, u.display_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.owner_id
     WHERE ${clauses.join(' AND ')} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  const items = decorateTargets(rows, 'video', viewerId);
  ok(res, {
    items: items.map((vid) => ({ ...vid, owner: vid.author, bookmarked: viewerId ? !!get("SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND target_type = 'video' AND target_id = ?", viewerId, vid.id) : false })),
    total: get(`SELECT COUNT(*) AS c FROM videos v WHERE ${clauses.join(' AND ')}`, ...params).c,
    limit, offset,
  });
}));

router.get('/videos/:id', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const row = get('SELECT v.*, u.username, u.display_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ? AND v.deleted_at IS NULL', req.params.id);
  if (!row) throw notFound('Không tìm thấy video');
  if (row.visibility !== 'public' && row.owner_id !== viewerId) {
    if (row.visibility === 'friends' && viewerId && areFriends(row.owner_id, viewerId)) {
      // allowed
    } else if (!['admin', 'moderator'].includes(req.user?.role || '')) {
      throw forbidden('Video này được bảo vệ');
    }
  }
  ok(res, { video: decorateTargets([row], 'video', viewerId)[0] });
}));

router.post('/videos', requireAuth, wrap(async (req, res) => {
  const title = v.str(req.body.title, { field: 'Tiêu đề', min: 1, max: 200 });
  const url = v.str(req.body.url, { field: 'url', max: 1000 });
  const videoId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO videos (id, owner_id, title, description, url, thumb_url, duration, visibility, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
  ).run(
    videoId, req.user.user_id, title, v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || '',
    url, req.body.thumb_url || null, req.body.duration ? Number(req.body.duration) : null,
    v.oneOf(req.body.visibility, ['public', 'friends', 'private'], 'visibility', 'public'), now(), now(),
  );
  track(req.user.user_id, 'video_create', 'video', videoId);
  const row = get('SELECT v.*, u.username, u.display_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ?', videoId);
  created(res, { video: decorateTargets([row], 'video', req.user.user_id)[0] });
}));

router.patch('/videos/:id', requireAuth, wrap(async (req, res) => {
  const video = get('SELECT * FROM videos WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!video) throw notFound('Không tìm thấy video');
  if (video.owner_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể sửa video này');
  const updates = [];
  const params = [];
  if (req.body.title !== undefined) { updates.push('title = ?'); params.push(v.str(req.body.title, { field: 'Tiêu đề', min: 1, max: 200 })); }
  if (req.body.description !== undefined) { updates.push('description = ?'); params.push(v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || ''); }
  if (req.body.visibility !== undefined) { updates.push('visibility = ?'); params.push(v.oneOf(req.body.visibility, ['public', 'friends', 'private'], 'visibility')); }
  if (!updates.length) return ok(res, { video });
  updates.push('updated_at = ?');
  params.push(now(), video.id);
  db.prepare(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  ok(res, { video: get('SELECT * FROM videos WHERE id = ?', video.id) });
}));

router.delete('/videos/:id', requireAuth, wrap(async (req, res) => {
  const video = get('SELECT * FROM videos WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!video) throw notFound('Không tìm thấy video');
  if (video.owner_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa video này');
  db.prepare('UPDATE videos SET deleted_at = ? WHERE id = ?').run(now(), video.id);
  noContent(res);
}));

router.post('/videos/:id/view', requireAuth, wrap(async (req, res) => {
  const video = get('SELECT * FROM videos WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!video) throw notFound('Không tìm thấy video');
  const inserted = db.prepare('INSERT INTO video_views (video_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(video.id, req.user.user_id, now());
  if (inserted.changes > 0) db.prepare('UPDATE videos SET view_count = view_count + 1 WHERE id = ?').run(video.id);
  ok(res, { views: video.view_count + (inserted.changes > 0 ? 1 : 0) });
}));

router.get('/live', wrap(async (req, res) => {
  const rows = all(
    `SELECT l.*, u.username, u.display_name, u.avatar_url,
       (SELECT COUNT(*) FROM live_viewers WHERE stream_id = l.id) AS viewers
     FROM live_streams l JOIN users u ON u.id = l.host_id
     WHERE l.status = 'live' ORDER BY l.started_at DESC LIMIT 50`,
  );
  ok(res, { items: rows.map((r) => ({ ...r, host: { ...publicUser(r), id: r.host_id } })) });
}));

router.get('/live/:id', wrap(async (req, res) => {
  const row = get(
    `SELECT l.*, u.username, u.display_name, u.avatar_url,
       (SELECT COUNT(*) FROM live_viewers WHERE stream_id = l.id) AS viewers
     FROM live_streams l JOIN users u ON u.id = l.host_id WHERE l.id = ?`, req.params.id,
  );
  if (!row) throw notFound('Không tìm thấy buổi phát trực tiếp');
  const comments = all(
    'SELECT c.*, u.username, u.display_name, u.avatar_url FROM live_comments c JOIN users u ON u.id = c.user_id WHERE c.stream_id = ? ORDER BY c.created_at DESC LIMIT 100',
    row.id,
  ).reverse();
  ok(res, { stream: { ...row, host: { ...publicUser(row), id: row.host_id } }, comments: comments.map((c) => ({ ...c, user: { ...publicUser(c), id: c.user_id } })) });
}));

router.post('/live', requireAuth, wrap(async (req, res) => {
  requireFeature('feature_live');
  const existing = get("SELECT * FROM live_streams WHERE host_id = ? AND status = 'live'", req.user.user_id);
  if (existing) return ok(res, { stream: existing });
  const streamId = crypto.randomUUID();
  db.prepare('INSERT INTO live_streams (id, host_id, title, status, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(streamId, req.user.user_id, v.str(req.body.title, { field: 'Tiêu đề', max: 200, required: false }) || 'Live', 'live', now(), now());
  track(req.user.user_id, 'live_start', 'live', streamId);
  created(res, { stream: get('SELECT * FROM live_streams WHERE id = ?', streamId) });
}));

router.post('/live/:id/end', requireAuth, wrap(async (req, res) => {
  const stream = get('SELECT * FROM live_streams WHERE id = ?', req.params.id);
  if (!stream) throw notFound('Không tìm thấy buổi phát trực tiếp');
  if (stream.host_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể kết thúc buổi phát này');
  db.prepare("UPDATE live_streams SET status = 'ended', ended_at = ? WHERE id = ?").run(now(), stream.id);
  const viewers = all('SELECT user_id FROM live_viewers WHERE stream_id = ?', stream.id);
  sendToMany(viewers.map((r) => r.user_id), 'live_ended', { stream_id: stream.id });
  ok(res, { ok: true });
}));

router.post('/live/:id/join', requireAuth, wrap(async (req, res) => {
  const stream = get("SELECT * FROM live_streams WHERE id = ? AND status = 'live'", req.params.id);
  if (!stream) throw notFound('Buổi phát đã kết thúc');
  if (stream.host_id !== req.user.user_id) {
    db.prepare('INSERT INTO live_viewers (stream_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .run(stream.id, req.user.user_id, now());
    notify({ userId: stream.host_id, kind: 'live_viewer', actorId: req.user.user_id, targetType: 'live', targetId: stream.id });
  }
  sendTo(stream.host_id, 'live_join', { stream_id: stream.id, user: { id: req.user.user_id, username: req.user.username, display_name: req.user.display_name } });
  ok(res, { stream });
}));

router.post('/live/:id/leave', requireAuth, wrap(async (req, res) => {
  db.prepare('DELETE FROM live_viewers WHERE stream_id = ? AND user_id = ?').run(req.params.id, req.user.user_id);
  ok(res, { ok: true });
}));

router.get('/live/:id/comments', wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    'SELECT c.*, u.username, u.display_name, u.avatar_url FROM live_comments c JOIN users u ON u.id = c.user_id WHERE c.stream_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?',
    req.params.id, limit, offset,
  );
  ok(res, { items: rows.map((c) => ({ ...c, user: { ...publicUser(c), id: c.user_id } })) });
}));

router.post('/live/:id/comments', requireAuth, wrap(async (req, res) => {
  const stream = get("SELECT * FROM live_streams WHERE id = ? AND status = 'live'", req.params.id);
  if (!stream) throw notFound('Buổi phát đã kết thúc');
  const body = v.str(req.body.body, { field: 'Bình luận', min: 1, max: 500 });
  const commentId = crypto.randomUUID();
  db.prepare('INSERT INTO live_comments (id, stream_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(commentId, stream.id, req.user.user_id, body, now());
  const comment = { id: commentId, stream_id: stream.id, user: { id: req.user.user_id, username: req.user.username, display_name: req.user.display_name }, body, created_at: now() };
  const recipients = [stream.host_id, ...all('SELECT user_id FROM live_viewers WHERE stream_id = ?', stream.id).map((r) => r.user_id)];
  sendToMany(recipients, 'live_comment', { stream_id: stream.id, comment });
  ok(res, { comment });
}));

router.post('/live/:id/signal', requireAuth, wrap(async (req, res) => {
  const stream = get("SELECT * FROM live_streams WHERE id = ? AND status = 'live'", req.params.id);
  if (!stream) throw notFound('Buổi phát đã kết thúc');
  const to = v.str(req.body.to, { field: 'to', min: 1 });
  const kind = v.oneOf(req.body.kind, ['offer', 'answer', 'ice', 'ready'], 'kind');
  const isViewer = !!get('SELECT 1 AS x FROM live_viewers WHERE stream_id = ? AND user_id = ?', stream.id, req.user.user_id);
  if (stream.host_id !== req.user.user_id && !isViewer) throw forbidden('Bạn chưa tham gia buổi phát');
  const payload = JSON.stringify(req.body.payload || {});
  db.prepare('INSERT INTO live_signals (id, stream_id, from_user_id, to_user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), stream.id, req.user.user_id, to, kind, payload, now());
  sendTo(to, 'live_signal', { stream_id: stream.id, from: req.user.user_id, kind, payload: JSON.parse(payload) });
  ok(res, { ok: true });
}));

router.get('/live/:id/signals', requireAuth, wrap(async (req, res) => {
  const after = String(req.query.after || '1970-01-01T00:00:00.000Z');
  const rows = all(
    'SELECT * FROM live_signals WHERE stream_id = ? AND to_user_id = ? AND created_at > ? ORDER BY created_at LIMIT 100',
    req.params.id, req.user.user_id, after,
  );
  ok(res, { items: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
}));

export default router;
