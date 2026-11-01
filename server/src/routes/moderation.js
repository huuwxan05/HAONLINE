import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { notify, audit, publicUser, track } from '../lib/social.js';
import { rateLimit } from '../lib/rateLimit.js';

const router = Router();
const reportLimiter = rateLimit({ windowMs: 600000, max: 20 });

const TARGET_TABLES = {
  post: 'posts', comment: 'comments', user: 'users', product: 'products',
  reel: 'reels', video: 'videos', group: 'groups', page: 'pages', message: 'messages', live: 'live_streams',
};

function targetExists(type, targetId) {
  const table = TARGET_TABLES[type];
  if (!table) return null;
  return get(`SELECT * FROM ${table} WHERE id = ?`, targetId) || null;
}

function reportPayload(row) {
  return {
    id: row.id,
    reporter: row.reporter_username ? { id: row.reporter_id, username: row.reporter_username, display_name: row.reporter_display_name } : { id: row.reporter_id },
    target_type: row.target_type,
    target_id: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    action: row.action,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    reviews: row.reviewed_by ? { id: row.reviewed_by, username: row.reviewer_username, display_name: row.reviewer_display_name } : null,
  };
}

function removeTarget(type, targetId) {
  const ts = now();
  if (type === 'post') {
    db.prepare("UPDATE posts SET deleted_at = ?, status = 'removed', updated_at = ? WHERE id = ?").run(ts, ts, targetId);
  } else if (['reel', 'video', 'comment', 'product', 'story'].includes(type)) {
    if (type === 'reel') db.prepare('UPDATE reels SET deleted_at = ? WHERE id = ?').run(ts, targetId);
    if (type === 'video') db.prepare('UPDATE videos SET deleted_at = ? WHERE id = ?').run(ts, targetId);
    if (type === 'comment') db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(ts, targetId);
    if (type === 'product') db.prepare("UPDATE products SET deleted_at = ?, status = 'removed', updated_at = ? WHERE id = ?").run(ts, ts, targetId);
    if (type === 'story') db.prepare('UPDATE stories SET deleted_at = ? WHERE id = ?').run(ts, targetId);
  } else if (type === 'message') {
    db.prepare('UPDATE messages SET deleted_at = ?, body = ? WHERE id = ?').run(ts, '', targetId);
  } else if (type === 'user') {
    db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(ts, targetId);
  }
}

router.post('/reports', requireAuth, reportLimiter, wrap(async (req, res) => {
  const type = v.oneOf(req.body.target_type, Object.keys(TARGET_TABLES), 'target_type');
  const targetId = v.str(req.body.target_id, { field: 'target_id', min: 1, max: 64 });
  const target = targetExists(type, targetId);
  if (!target) throw notFound('Không tìm thấy nội dung bị báo cáo');
  const reason = v.str(req.body.reason, { field: 'Lý do', min: 2, max: 200 });
  const details = v.optionalStr(req.body.details, { field: 'Chi tiết', max: 2000 });
  const duplicate = get(
    "SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status IN ('open','reviewing')",
    req.user.user_id, type, targetId,
  );
  if (duplicate) return ok(res, { report: { id: duplicate.id, status: 'open' }, duplicate: true });
  const reportId = crypto.randomUUID();
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(reportId, req.user.user_id, type, targetId, reason, details, 'open', now());
  const moderators = all("SELECT id FROM users WHERE role IN ('admin','moderator') AND status = 'active'");
  for (const m of moderators) notify({ userId: m.id, kind: 'moderation_report', actorId: req.user.user_id, targetType: type, targetId });
  if (type === 'user' && targetId !== req.user.user_id) {
    notify({ userId: targetId, kind: 'report', actorId: req.user.user_id, targetType: type, targetId });
  }
  track(req.user.user_id, 'report_create', type, targetId, { reason });
  created(res, { report: { id: reportId, status: 'open' } });
}));

router.get('/moderation/reports', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const clauses = ['1 = 1'];
  const params = [];
  if (req.query.status) { clauses.push('r.status = ?'); params.push(v.oneOf(req.query.status, ['open', 'reviewing', 'resolved', 'rejected'], 'status')); }
  if (req.query.target_type) { clauses.push('r.target_type = ?'); params.push(String(req.query.target_type)); }
  const rows = all(
    `SELECT r.*, ru.username AS reporter_username, ru.display_name AS reporter_display_name,
       mu.username AS reviewer_username, mu.display_name AS reviewer_display_name
     FROM reports r
     LEFT JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN users mu ON mu.id = r.reviewed_by
     WHERE ${clauses.join(' AND ')} ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, r.created_at DESC
     LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  const counts = {};
  for (const row of all('SELECT status, COUNT(*) AS c FROM reports GROUP BY status')) counts[row.status] = row.c;
  ok(res, { items: rows.map(reportPayload), counts, limit, offset });
}));

router.get('/moderation/reports/:id', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  const row = get(
    `SELECT r.*, ru.username AS reporter_username, ru.display_name AS reporter_display_name,
       mu.username AS reviewer_username, mu.display_name AS reviewer_display_name
     FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users mu ON mu.id = r.reviewed_by
     WHERE r.id = ?`, req.params.id,
  );
  if (!row) throw notFound('Không tìm thấy báo cáo');
  ok(res, { report: reportPayload(row), target: targetExists(row.target_type, row.target_id) });
}));

router.patch('/moderation/reports/:id', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  const report = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!report) throw notFound('Không tìm thấy báo cáo');
  if (!['open', 'reviewing'].includes(report.status)) throw badRequest('Báo cáo đã được xử lý');
  const status = v.oneOf(req.body.status, ['reviewing', 'resolved', 'rejected'], 'status');
  const action = req.body.action ? v.oneOf(req.body.action, ['none', 'warn', 'remove', 'suspend_user', 'ban_user'], 'action') : 'none';
  const notes = v.optionalStr(req.body.notes, { field: 'Ghi chú', max: 2000 });
  if (status === 'resolved' && action === 'remove') {
    if (!['post', 'comment', 'reel', 'video', 'product', 'story', 'message', 'user'].includes(report.target_type)) {
      throw badRequest('Loại nội dung này chưa hỗ trợ xóa tự động, hãy dùng thao tác riêng hoặc đình chỉ tài khoản');
    }
    removeTarget(report.target_type, report.target_id);
  }
  if (status === 'resolved' && (action === 'suspend_user' || action === 'ban_user')) {
    const targetUserId = report.target_type === 'user' ? report.target_id
      : get(`SELECT author_id AS uid FROM posts WHERE id = ?`, report.target_id)?.uid
        || get(`SELECT owner_id AS uid FROM videos WHERE id = ?`, report.target_id)?.uid
        || get(`SELECT seller_id AS uid FROM products WHERE id = ?`, report.target_id)?.uid
        || get(`SELECT author_id AS uid FROM reels WHERE id = ?`, report.target_id)?.uid;
    if (targetUserId) {
      db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(now(), targetUserId);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), targetUserId);
    }
  }
  if (status === 'resolved' && action === 'warn') {
    const targetUserId = report.target_type === 'user' ? report.target_id : null;
    if (targetUserId) notify({ userId: targetUserId, kind: 'moderation_warning', data: { notes, report_id: report.id } });
  }
  db.prepare('UPDATE reports SET status = ?, action = ?, reviewed_by = ?, reviewed_at = ?, notes = ? WHERE id = ?')
    .run(status, action, req.user.user_id, now(), notes, report.id);
  db.prepare('INSERT INTO moderation_actions (id, moderator_id, target_type, target_id, action, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.user_id, report.target_type, report.target_id, `${status}:${action}`, notes, now());
  audit(req.user.user_id, 'moderation_decision', report.target_type, report.target_id, { report_id: report.id, status, action });
  notify({ userId: report.reporter_id, kind: 'report_result', targetType: report.target_type, targetId: report.target_id, data: { status, action } });
  ok(res, { report: get('SELECT * FROM reports WHERE id = ?', report.id) });
}));

router.get('/moderation/actions', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT ma.*, u.username, u.display_name FROM moderation_actions ma JOIN users u ON u.id = ma.moderator_id
     ORDER BY ma.created_at DESC LIMIT ? OFFSET ?`, limit, offset,
  );
  ok(res, { items: rows.map((r) => ({ ...r, moderator: { ...publicUser(r), id: r.moderator_id } })) });
}));

router.post('/moderation/content/:type/:id/remove', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  const type = v.oneOf(req.params.type, Object.keys(TARGET_TABLES), 'type');
  const target = targetExists(type, req.params.id);
  if (!target) throw notFound('Không tìm thấy nội dung');
  removeTarget(type, req.params.id);
  const notes = v.optionalStr(req.body.notes, { field: 'Ghi chú', max: 2000 });
  db.prepare('INSERT INTO moderation_actions (id, moderator_id, target_type, target_id, action, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.user.user_id, type, req.params.id, 'remove', notes, now());
  audit(req.user.user_id, 'content_remove', type, req.params.id, { notes });
  ok(res, { removed: true });
}));

router.get('/moderation/overview', requireAuth, requireRole('admin', 'moderator'), wrap(async (req, res) => {
  ok(res, {
    open_reports: get("SELECT COUNT(*) AS c FROM reports WHERE status IN ('open','reviewing')").c,
    total_reports: get('SELECT COUNT(*) AS c FROM reports').c,
    reports_today: get('SELECT COUNT(*) AS c FROM reports WHERE created_at >= ?', new Date(Date.now() - 86400000).toISOString()).c,
    actions_today: get('SELECT COUNT(*) AS c FROM moderation_actions WHERE created_at >= ?', new Date(Date.now() - 86400000).toISOString()).c,
    by_type: all("SELECT target_type, COUNT(*) AS c FROM reports WHERE status IN ('open','reviewing') GROUP BY target_type"),
  });
}));

export default router;
