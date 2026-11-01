import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import {
  areFriends, isBlocked, friendIds, canViewProfile, notify, track, publicUser, selfUser,
} from '../lib/social.js';

const router = Router();

function relationship(viewerId, targetId) {
  if (!viewerId) return 'anonymous';
  if (viewerId === targetId) return 'self';
  if (isBlocked(viewerId, targetId)) return 'blocked';
  if (areFriends(viewerId, targetId)) return 'friends';
  const out = get('SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?', viewerId, targetId);
  if (out) return out.status === 'pending' ? 'request_sent' : out.status;
  const inc = get('SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?', targetId, viewerId);
  if (inc) return inc.status === 'pending' ? 'request_received' : inc.status;
  if (get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?', viewerId, targetId)) return 'following';
  return 'none';
}

function profilePayload(user, viewerId) {
  const counts = {
    friends: get("SELECT COUNT(*) AS c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", user.id, user.id).c,
    followers: get('SELECT COUNT(*) AS c FROM follows WHERE following_id = ?', user.id).c,
    following: get('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?', user.id).c,
    posts: get("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND deleted_at IS NULL AND status = 'active'", user.id).c,
  };
  const privacy = get('SELECT * FROM privacy_settings WHERE user_id = ?', user.id);
  const visible = canViewProfile(user.id, viewerId);
  return {
    ...publicUser(user),
    relationship: relationship(viewerId, user.id),
    followers: counts.followers,
    following: counts.following,
    friends_count: counts.friends,
    posts_count: counts.posts,
    privacy: { profile_visibility: privacy?.profile_visibility || 'public' },
    limited: !visible,
    bio: visible ? user.bio : '',
    birthday: visible ? user.birthday : null,
    gender: visible ? user.gender : null,
    online: user.last_seen_at ? Date.now() - new Date(user.last_seen_at).getTime() < 5 * 60000 : false,
  };
}

router.get('/users/suggestions', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit } = pagination(req.query);
  if (!viewerId) {
    return ok(res, {
      items: all("SELECT * FROM users WHERE status = 'active' ORDER BY created_at DESC LIMIT ?", limit)
        .map((u) => profilePayload(u, null))
        .filter((u) => !u.limited),
    });
  }
  const friends = friendIds(viewerId);
  const placeholders = friends.map(() => '?').join(',') || "''";
  const rows = all(
    `SELECT u.*, COUNT(*) AS mutual
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted'
       AND (f.requester_id = ? OR f.addressee_id = ?)
       AND u.id != ?
       AND u.status = 'active'
       AND u.id NOT IN (${placeholders})
       AND u.id NOT IN (SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'pending' AND (requester_id = ? OR addressee_id = ?))
       AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
       AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
     GROUP BY u.id
     ORDER BY mutual DESC, u.last_seen_at DESC
     LIMIT ?`,
    viewerId, viewerId, viewerId, viewerId, ...friends, viewerId, viewerId, viewerId, viewerId, viewerId, limit,
  );
  if (rows.length === 0) {
    const fallback = all(
      `SELECT * FROM users WHERE status = 'active' AND id != ?
       AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
       ORDER BY last_seen_at DESC LIMIT ?`, viewerId, viewerId, limit,
    );
    return ok(res, { items: fallback.map((u) => ({ ...profilePayload(u, viewerId), mutual: 0 })).filter((u) => !u.limited) });
  }
  ok(res, { items: rows.map((u) => ({ ...profilePayload(u, viewerId), mutual: u.mutual })).filter((u) => !u.limited) });
}));

router.get('/users/:idOrUsername', wrap(async (req, res) => {
  const key = String(req.params.idOrUsername);
  const user = get('SELECT * FROM users WHERE id = ? OR username = ?', key, key.toLowerCase());
  if (!user || user.status === 'deleted') throw notFound('Không tìm thấy người dùng');
  if (isBlocked(req.user?.user_id, user.id)) throw forbidden('Không thể xem hồ sơ này');
  if (req.user && req.user.user_id !== user.id) track(req.user.user_id, 'profile_view', 'user', user.id);
  ok(res, { user: profilePayload(user, req.user?.user_id || null) });
}));

router.patch('/users/me', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  const fields = [];
  const params = [];
  const set = (col, value) => { fields.push(`${col} = ?`); params.push(value); };
  if (req.body.display_name !== undefined) set('display_name', v.str(req.body.display_name, { field: 'Tên hiển thị', min: 1, max: 80 }));
  if (req.body.bio !== undefined) set('bio', v.str(req.body.bio, { field: 'Bio', max: 500, required: false }));
  if (req.body.birthday !== undefined) set('birthday', v.date(req.body.birthday, 'Ngày sinh', false));
  if (req.body.gender !== undefined) set('gender', v.optionalStr(req.body.gender, { field: 'Giới tính', max: 30 }));
  if (req.body.locale !== undefined) set('locale', v.oneOf(req.body.locale, ['vi', 'en', 'es', 'fr', 'ja', 'zh'], 'locale'));
  if (req.body.timezone !== undefined) set('timezone', v.str(req.body.timezone, { field: 'Múi giờ', max: 60 }));
  if (req.body.avatar_url !== undefined) set('avatar_url', v.optionalStr(req.body.avatar_url, { field: 'Avatar', max: 500 }));
  if (req.body.cover_url !== undefined) set('cover_url', v.optionalStr(req.body.cover_url, { field: 'Ảnh bìa', max: 500 }));
  if (req.body.username !== undefined) {
    const uname = v.username(req.body.username);
    const other = get('SELECT id FROM users WHERE username = ? AND id != ?', uname, user.id);
    if (other) throw conflict('Username đã được sử dụng');
    set('username', uname);
  }
  if (fields.length === 0) return ok(res, { user: selfUser(user) });
  set('updated_at', now());
  params.push(user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  ok(res, { user: selfUser(get('SELECT * FROM users WHERE id = ?', user.id)) });
}));

router.get('/users/:id/friends', wrap(async (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ? OR username = ?', req.params.id, String(req.params.id).toLowerCase());
  if (!target) throw notFound('Không tìm thấy người dùng');
  if (!canViewProfile(target.id, req.user?.user_id || null)) throw forbidden('Hồ sơ này được bảo vệ');
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT u.* FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?) AND u.status = 'active'
     ORDER BY u.display_name LIMIT ? OFFSET ?`,
    target.id, target.id, target.id, limit, offset,
  );
  ok(res, { items: rows.map((u) => profilePayload(u, req.user?.user_id || null)), limit, offset });
}));

router.get('/friends', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT u.* FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?) AND u.status = 'active'
     ORDER BY u.display_name LIMIT ? OFFSET ?`,
    req.user.user_id, req.user.user_id, req.user.user_id, limit, offset,
  );
  ok(res, { items: rows.map((u) => profilePayload(u, req.user.user_id)), total: get("SELECT COUNT(*) AS c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", req.user.user_id, req.user.user_id).c });
}));

router.get('/friends/requests', requireAuth, wrap(async (req, res) => {
  const incoming = all(
    `SELECT f.*, u.username, u.display_name, u.avatar_url, u.bio FROM friendships f
     JOIN users u ON u.id = f.requester_id WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`,
    req.user.user_id,
  );
  const outgoing = all(
    `SELECT f.*, u.username, u.display_name, u.avatar_url, u.bio FROM friendships f
     JOIN users u ON u.id = f.addressee_id WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC`,
    req.user.user_id,
  );
  ok(res, { incoming, outgoing });
}));

router.post('/friends/requests/:userId', requireAuth, wrap(async (req, res) => {
  const targetId = req.params.userId;
  if (targetId === req.user.user_id) throw badRequest('Không thể tự kết bạn');
  const target = get("SELECT * FROM users WHERE id = ? AND status = 'active'", targetId);
  if (!target) throw notFound('Không tìm thấy người dùng');
  if (isBlocked(req.user.user_id, targetId)) throw forbidden('Không thể gửi lời mời');
  const privacy = get('SELECT friend_request_policy FROM privacy_settings WHERE user_id = ?', targetId);
  if ((privacy?.friend_request_policy || 'everyone') === 'nobody') throw forbidden('Người này không nhận lời mời kết bạn');
  if (areFriends(req.user.user_id, targetId)) return ok(res, { status: 'friends' });
  const existing = get(
    'SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    req.user.user_id, targetId, targetId, req.user.user_id,
  );
  if (existing) {
    if (existing.status === 'pending' && existing.addressee_id === req.user.user_id) {
      db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now(), existing.id);
      notify({ userId: targetId, kind: 'friend_accept', actorId: req.user.user_id, targetType: 'user', targetId: req.user.user_id });
      return ok(res, { status: 'friends' });
    }
    if (existing.status === 'pending') return ok(res, { status: 'request_sent' });
    if (existing.status === 'declined') {
      db.prepare("UPDATE friendships SET status = 'pending', requester_id = ?, addressee_id = ?, updated_at = ? WHERE id = ?")
        .run(req.user.user_id, targetId, now(), existing.id);
      return ok(res, { status: 'request_sent' });
    }
  }
  db.prepare('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.user_id, targetId, 'pending', now(), now());
  notify({ userId: targetId, kind: 'friend_request', actorId: req.user.user_id, targetType: 'user', targetId: req.user.user_id });
  track(req.user.user_id, 'friend_request', 'user', targetId);
  ok(res, { status: 'request_sent' }, 201);
}));

router.post('/friends/requests/:userId/accept', requireAuth, wrap(async (req, res) => {
  const row = get("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", req.params.userId, req.user.user_id);
  if (!row) throw notFound('Không có lời mời kết bạn');
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now(), row.id);
  notify({ userId: row.requester_id, kind: 'friend_accept', actorId: req.user.user_id, targetType: 'user', targetId: req.user.user_id });
  ok(res, { status: 'friends' });
}));

router.post('/friends/requests/:userId/decline', requireAuth, wrap(async (req, res) => {
  const row = get("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'", req.params.userId, req.user.user_id);
  if (!row) throw notFound('Không có lời mời kết bạn');
  db.prepare("UPDATE friendships SET status = 'declined', updated_at = ? WHERE id = ?").run(now(), row.id);
  ok(res, { status: 'declined' });
}));

router.delete('/friends/:userId', requireAuth, wrap(async (req, res) => {
  db.prepare(
    `DELETE FROM friendships WHERE status = 'accepted' AND
     ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
  ).run(req.user.user_id, req.params.userId, req.params.userId, req.user.user_id);
  noContent(res);
}));

router.post('/follows/:userId', requireAuth, wrap(async (req, res) => {
  const target = get("SELECT id FROM users WHERE id = ? AND status = 'active'", req.params.userId);
  if (!target) throw notFound('Không tìm thấy người dùng');
  if (target.id === req.user.user_id) throw badRequest('Không thể tự theo dõi');
  if (isBlocked(req.user.user_id, target.id)) throw forbidden('Không thể theo dõi');
  db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(req.user.user_id, target.id, now());
  notify({ userId: target.id, kind: 'follow', actorId: req.user.user_id, targetType: 'user', targetId: req.user.user_id });
  ok(res, { following: true });
}));

router.delete('/follows/:userId', requireAuth, wrap(async (req, res) => {
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.user_id, req.params.userId);
  noContent(res);
}));

router.get('/users/:id/followers', wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    'SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?',
    req.params.id, limit, offset,
  );
  ok(res, { items: rows.map((u) => profilePayload(u, req.user?.user_id || null)) });
}));

router.get('/users/:id/following', wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    'SELECT u.* FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?',
    req.params.id, limit, offset,
  );
  ok(res, { items: rows.map((u) => profilePayload(u, req.user?.user_id || null)) });
}));

router.get('/blocks', requireAuth, wrap(async (req, res) => {
  const rows = all('SELECT u.*, b.created_at AS blocked_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC', req.user.user_id);
  ok(res, { items: rows.map((u) => ({ ...profilePayload(u, req.user.user_id), blocked_at: u.blocked_at })) });
}));

router.post('/blocks/:userId', requireAuth, wrap(async (req, res) => {
  if (req.params.userId === req.user.user_id) throw badRequest('Không thể tự chặn mình');
  const target = get('SELECT id FROM users WHERE id = ?', req.params.userId);
  if (!target) throw notFound('Không tìm thấy người dùng');
  db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(req.user.user_id, target.id, now());
  db.prepare('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
    .run(req.user.user_id, target.id, target.id, req.user.user_id);
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)')
    .run(req.user.user_id, target.id, target.id, req.user.user_id);
  ok(res, { blocked: true });
}));

router.delete('/blocks/:userId', requireAuth, wrap(async (req, res) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.user_id, req.params.userId);
  noContent(res);
}));

export default router;
export { profilePayload, relationship };
