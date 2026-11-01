import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import {
  publicUser, notify, track, isGroupMember, groupRole, requireGroupRole, pageRole, requirePageRole,
} from '../lib/social.js';
import { sendToMany } from '../lib/realtime.js';

const router = Router();

function slugify(name) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
  let slug = base;
  let n = 1;
  while (get('SELECT 1 AS x FROM groups WHERE slug = ? UNION SELECT 1 FROM pages WHERE slug = ?', slug, slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function groupPayload(group, viewerId) {
  const membership = viewerId ? get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', group.id, viewerId) : null;
  return {
    ...group,
    members_count: get("SELECT COUNT(*) AS c FROM group_members WHERE group_id = ? AND status = 'active'", group.id).c,
    posts_count: get("SELECT COUNT(*) AS c FROM posts WHERE group_id = ? AND deleted_at IS NULL", group.id).c,
    my_role: membership?.status === 'active' ? membership.role : null,
    my_status: membership?.status || null,
  };
}

router.get('/groups', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const q = req.query.q ? `%${String(req.query.q).slice(0, 100)}%` : null;
  const mine = req.query.mine === 'true' && viewerId;
  const clauses = [];
  const params = [];
  if (mine) {
    clauses.push("g.id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'active')");
    params.push(viewerId);
  } else {
    clauses.push("(g.privacy = 'public' OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'active'))");
    params.push(viewerId || '');
  }
  if (q) { clauses.push('(g.name LIKE ? OR g.description LIKE ?)'); params.push(q, q); }
  const rows = all(
    `SELECT g.* FROM groups g WHERE ${clauses.join(' AND ')} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  ok(res, { items: rows.map((g) => groupPayload(g, viewerId)), total: get(`SELECT COUNT(*) AS c FROM groups g WHERE ${clauses.join(' AND ')}`, ...params).c });
}));

router.post('/groups', requireAuth, wrap(async (req, res) => {
  const name = v.str(req.body.name, { field: 'Tên nhóm', min: 2, max: 120 });
  const privacy = v.oneOf(req.body.privacy, ['public', 'private'], 'privacy', 'public');
  const groupId = crypto.randomUUID();
  const slug = slugify(name);
  db.prepare('INSERT INTO groups (id, name, slug, description, avatar_url, cover_url, privacy, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(groupId, name, slug, v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || '',
      req.body.avatar_url || null, req.body.cover_url || null, privacy, req.user.user_id, now(), now());
  db.prepare("INSERT INTO group_members (group_id, user_id, role, status, joined_at) VALUES (?, ?, 'owner', 'active', ?)")
    .run(groupId, req.user.user_id, now());
  track(req.user.user_id, 'group_create', 'group', groupId);
  created(res, { group: groupPayload(get('SELECT * FROM groups WHERE id = ?', groupId), req.user.user_id) });
}));

router.get('/groups/:id', wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ? OR slug = ?', req.params.id, String(req.params.id).toLowerCase());
  if (!group) throw notFound('Không tìm thấy nhóm');
  const viewerId = req.user?.user_id || null;
  if (group.privacy === 'private' && (!viewerId || !isGroupMember(group.id, viewerId))) {
    throw forbidden('Nhóm này là riêng tư');
  }
  ok(res, { group: groupPayload(group, viewerId) });
}));

router.patch('/groups/:id', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  requireGroupRole(group.id, req.user.user_id, ['owner', 'admin']);
  const updates = [];
  const params = [];
  if (req.body.name !== undefined) { updates.push('name = ?'); params.push(v.str(req.body.name, { field: 'Tên nhóm', min: 2, max: 120 })); }
  if (req.body.description !== undefined) { updates.push('description = ?'); params.push(v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || ''); }
  if (req.body.privacy !== undefined) { updates.push('privacy = ?'); params.push(v.oneOf(req.body.privacy, ['public', 'private'], 'privacy')); }
  if (req.body.avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(req.body.avatar_url || null); }
  if (req.body.cover_url !== undefined) { updates.push('cover_url = ?'); params.push(req.body.cover_url || null); }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now(), group.id);
    db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  ok(res, { group: groupPayload(get('SELECT * FROM groups WHERE id = ?', group.id), req.user.user_id) });
}));

router.delete('/groups/:id', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  if (group.owner_id !== req.user.user_id && !['admin'].includes(req.user.role)) throw forbidden('Chỉ chủ nhóm mới có thể xóa');
  db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
  noContent(res);
}));

router.get('/groups/:id/members', wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  const viewerId = req.user?.user_id || null;
  if (group.privacy === 'private' && (!viewerId || !isGroupMember(group.id, viewerId))) throw forbidden('Nhóm này là riêng tư');
  const { limit, offset } = pagination(req.query);
  const status = req.query.status || 'active';
  const rows = all(
    `SELECT u.*, gm.role, gm.status, gm.joined_at FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ? AND gm.status = ? ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, u.display_name
     LIMIT ? OFFSET ?`,
    group.id, status, limit, offset,
  );
  ok(res, { items: rows.map((u) => ({ ...publicUser(u), role: u.role, status: u.status, joined_at: u.joined_at })) });
}));

router.post('/groups/:id/join', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  const existing = get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', group.id, req.user.user_id);
  if (existing) return ok(res, { status: existing.status, role: existing.role });
  const status = group.privacy === 'private' ? 'pending' : 'active';
  db.prepare('INSERT INTO group_members (group_id, user_id, role, status, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(group.id, req.user.user_id, 'member', status, now());
  if (status === 'pending') {
    const admins = all("SELECT user_id FROM group_members WHERE group_id = ? AND status = 'active' AND role IN ('owner','admin','moderator')", group.id);
    for (const admin of admins) notify({ userId: admin.user_id, kind: 'group_join_request', actorId: req.user.user_id, targetType: 'group', targetId: group.id });
  } else {
    notify({ userId: group.owner_id, kind: 'group_join', actorId: req.user.user_id, targetType: 'group', targetId: group.id });
  }
  track(req.user.user_id, 'group_join', 'group', group.id, { status });
  ok(res, { status });
}));

router.post('/groups/:id/leave', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  if (group.owner_id === req.user.user_id) throw badRequest('Chủ nhóm phải chuyển quyền trước khi rời');
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, req.user.user_id);
  ok(res, { left: true });
}));

router.post('/groups/:id/members/:userId/approve', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  requireGroupRole(group.id, req.user.user_id, ['owner', 'admin', 'moderator']);
  const member = get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', group.id, req.params.userId);
  if (!member) throw notFound('Không tìm thấy yêu cầu');
  db.prepare("UPDATE group_members SET status = 'active' WHERE group_id = ? AND user_id = ?").run(group.id, req.params.userId);
  notify({ userId: req.params.userId, kind: 'group_approved', actorId: req.user.user_id, targetType: 'group', targetId: group.id });
  ok(res, { status: 'active' });
}));

router.post('/groups/:id/members/:userId/reject', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  requireGroupRole(group.id, req.user.user_id, ['owner', 'admin', 'moderator']);
  db.prepare("UPDATE group_members SET status = 'banned' WHERE group_id = ? AND user_id = ?").run(group.id, req.params.userId);
  ok(res, { status: 'rejected' });
}));

router.patch('/groups/:id/members/:userId', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  const actorRole = requireGroupRole(group.id, req.user.user_id, ['owner', 'admin']);
  const member = get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', group.id, req.params.userId);
  if (!member) throw notFound('Không tìm thấy thành viên');
  if (member.role === 'owner') throw forbidden('Không thể thay đổi chủ nhóm');
  if (req.body.role !== undefined) {
    const role = v.oneOf(req.body.role, ['admin', 'moderator', 'member'], 'role');
    if (role === 'admin' && actorRole !== 'owner') throw forbidden('Chỉ chủ nhóm mới có thể bổ nhiệm admin');
    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, group.id, member.user_id);
    notify({ userId: member.user_id, kind: 'group_role', actorId: req.user.user_id, targetType: 'group', targetId: group.id, data: { role } });
  }
  if (req.body.status !== undefined) {
    const status = v.oneOf(req.body.status, ['active', 'pending', 'banned'], 'status');
    db.prepare('UPDATE group_members SET status = ? WHERE group_id = ? AND user_id = ?').run(status, group.id, member.user_id);
  }
  ok(res, { ok: true });
}));

router.delete('/groups/:id/members/:userId', requireAuth, wrap(async (req, res) => {
  const group = get('SELECT * FROM groups WHERE id = ?', req.params.id);
  if (!group) throw notFound('Không tìm thấy nhóm');
  requireGroupRole(group.id, req.user.user_id, ['owner', 'admin', 'moderator']);
  const member = get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', group.id, req.params.userId);
  if (!member) throw notFound('Không tìm thấy thành viên');
  if (member.role === 'owner') throw forbidden('Không thể xóa chủ nhóm');
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, member.user_id);
  notify({ userId: member.user_id, kind: 'group_kick', actorId: req.user.user_id, targetType: 'group', targetId: group.id });
  noContent(res);
}));

function pagePayload(page, viewerId) {
  const role = viewerId ? pageRole(page.id, viewerId) : null;
  return {
    ...page,
    verified: !!page.verified,
    followers_count: get('SELECT COUNT(*) AS c FROM page_followers WHERE page_id = ?', page.id).c,
    posts_count: get("SELECT COUNT(*) AS c FROM posts WHERE page_id = ? AND deleted_at IS NULL", page.id).c,
    following: viewerId ? !!get('SELECT 1 AS x FROM page_followers WHERE page_id = ? AND user_id = ?', page.id, viewerId) : false,
    my_role: role,
  };
}

router.get('/pages', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const q = req.query.q ? `%${String(req.query.q).slice(0, 100)}%` : null;
  const clauses = [];
  const params = [];
  if (req.query.mine === 'true' && viewerId) {
    clauses.push("(p.owner_id = ? OR p.id IN (SELECT page_id FROM page_roles WHERE user_id = ?))");
    params.push(viewerId, viewerId);
  }
  if (q) { clauses.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(q, q); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = all(`SELECT p.* FROM pages p ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  ok(res, { items: rows.map((p) => pagePayload(p, viewerId)), total: get(`SELECT COUNT(*) AS c FROM pages p ${where}`, ...params).c });
}));

router.post('/pages', requireAuth, wrap(async (req, res) => {
  const name = v.str(req.body.name, { field: 'Tên trang', min: 2, max: 120 });
  const pageId = crypto.randomUUID();
  db.prepare('INSERT INTO pages (id, name, slug, category, description, avatar_url, cover_url, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pageId, name, slugify(name), v.optionalStr(req.body.category, { field: 'Danh mục', max: 60 }) || 'general',
      v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || '', req.body.avatar_url || null,
      req.body.cover_url || null, req.user.user_id, now(), now());
  track(req.user.user_id, 'page_create', 'page', pageId);
  created(res, { page: pagePayload(get('SELECT * FROM pages WHERE id = ?', pageId), req.user.user_id) });
}));

router.get('/pages/:id', wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ? OR slug = ?', req.params.id, String(req.params.id).toLowerCase());
  if (!page) throw notFound('Không tìm thấy trang');
  ok(res, { page: pagePayload(page, req.user?.user_id || null) });
}));

router.patch('/pages/:id', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  requirePageRole(page.id, req.user.user_id, ['owner', 'admin']);
  const updates = [];
  const params = [];
  if (req.body.name !== undefined) { updates.push('name = ?'); params.push(v.str(req.body.name, { field: 'Tên trang', min: 2, max: 120 })); }
  if (req.body.category !== undefined) { updates.push('category = ?'); params.push(v.str(req.body.category, { field: 'Danh mục', max: 60 })); }
  if (req.body.description !== undefined) { updates.push('description = ?'); params.push(v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || ''); }
  if (req.body.avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(req.body.avatar_url || null); }
  if (req.body.cover_url !== undefined) { updates.push('cover_url = ?'); params.push(req.body.cover_url || null); }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now(), page.id);
    db.prepare(`UPDATE pages SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  ok(res, { page: pagePayload(get('SELECT * FROM pages WHERE id = ?', page.id), req.user.user_id) });
}));

router.delete('/pages/:id', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  if (page.owner_id !== req.user.user_id && req.user.role !== 'admin') throw forbidden('Chỉ chủ trang mới có thể xóa');
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
  noContent(res);
}));

router.post('/pages/:id/follow', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  db.prepare('INSERT INTO page_followers (page_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(page.id, req.user.user_id, now());
  if (page.owner_id !== req.user.user_id) notify({ userId: page.owner_id, kind: 'page_follow', actorId: req.user.user_id, targetType: 'page', targetId: page.id });
  ok(res, { following: true, followers_count: get('SELECT COUNT(*) AS c FROM page_followers WHERE page_id = ?', page.id).c });
}));

router.delete('/pages/:id/follow', requireAuth, wrap(async (req, res) => {
  db.prepare('DELETE FROM page_followers WHERE page_id = ? AND user_id = ?').run(req.params.id, req.user.user_id);
  noContent(res);
}));

router.get('/pages/:id/followers', wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all('SELECT u.*, pf.created_at AS followed_at FROM page_followers pf JOIN users u ON u.id = pf.user_id WHERE pf.page_id = ? ORDER BY pf.created_at DESC LIMIT ? OFFSET ?', req.params.id, limit, offset);
  ok(res, { items: rows.map((u) => ({ ...publicUser(u), followed_at: u.followed_at })) });
}));

router.post('/pages/:id/roles', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  if (page.owner_id !== req.user.user_id) throw forbidden('Chỉ chủ trang mới có thể phân quyền');
  const userId = v.str(req.body.user_id, { field: 'user_id' });
  const role = v.oneOf(req.body.role, ['admin', 'editor', 'analyst'], 'role', 'editor');
  const user = get("SELECT id FROM users WHERE id = ? AND status = 'active'", userId);
  if (!user) throw notFound('Không tìm thấy người dùng');
  db.prepare('INSERT INTO page_roles (page_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(page_id, user_id) DO UPDATE SET role = excluded.role')
    .run(page.id, userId, role);
  notify({ userId, kind: 'page_role', actorId: req.user.user_id, targetType: 'page', targetId: page.id, data: { role } });
  ok(res, { ok: true });
}));

router.delete('/pages/:id/roles/:userId', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  if (page.owner_id !== req.user.user_id) throw forbidden('Chỉ chủ trang mới có thể phân quyền');
  db.prepare('DELETE FROM page_roles WHERE page_id = ? AND user_id = ?').run(page.id, req.params.userId);
  noContent(res);
}));

router.get('/pages/:id/analytics', requireAuth, wrap(async (req, res) => {
  const page = get('SELECT * FROM pages WHERE id = ?', req.params.id);
  if (!page) throw notFound('Không tìm thấy trang');
  requirePageRole(page.id, req.user.user_id, ['owner', 'admin', 'analyst']);
  const posts = get("SELECT COUNT(*) AS c FROM posts WHERE page_id = ? AND deleted_at IS NULL", page.id).c;
  const reactions = get(
    `SELECT COUNT(*) AS c FROM reactions WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE page_id = ?)`, page.id,
  ).c;
  const comments = get(
    `SELECT COUNT(*) AS c FROM comments WHERE post_id IN (SELECT id FROM posts WHERE page_id = ?) AND deleted_at IS NULL`, page.id,
  ).c;
  const views = get("SELECT COUNT(*) AS c FROM analytics_events WHERE target_type = 'post' AND type = 'post_view' AND target_id IN (SELECT id FROM posts WHERE page_id = ?)", page.id).c;
  ok(res, {
    analytics: {
      followers: get('SELECT COUNT(*) AS c FROM page_followers WHERE page_id = ?', page.id).c,
      posts, reactions, comments, views,
      daily: all(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM analytics_events
         WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE page_id = ?) AND created_at >= ?
         GROUP BY day ORDER BY day`, page.id, new Date(Date.now() - 30 * 86400000).toISOString(),
      ),
    },
  });
}));

function eventPayload(event, viewerId) {
  const counts = get("SELECT COUNT(*) AS c FROM event_attendees WHERE event_id = ? AND status = 'going'", event.id).c;
  const mine = viewerId ? get('SELECT status FROM event_attendees WHERE event_id = ? AND user_id = ?', event.id, viewerId) : null;
  return {
    ...event,
    going_count: counts,
    interested_count: get("SELECT COUNT(*) AS c FROM event_attendees WHERE event_id = ? AND status = 'interested'", event.id).c,
    my_status: mine?.status || null,
    creator: event.creator_username ? { id: event.creator_id, username: event.creator_username, display_name: event.creator_display_name, avatar_url: event.creator_avatar } : undefined,
  };
}

router.get('/events', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const scope = String(req.query.scope || 'upcoming');
  const clauses = ['e.deleted_at IS NULL'];
  const params = [];
  if (scope === 'mine' && viewerId) {
    clauses.push('(e.creator_id = ? OR e.id IN (SELECT event_id FROM event_attendees WHERE user_id = ?))');
    params.push(viewerId, viewerId);
  } else if (scope === 'going' && viewerId) {
    clauses.push("e.id IN (SELECT event_id FROM event_attendees WHERE user_id = ? AND status = 'going')");
    params.push(viewerId);
  } else {
    clauses.push("(e.privacy = 'public' OR e.creator_id = ? OR e.id IN (SELECT event_id FROM event_attendees WHERE user_id = ?))");
    params.push(viewerId || '', viewerId || '');
    clauses.push('e.starts_at >= ?');
    params.push(new Date(Date.now() - 86400000).toISOString());
  }
  if (req.query.q) { clauses.push('(e.title LIKE ? OR e.description LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = all(
    `SELECT e.*, u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar
     FROM events e JOIN users u ON u.id = e.creator_id
     WHERE ${clauses.join(' AND ')} ORDER BY e.starts_at ASC LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  ok(res, { items: rows.map((e) => eventPayload(e, viewerId)), total: get(`SELECT COUNT(*) AS c FROM events e WHERE ${clauses.join(' AND ')}`, ...params).c });
}));

router.post('/events', requireAuth, wrap(async (req, res) => {
  const title = v.str(req.body.title, { field: 'Tên sự kiện', min: 2, max: 200 });
  const startsAt = v.date(req.body.starts_at, 'Thời gian bắt đầu');
  const endsAt = req.body.ends_at ? v.date(req.body.ends_at, 'Thời gian kết thúc', false) : null;
  if (endsAt && endsAt < startsAt) throw badRequest('Thời gian kết thúc phải sau thời gian bắt đầu');
  const eventId = crypto.randomUUID();
  db.prepare('INSERT INTO events (id, creator_id, title, description, cover_url, location, starts_at, ends_at, privacy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(eventId, req.user.user_id, title, v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || '',
      req.body.cover_url || null, v.optionalStr(req.body.location, { field: 'Địa điểm', max: 300 }),
      startsAt, endsAt, v.oneOf(req.body.privacy, ['public', 'private'], 'privacy', 'public'), now(), now());
  db.prepare("INSERT INTO event_attendees (event_id, user_id, status, created_at) VALUES (?, ?, 'going', ?)")
    .run(eventId, req.user.user_id, now());
  track(req.user.user_id, 'event_create', 'event', eventId);
  const row = get('SELECT e.*, u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar FROM events e JOIN users u ON u.id = e.creator_id WHERE e.id = ?', eventId);
  created(res, { event: eventPayload(row, req.user.user_id) });
}));

router.get('/events/:id', wrap(async (req, res) => {
  const row = get('SELECT e.*, u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar FROM events e JOIN users u ON u.id = e.creator_id WHERE e.id = ? AND e.deleted_at IS NULL', req.params.id);
  if (!row) throw notFound('Không tìm thấy sự kiện');
  const viewerId = req.user?.user_id || null;
  if (row.privacy === 'private' && row.creator_id !== viewerId) {
    const invited = viewerId && get('SELECT 1 AS x FROM event_attendees WHERE event_id = ? AND user_id = ?', row.id, viewerId);
    if (!invited) throw forbidden('Sự kiện này là riêng tư');
  }
  ok(res, { event: eventPayload(row, viewerId) });
}));

router.patch('/events/:id', requireAuth, wrap(async (req, res) => {
  const event = get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!event) throw notFound('Không tìm thấy sự kiện');
  if (event.creator_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể sửa sự kiện này');
  const updates = [];
  const params = [];
  if (req.body.title !== undefined) { updates.push('title = ?'); params.push(v.str(req.body.title, { field: 'Tên sự kiện', min: 2, max: 200 })); }
  if (req.body.description !== undefined) { updates.push('description = ?'); params.push(v.optionalStr(req.body.description, { field: 'Mô tả', max: 5000 }) || ''); }
  if (req.body.location !== undefined) { updates.push('location = ?'); params.push(v.optionalStr(req.body.location, { field: 'Địa điểm', max: 300 })); }
  if (req.body.starts_at !== undefined) { updates.push('starts_at = ?'); params.push(v.date(req.body.starts_at, 'Thời gian bắt đầu')); }
  if (req.body.ends_at !== undefined) { updates.push('ends_at = ?'); params.push(v.date(req.body.ends_at, 'Thời gian kết thúc', false)); }
  if (req.body.privacy !== undefined) { updates.push('privacy = ?'); params.push(v.oneOf(req.body.privacy, ['public', 'private'], 'privacy')); }
  if (req.body.cover_url !== undefined) { updates.push('cover_url = ?'); params.push(req.body.cover_url || null); }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now(), event.id);
    db.prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const row = get('SELECT e.*, u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar FROM events e JOIN users u ON u.id = e.creator_id WHERE e.id = ?', event.id);
  ok(res, { event: eventPayload(row, req.user.user_id) });
}));

router.delete('/events/:id', requireAuth, wrap(async (req, res) => {
  const event = get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!event) throw notFound('Không tìm thấy sự kiện');
  if (event.creator_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa sự kiện này');
  db.prepare('UPDATE events SET deleted_at = ? WHERE id = ?').run(now(), event.id);
  noContent(res);
}));

router.post('/events/:id/invite', requireAuth, wrap(async (req, res) => {
  const event = get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!event) throw notFound('Không tìm thấy sự kiện');
  if (event.creator_id !== req.user.user_id && !get('SELECT 1 AS x FROM event_attendees WHERE event_id = ? AND user_id = ?', event.id, req.user.user_id)) throw forbidden('Chỉ người tham gia mới có thể mời');
  if (!Array.isArray(req.body.user_ids) || req.body.user_ids.length === 0) throw badRequest('Cần danh sách user_ids');
  if (req.body.user_ids.length > 200) throw badRequest('Tối đa 200 lời mời mỗi lần');
  let invited = 0;
  for (const userId of [...new Set(req.body.user_ids.map(String))]) {
    if (!get("SELECT id FROM users WHERE id = ? AND status = 'active'", userId)) continue;
    db.prepare("INSERT INTO event_attendees (event_id, user_id, status, invited_by, created_at) VALUES (?, ?, 'invited', ?, ?) ON CONFLICT DO NOTHING")
      .run(event.id, userId, req.user.user_id, now());
    notify({ userId, kind: 'event_invite', actorId: req.user.user_id, targetType: 'event', targetId: event.id, data: { title: event.title } });
    invited += 1;
  }
  ok(res, { invited });
}));

router.post('/events/:id/attend', requireAuth, wrap(async (req, res) => {
  const event = get('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!event) throw notFound('Không tìm thấy sự kiện');
  const status = v.oneOf(req.body.status, ['going', 'interested', 'declined'], 'status', 'going');
  db.prepare('INSERT INTO event_attendees (event_id, user_id, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status')
    .run(event.id, req.user.user_id, status, now());
  if (status === 'going' && event.creator_id !== req.user.user_id) {
    notify({ userId: event.creator_id, kind: 'event_attend', actorId: req.user.user_id, targetType: 'event', targetId: event.id });
  }
  ok(res, { status });
}));

router.get('/events/:id/attendees', wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT u.*, ea.status, ea.created_at AS responded_at FROM event_attendees ea JOIN users u ON u.id = ea.user_id
     WHERE ea.event_id = ? ORDER BY CASE ea.status WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END, ea.created_at LIMIT ? OFFSET ?`,
    req.params.id, limit, offset,
  );
  ok(res, { items: rows.map((u) => ({ ...publicUser(u), status: u.status, responded_at: u.responded_at })) });
}));

export default router;
