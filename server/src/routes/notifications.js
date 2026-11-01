import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { requireAuth, resolveToken } from '../lib/auth.js';
import { addClient, sendTo, onlineCount } from '../lib/realtime.js';
import { pushStatus } from '../lib/push.js';
import { publicUser } from '../lib/social.js';

const router = Router();

function notifPayload(row) {
  return {
    id: row.id,
    kind: row.kind,
    actor: row.actor_id ? { id: row.actor_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url } : null,
    target_type: row.target_type,
    target_id: row.target_id,
    data: row.data ? JSON.parse(row.data) : null,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

router.get('/stream', wrap(async (req, res) => {
  const session = resolveToken(req.query.token);
  if (!session) return res.status(401).json({ error: { code: 'unauthorized', message: 'Cần đăng nhập' } });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const cleanup = addClient(session.user_id, res);
  req.on('close', cleanup);
  req.on('error', cleanup);
}));

router.get('/notifications', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const unread = req.query.unread === 'true';
  const clauses = ['n.user_id = ?'];
  const params = [req.user.user_id];
  if (unread) clauses.push('n.read_at IS NULL');
  if (req.query.kind) { clauses.push('n.kind = ?'); params.push(String(req.query.kind)); }
  const rows = all(
    `SELECT n.*, u.username, u.display_name, u.avatar_url FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id WHERE ${clauses.join(' AND ')}
     ORDER BY n.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  ok(res, {
    items: rows.map(notifPayload),
    unread: get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.user_id).c,
    total: get(`SELECT COUNT(*) AS c FROM notifications n WHERE ${clauses.join(' AND ')}`, ...params).c,
    limit, offset,
  });
}));

router.post('/notifications/:id/read', requireAuth, wrap(async (req, res) => {
  const row = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', req.params.id, req.user.user_id);
  if (!row) throw notFound('Không tìm thấy thông báo');
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(row.read_at || now(), row.id);
  ok(res, { ok: true });
}));

router.post('/notifications/read-all', requireAuth, wrap(async (req, res) => {
  const result = db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.user_id);
  ok(res, { updated: result.changes });
}));

router.delete('/notifications/:id', requireAuth, wrap(async (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.user_id);
  noContent(res);
}));

router.get('/notifications/push/status', requireAuth, wrap(async (req, res) => {
  ok(res, {
    ...pushStatus(),
    subscriptions: get('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?', req.user.user_id).c,
  });
}));

router.post('/notifications/push/subscribe', requireAuth, wrap(async (req, res) => {
  const endpoint = v.str(req.body.endpoint, { field: 'endpoint', min: 10, max: 2000 });
  const keys = req.body.keys || {};
  const p256dh = v.optionalStr(keys.p256dh || req.body.p256dh, { field: 'p256dh', max: 500 });
  const auth = v.optionalStr(keys.auth || req.body.auth, { field: 'auth', max: 500 });
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(crypto.randomUUID(), req.user.user_id, endpoint, p256dh, auth, now());
  ok(res, { subscribed: true });
}));

router.delete('/notifications/push/subscribe', requireAuth, wrap(async (req, res) => {
  const endpoint = req.body?.endpoint || req.query.endpoint;
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(endpoint), req.user.user_id);
  else db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.user_id);
  noContent(res);
}));

router.get('/presence', requireAuth, wrap(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 100);
  if (!ids.length) return ok(res, { online: onlineCount() });
  const rows = all(`SELECT id, last_seen_at FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  ok(res, {
    online: onlineCount(),
    users: rows.map((u) => ({ id: u.id, online: Date.now() - new Date(u.last_seen_at || 0).getTime() < 5 * 60000, last_seen_at: u.last_seen_at })),
  });
}));

router.post('/presence/ping', requireAuth, wrap(async (req, res) => {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), req.user.user_id);
  ok(res, { ok: true });
}));

export default router;
