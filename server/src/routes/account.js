import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { requireAuth, revokeAllSessions } from '../lib/auth.js';
import { verifyPassword, hashPassword, generateTotpSecret, totpUri, verifyTotp } from '../lib/security.js';
import { canViewPost, publicUser, selfUser, isBlocked } from '../lib/social.js';
import { loadPosts, fetchPostRow } from './posts.js';

const router = Router();

const SETTINGS_KEYS = [
  'theme', 'language', 'notifications_email', 'notifications_push', 'autoplay_reels',
  'font_size', 'reduce_motion', 'profile_visibility_default', 'show_online_status',
];

router.get('/bookmarks', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const type = req.query.type ? String(req.query.type) : null;
  const clauses = ['b.user_id = ?'];
  const params = [req.user.user_id];
  if (type) { clauses.push('b.target_type = ?'); params.push(type); }
  const rows = all(
    `SELECT b.* FROM bookmarks b WHERE ${clauses.join(' AND ')} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset,
  );
  const items = [];
  const postIds = rows.filter((r) => r.target_type === 'post').map((r) => r.target_id);
  let postMap = new Map();
  if (postIds.length) {
    const postRows = all(`SELECT p.* FROM posts p WHERE p.id IN (${postIds.map(() => '?').join(',')}) AND p.deleted_at IS NULL`, ...postIds);
    postMap = new Map(loadPosts(postRows, req.user.user_id).map((p) => [p.id, p]));
  }
  for (const row of rows) {
    let target = null;
    if (row.target_type === 'post') target = postMap.get(row.target_id) || null;
    else if (row.target_type === 'video') {
      const vid = get('SELECT v.*, u.username, u.display_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.owner_id WHERE v.id = ? AND v.deleted_at IS NULL', row.target_id);
      target = vid ? { ...vid, author: { ...publicUser(vid), id: vid.owner_id } } : null;
    } else if (row.target_type === 'reel') {
      const reel = get('SELECT r.*, u.username, u.display_name, u.avatar_url FROM reels r JOIN users u ON u.id = r.author_id WHERE r.id = ? AND r.deleted_at IS NULL', row.target_id);
      target = reel ? { ...reel, author: { ...publicUser(reel), id: reel.author_id } } : null;
    } else if (row.target_type === 'product') {
      const product = get('SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id = ? AND p.deleted_at IS NULL', row.target_id);
      target = product ? { ...product, seller: { ...publicUser(product), id: product.seller_id }, media: all('SELECT * FROM product_media WHERE product_id = ? ORDER BY position', product.id) } : null;
    }
    if (target) items.push({ id: row.id, target_type: row.target_type, target_id: row.target_id, created_at: row.created_at, target });
  }
  ok(res, { items, total: get(`SELECT COUNT(*) AS c FROM bookmarks b WHERE ${clauses.join(' AND ')}`, ...params).c });
}));

router.post('/bookmarks', requireAuth, wrap(async (req, res) => {
  const targetType = v.oneOf(req.body.target_type, ['post', 'video', 'reel', 'product'], 'target_type');
  const targetId = v.str(req.body.target_id, { field: 'target_id', min: 1, max: 64 });
  const table = { post: 'posts', video: 'videos', reel: 'reels', product: 'products' }[targetType];
  const target = get(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, targetId);
  if (!target) throw notFound('Không tìm thấy nội dung');
  if (targetType === 'post' && !canViewPost(target, req.user.user_id)) throw forbidden('Không thể lưu bài viết này');
  db.prepare('INSERT INTO bookmarks (id, user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(crypto.randomUUID(), req.user.user_id, targetType, targetId, now());
  ok(res, { bookmarked: true }, 201);
}));

router.delete('/bookmarks/:type/:id', requireAuth, wrap(async (req, res) => {
  const type = v.oneOf(req.params.type, ['post', 'video', 'reel', 'product'], 'type');
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND target_type = ? AND target_id = ?').run(req.user.user_id, type, req.params.id);
  noContent(res);
}));

router.get('/memories', requireAuth, wrap(async (req, res) => {
  const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(5, 10);
  if (!/^\d{2}-\d{2}$/.test(date)) throw badRequest('date phải có dạng MM-DD');
  const currentYear = new Date().getUTCFullYear();
  const rows = all(
    `SELECT p.* FROM posts p WHERE p.author_id = ? AND p.deleted_at IS NULL AND p.status = 'active'
     AND substr(p.created_at, 6, 5) = ? AND CAST(substr(p.created_at, 1, 4) AS INTEGER) < ?
     ORDER BY p.created_at DESC LIMIT 50`,
    req.user.user_id, date, currentYear,
  );
  const items = loadPosts(rows, req.user.user_id);
  const byYear = {};
  for (const post of items) {
    const year = post.created_at.slice(0, 4);
    byYear[year] = byYear[year] || [];
    byYear[year].push(post);
  }
  ok(res, { date, items, by_year: byYear, total: items.length });
}));

router.get('/privacy', requireAuth, wrap(async (req, res) => {
  const privacy = get('SELECT * FROM privacy_settings WHERE user_id = ?', req.user.user_id);
  const blocked = all('SELECT blocked_id, created_at FROM blocks WHERE blocker_id = ?', req.user.user_id);
  ok(res, { privacy, blocked });
}));

router.patch('/privacy', requireAuth, wrap(async (req, res) => {
  const current = get('SELECT * FROM privacy_settings WHERE user_id = ?', req.user.user_id);
  const fields = [];
  const params = [];
  const enumField = (col, allowed) => {
    if (req.body[col] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(v.oneOf(req.body[col], allowed, col));
    }
  };
  enumField('profile_visibility', ['public', 'friends', 'private']);
  enumField('post_default_visibility', ['public', 'friends', 'private']);
  enumField('friend_request_policy', ['everyone', 'friends_of_friends', 'nobody']);
  enumField('who_can_message', ['everyone', 'friends', 'none']);
  enumField('who_can_tag', ['everyone', 'friends', 'nobody']);
  for (const col of ['searchable', 'show_activity', 'allow_data_export']) {
    if (req.body[col] !== undefined) {
      fields.push(`${col} = ?`);
      params.push(v.bool(req.body[col]) ? 1 : 0);
    }
  }
  if (!fields.length) return ok(res, { privacy: current });
  fields.push('updated_at = ?');
  params.push(now(), req.user.user_id);
  db.prepare(`UPDATE privacy_settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...params);
  ok(res, { privacy: get('SELECT * FROM privacy_settings WHERE user_id = ?', req.user.user_id) });
}));

function buildExport(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  const data = {
    exported_at: now(),
    format_version: 1,
    account: selfUser(user),
    privacy: get('SELECT * FROM privacy_settings WHERE user_id = ?', userId),
    settings: db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId),
    posts: all('SELECT * FROM posts WHERE author_id = ?', userId),
    post_media: all('SELECT pm.* FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.author_id = ?', userId),
    comments: all('SELECT * FROM comments WHERE author_id = ?', userId),
    reactions: all('SELECT * FROM reactions WHERE user_id = ?', userId),
    stories: all('SELECT * FROM stories WHERE author_id = ?', userId),
    reels: all('SELECT * FROM reels WHERE author_id = ?', userId),
    videos: all('SELECT * FROM videos WHERE owner_id = ?', userId),
    friends: all("SELECT * FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", userId, userId),
    friend_requests: all('SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?', userId, userId),
    follows: all('SELECT * FROM follows WHERE follower_id = ? OR following_id = ?', userId, userId),
    conversations: all('SELECT * FROM conversations WHERE id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?)', userId),
    messages: all('SELECT * FROM messages WHERE sender_id = ?', userId),
    calls: all('SELECT * FROM calls WHERE caller_id = ? OR callee_id = ?', userId, userId),
    groups: all('SELECT * FROM group_members WHERE user_id = ?', userId),
    pages: all('SELECT * FROM page_followers WHERE user_id = ?', userId),
    events: all('SELECT * FROM event_attendees WHERE user_id = ?', userId),
    bookmarks: all('SELECT * FROM bookmarks WHERE user_id = ?', userId),
    notifications: all('SELECT * FROM notifications WHERE user_id = ?', userId),
    sessions: all('SELECT id, device, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at FROM sessions WHERE user_id = ?', userId),
    login_history: all('SELECT * FROM login_history WHERE user_id = ?', userId),
    transactions: all('SELECT * FROM transactions WHERE user_id = ?', userId),
    earnings: all('SELECT * FROM creator_earnings WHERE user_id = ?', userId),
  };
  const filename = `export-${userId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(config.uploadsDir, filename), JSON.stringify(data, null, 2));
  return `/uploads/${filename}`;
}

router.post('/privacy/export', requireAuth, wrap(async (req, res) => {
  const privacy = get('SELECT allow_data_export FROM privacy_settings WHERE user_id = ?', req.user.user_id);
  if (privacy && privacy.allow_data_export === 0) throw forbidden('Tính năng xuất dữ liệu đang tắt');
  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (id, user_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(jobId, req.user.user_id, 'data_export', 'processing', now(), now());
  try {
    const url = buildExport(req.user.user_id);
    db.prepare("UPDATE jobs SET status = 'completed', result_url = ?, updated_at = ? WHERE id = ?").run(url, now(), jobId);
    created(res, { job: { id: jobId, status: 'completed', result_url: url } });
  } catch (err) {
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(String(err.message), now(), jobId);
    throw err;
  }
}));

router.get('/privacy/export/:jobId', requireAuth, wrap(async (req, res) => {
  const job = get('SELECT * FROM jobs WHERE id = ? AND user_id = ? AND kind = ?', req.params.jobId, req.user.user_id, 'data_export');
  if (!job) throw notFound('Không tìm thấy yêu cầu');
  ok(res, { job });
}));

router.post('/privacy/delete-account', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  if (!verifyPassword(String(req.body.password || ''), user.password_hash)) throw unauthorized('Mật khẩu không đúng');
  if (req.body.confirm !== user.username && req.body.confirm !== 'DELETE') throw badRequest('Nhập username hoặc DELETE để xác nhận');
  const ts = now();
  const anonymized = `deleted_${user.id.slice(0, 8)}`;
  db.prepare(
    `UPDATE users SET status = 'deleted', deleted_at = ?, email = ?, phone = NULL, username = ?,
     display_name = 'Tài khoản đã xóa', bio = '', avatar_url = NULL, cover_url = NULL,
     password_hash = ?, twofa_enabled = 0, twofa_secret = NULL, updated_at = ? WHERE id = ?`,
  ).run(ts, `deleted+${user.id}@invalid.local`, anonymized, hashPassword(crypto.randomUUID()), ts, user.id);
  revokeAllSessions(user.id);
  db.prepare("UPDATE posts SET visibility = 'private' WHERE author_id = ?").run(user.id);
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(user.id, user.id);
  db.prepare("UPDATE friendships SET status = 'declined' WHERE requester_id = ? OR addressee_id = ?").run(user.id, user.id);
  db.prepare('INSERT INTO jobs (id, user_id, kind, status, result_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), user.id, 'account_deletion', 'completed', null, ts, ts);
  ok(res, { deleted: true, purge_after_days: 30 });
}));

router.get('/security/sessions', requireAuth, wrap(async (req, res) => {
  const rows = all(
    `SELECT id, device, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
    req.user.user_id, now(),
  );
  ok(res, { items: rows.map((s) => ({ ...s, current: s.id === req.sessionId })) });
}));

router.delete('/security/sessions/:id', requireAuth, wrap(async (req, res) => {
  const session = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', req.params.id, req.user.user_id);
  if (!session) throw notFound('Không tìm thấy phiên');
  if (session.id === req.sessionId) throw badRequest('Dùng đăng xuất để kết thúc phiên hiện tại');
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now(), session.id);
  noContent(res);
}));

router.post('/security/sessions/revoke-all', requireAuth, wrap(async (req, res) => {
  revokeAllSessions(req.user.user_id, req.sessionId);
  ok(res, { ok: true });
}));

router.get('/security/login-history', requireAuth, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  const rows = all('SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', req.user.user_id, limit);
  ok(res, { items: rows });
}));

router.post('/security/password', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  if (!verifyPassword(String(req.body.current_password || ''), user.password_hash)) throw unauthorized('Mật khẩu hiện tại không đúng');
  const next = v.password(req.body.new_password);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(next), now(), user.id);
  revokeAllSessions(user.id, req.sessionId);
  ok(res, { ok: true });
}));

router.get('/security/2fa', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT twofa_enabled FROM users WHERE id = ?', req.user.user_id);
  ok(res, { enabled: !!user.twofa_enabled });
}));

router.post('/security/2fa/setup', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  const secret = generateTotpSecret();
  db.prepare('UPDATE users SET twofa_secret = ?, updated_at = ? WHERE id = ?').run(secret, now(), user.id);
  ok(res, { secret, otpauth_uri: totpUri(secret, user.email), pending: true });
}));

router.post('/security/2fa/enable', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  if (!user.twofa_secret) throw badRequest('Chưa tạo mã 2FA');
  if (!verifyTotp(user.twofa_secret, String(req.body.code || ''))) throw badRequest('Mã 2FA không đúng');
  db.prepare('UPDATE users SET twofa_enabled = 1, updated_at = ? WHERE id = ?').run(now(), user.id);
  ok(res, { enabled: true });
}));

router.post('/security/2fa/disable', requireAuth, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.user_id);
  if (!verifyPassword(String(req.body.password || ''), user.password_hash)) throw unauthorized('Mật khẩu không đúng');
  db.prepare('UPDATE users SET twofa_enabled = 0, twofa_secret = NULL, updated_at = ? WHERE id = ?').run(now(), user.id);
  ok(res, { enabled: false });
}));

router.get('/settings', requireAuth, wrap(async (req, res) => {
  const rows = all('SELECT key, value FROM user_settings WHERE user_id = ?', req.user.user_id);
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }
  ok(res, { settings, supported: SETTINGS_KEYS });
}));

router.patch('/settings', requireAuth, wrap(async (req, res) => {
  const values = req.body.settings || req.body;
  const stmt = db.prepare('INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  let updated = 0;
  for (const key of SETTINGS_KEYS) {
    if (values[key] === undefined) continue;
    let value = values[key];
    if (key === 'theme') value = v.oneOf(value, ['dark', 'light', 'system'], 'theme');
    else if (key === 'language') value = v.oneOf(value, ['vi', 'en', 'es', 'fr', 'ja', 'zh'], 'language');
    else if (key === 'font_size') value = v.oneOf(value, ['small', 'medium', 'large'], 'font_size');
    else if (['notifications_email', 'notifications_push', 'autoplay_reels', 'reduce_motion', 'show_online_status'].includes(key)) value = v.bool(value);
    else value = v.str(String(value), { field: key, max: 200 });
    stmt.run(req.user.user_id, key, typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value), now());
    updated += 1;
  }
  ok(res, { updated, settings: db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(req.user.user_id) });
}));

export default router;
export { buildExport, SETTINGS_KEYS };
