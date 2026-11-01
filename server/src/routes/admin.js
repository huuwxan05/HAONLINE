import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { config } from '../config.js';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { publicUser, selfUser, audit, track } from '../lib/social.js';
import { onlineCount } from '../lib/realtime.js';
import { pushStatus } from '../lib/push.js';

const router = Router();
const admin = [requireAuth, requireRole('admin')];
const staff = [requireAuth, requireRole('admin', 'moderator')];

router.get('/admin/dashboard', ...staff, wrap(async (req, res) => {
  const today = new Date(Date.now() - 86400000).toISOString();
  const counts = (sql, ...params) => get(sql, ...params).c;
  ok(res, {
    users: {
      total: counts("SELECT COUNT(*) AS c FROM users WHERE status != 'deleted'"),
      active: counts("SELECT COUNT(*) AS c FROM users WHERE status = 'active'"),
      new_24h: counts("SELECT COUNT(*) AS c FROM users WHERE created_at >= ?", today),
      online: onlineCount(),
      suspended: counts("SELECT COUNT(*) AS c FROM users WHERE status = 'suspended'"),
    },
    content: {
      posts: counts('SELECT COUNT(*) AS c FROM posts WHERE deleted_at IS NULL'),
      comments: counts('SELECT COUNT(*) AS c FROM comments WHERE deleted_at IS NULL'),
      reactions: counts('SELECT COUNT(*) AS c FROM reactions'),
      stories: counts('SELECT COUNT(*) AS c FROM stories WHERE deleted_at IS NULL AND expires_at > ?', now()),
      reels: counts('SELECT COUNT(*) AS c FROM reels WHERE deleted_at IS NULL'),
      videos: counts('SELECT COUNT(*) AS c FROM videos WHERE deleted_at IS NULL'),
      messages: counts('SELECT COUNT(*) AS c FROM messages WHERE deleted_at IS NULL'),
      live_now: counts("SELECT COUNT(*) AS c FROM live_streams WHERE status = 'live'"),
    },
    communities: {
      groups: counts('SELECT COUNT(*) AS c FROM groups'),
      pages: counts('SELECT COUNT(*) AS c FROM pages'),
      events: counts('SELECT COUNT(*) AS c FROM events WHERE deleted_at IS NULL'),
      products: counts("SELECT COUNT(*) AS c FROM products WHERE status = 'active' AND deleted_at IS NULL"),
    },
    moderation: {
      open_reports: counts("SELECT COUNT(*) AS c FROM reports WHERE status IN ('open','reviewing')"),
      reports_24h: counts('SELECT COUNT(*) AS c FROM reports WHERE created_at >= ?', today),
    },
    monetization: {
      revenue_cents: counts("SELECT COALESCE(SUM(amount_cents),0) AS c FROM transactions WHERE status = 'completed' AND kind IN ('ad_spend','subscription')"),
      earnings_pending_cents: counts("SELECT COALESCE(SUM(amount_cents),0) AS c FROM creator_earnings WHERE status = 'pending'"),
      earnings_available_cents: counts("SELECT COALESCE(SUM(amount_cents),0) AS c FROM creator_earnings WHERE status = 'available'"),
      payouts_pending_cents: counts("SELECT COALESCE(SUM(amount_cents),0) AS c FROM payouts WHERE status IN ('requested','processing')"),
    },
    system: {
      version: config.version,
      env: config.env,
      uptime_seconds: Math.floor(process.uptime()),
      database_bytes: fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0,
      push: pushStatus(),
      payments_configured: Boolean(config.payments.stripeSecret),
    },
    generated_at: now(),
  });
}));

router.get('/admin/users', ...staff, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const clauses = ['1 = 1'];
  const params = [];
  if (req.query.q) {
    clauses.push('(username LIKE ? OR email LIKE ? OR display_name LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.role) { clauses.push('role = ?'); params.push(v.oneOf(req.query.role, ['user', 'moderator', 'admin'], 'role')); }
  if (req.query.status) { clauses.push('status = ?'); params.push(v.oneOf(req.query.status, ['active', 'suspended', 'deleted'], 'status')); }
  const rows = all(`SELECT * FROM users WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  ok(res, {
    items: rows.map((u) => ({ ...selfUser(u), posted: get('SELECT COUNT(*) AS c FROM posts WHERE author_id = ?', u.id).c, reports: get("SELECT COUNT(*) AS c FROM reports WHERE target_type = 'user' AND target_id = ?", u.id).c })),
    total: get(`SELECT COUNT(*) AS c FROM users WHERE ${clauses.join(' AND ')}`, ...params).c,
    limit, offset,
  });
}));

router.patch('/admin/users/:id', ...admin, wrap(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('Không tìm thấy người dùng');
  if (user.id === req.user.user_id && req.body.role && req.body.role !== 'admin') throw badRequest('Không thể tự hạ quyền chính mình');
  const updates = [];
  const params = [];
  if (req.body.role !== undefined) { updates.push('role = ?'); params.push(v.oneOf(req.body.role, ['user', 'moderator', 'admin'], 'role')); }
  if (req.body.status !== undefined) {
    const status = v.oneOf(req.body.status, ['active', 'suspended'], 'status');
    updates.push('status = ?');
    params.push(status);
    if (status === 'suspended') db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), user.id);
  }
  if (req.body.email_verified !== undefined) { updates.push('email_verified = ?'); params.push(v.bool(req.body.email_verified) ? 1 : 0); }
  if (!updates.length) return ok(res, { user: selfUser(user) });
  updates.push('updated_at = ?');
  params.push(now(), user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  audit(req.user.user_id, 'admin_user_update', 'user', user.id, req.body);
  ok(res, { user: selfUser(get('SELECT * FROM users WHERE id = ?', user.id)) });
}));

router.get('/admin/audit', ...staff, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT a.*, u.username, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, limit, offset,
  );
  ok(res, { items: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null, actor: r.username ? { id: r.actor_id, username: r.username, display_name: r.display_name } : null })) });
}));

router.get('/admin/errors', ...staff, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  const rows = all('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?', limit);
  ok(res, { items: rows.map((r) => ({ ...r, context: r.context ? JSON.parse(r.context) : null })) });
}));

router.delete('/admin/errors', ...admin, wrap(async (req, res) => {
  db.prepare('DELETE FROM error_logs').run();
  noContent(res);
}));

router.get('/admin/health', ...staff, wrap(async (req, res) => {
  let integrity = 'unknown';
  try {
    integrity = get('PRAGMA integrity_check').integrity_check;
  } catch (err) {
    integrity = `error: ${err.message}`;
  }
  const memory = process.memoryUsage();
  ok(res, {
    status: integrity === 'ok' ? 'healthy' : 'degraded',
    version: config.version,
    env: config.env,
    uptime_seconds: Math.floor(process.uptime()),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    memory: { rss: memory.rss, heap_used: memory.heapUsed, heap_total: memory.heapTotal },
    database: {
      path: config.dbPath,
      bytes: fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0,
      integrity,
    },
    online_users: onlineCount(),
    pending_jobs: get("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued','processing')").c,
    failed_jobs: get("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'").c,
    email_queued: get("SELECT COUNT(*) AS c FROM email_outbox WHERE status = 'queued'").c,
    push: pushStatus(),
  });
}));

router.get('/admin/jobs', ...staff, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  ok(res, { items: all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', limit) });
}));

router.get('/admin/email-outbox', ...admin, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  ok(res, { items: all('SELECT id, to_email, subject, status, error, created_at FROM email_outbox ORDER BY created_at DESC LIMIT ?', limit) });
}));

router.get('/admin/backups', ...admin, wrap(async (req, res) => {
  const rows = all('SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 100');
  ok(res, { items: rows });
}));

router.post('/admin/backups', ...admin, wrap(async (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(config.backupDir, `haonline-${stamp}.db`);
  let status = 'completed';
  try {
    await backup(db, target);
  } catch (err) {
    try {
      fs.copyFileSync(config.dbPath, target);
    } catch (copyErr) {
      status = 'failed';
      db.prepare('INSERT INTO backup_log (id, path, size, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), target, 0, 'failed', now());
      throw new Error(`Backup failed: ${err.message} / ${copyErr.message}`);
    }
  }
  const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
  const backupId = crypto.randomUUID();
  db.prepare('INSERT INTO backup_log (id, path, size, status, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(backupId, target, size, status, now());
  audit(req.user.user_id, 'backup_create', 'backup', backupId, { path: target, size });
  created(res, { backup: { id: backupId, path: target, size, status } });
}));

router.get('/admin/settings', ...admin, wrap(async (req, res) => {
  const rows = all('SELECT * FROM app_settings ORDER BY key');
  const settings = {};
  for (const row of rows) {
    try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
  }
  ok(res, { settings });
}));

router.patch('/admin/settings', ...admin, wrap(async (req, res) => {
  const values = req.body.settings || req.body;
  const allowed = ['site_name', 'registration_open', 'maintenance_mode', 'moderation_notice', 'max_upload_mb', 'feature_live', 'feature_calls', 'feature_marketplace'];
  const stmt = db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  let updated = 0;
  for (const key of allowed) {
    if (values[key] === undefined) continue;
    stmt.run(key, JSON.stringify(values[key]), now());
    updated += 1;
  }
  audit(req.user.user_id, 'admin_settings_update', 'settings', null, values);
  ok(res, { updated });
}));

router.get('/admin/analytics', ...staff, wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const dailyUsers = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`, since,
  );
  const dailyPosts = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM posts WHERE created_at >= ? GROUP BY day ORDER BY day`, since,
  );
  const dailyMessages = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM messages WHERE created_at >= ? GROUP BY day ORDER BY day`, since,
  );
  const dailyActive = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(DISTINCT user_id) AS c FROM analytics_events WHERE created_at >= ? AND user_id IS NOT NULL GROUP BY day ORDER BY day`, since,
  );
  const topPosts = all(
    `SELECT p.id, p.body, p.created_at, u.username, u.display_name,
       (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.id) AS reactions,
       (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments
     FROM posts p JOIN users u ON u.id = p.author_id WHERE p.deleted_at IS NULL AND p.created_at >= ?
     ORDER BY reactions DESC, comments DESC LIMIT 10`, since,
  );
  const eventTypes = all(
    `SELECT type, COUNT(*) AS c FROM analytics_events WHERE created_at >= ? GROUP BY type ORDER BY c DESC LIMIT 20`, since,
  );
  ok(res, { days, users: dailyUsers, posts: dailyPosts, messages: dailyMessages, active_users: dailyActive, top_posts: topPosts, event_types: eventTypes });
}));

router.post('/admin/monetization/credit', ...admin, wrap(async (req, res) => {
  const userId = v.str(req.body.user_id, { field: 'user_id' });
  const amount = v.int(req.body.amount_cents, { field: 'amount_cents', min: 1 });
  const user = get('SELECT id FROM users WHERE id = ?', userId);
  if (!user) throw notFound('Không tìm thấy người dùng');
  const earningId = crypto.randomUUID();
  db.prepare('INSERT INTO creator_earnings (id, user_id, amount_cents, currency, source, status, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(earningId, userId, amount, config.payments.currency, v.optionalStr(req.body.source, { field: 'source', max: 60 }) || 'admin_credit', 'available', req.user.user_id, now());
  audit(req.user.user_id, 'monetization_credit', 'user', userId, { amount_cents: amount });
  created(res, { earning: get('SELECT * FROM creator_earnings WHERE id = ?', earningId) });
}));

export default router;
