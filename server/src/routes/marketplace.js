import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { publicUser, notify, track } from '../lib/social.js';
import { requireFeature } from '../lib/features.js';

const router = Router();

function productPayload(row, viewerId) {
  return {
    ...row,
    seller: { ...publicUser(row), id: row.seller_id },
    media: all('SELECT * FROM product_media WHERE product_id = ? ORDER BY position', row.id),
    mine: viewerId === row.seller_id,
    bookmarked: viewerId ? !!get("SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND target_type = 'product' AND target_id = ?", viewerId, row.id) : false,
    reports_open: get("SELECT COUNT(*) AS c FROM reports WHERE target_type = 'product' AND target_id = ? AND status = 'open'", row.id).c,
  };
}

function productMedia(input) {
  if (!input) return [];
  if (!Array.isArray(input)) throw badRequest('media phải là mảng');
  if (input.length > 10) throw badRequest('Tối đa 10 ảnh');
  return input.map((item, index) => {
    const url = typeof item === 'string' ? item : v.str(item.url, { field: 'media.url', max: 1000 });
    return { url, position: index };
  });
}

router.get('/marketplace/products', wrap(async (req, res) => {
  const viewerId = req.user?.user_id || null;
  const { limit, offset } = pagination(req.query);
  const clauses = ['p.deleted_at IS NULL'];
  const params = [];
  const status = req.query.status || 'active';
  if (status === 'all' && !['admin', 'moderator'].includes(req.user?.role || '')) {
    clauses.push("(p.status = 'active' OR p.seller_id = ?)");
    params.push(viewerId || '');
  } else if (status !== 'all') {
    clauses.push('p.status = ?');
    params.push(v.oneOf(status, ['active', 'sold', 'removed', 'pending'], 'status'));
  }
  if (req.query.q) { clauses.push('(p.title LIKE ? OR p.description LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category) { clauses.push('p.category = ?'); params.push(String(req.query.category)); }
  if (req.query.seller) { clauses.push('p.seller_id = ?'); params.push(String(req.query.seller)); }
  if (req.query.min_price) { clauses.push('p.price_cents >= ?'); params.push(v.int(req.query.min_price, { field: 'min_price', min: 0 })); }
  if (req.query.max_price) { clauses.push('p.price_cents <= ?'); params.push(v.int(req.query.max_price, { field: 'max_price', min: 0 })); }
  const sort = req.query.sort === 'price_asc' ? 'p.price_cents ASC' : req.query.sort === 'price_desc' ? 'p.price_cents DESC' : 'p.created_at DESC';
  const rows = all(
    `SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id
     WHERE ${clauses.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...params, limit, offset,
  );
  ok(res, {
    items: rows.map((p) => productPayload(p, viewerId)),
    total: get(`SELECT COUNT(*) AS c FROM products p WHERE ${clauses.join(' AND ')}`, ...params).c,
    limit, offset,
  });
}));

router.get('/marketplace/products/:id', wrap(async (req, res) => {
  const row = get('SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id = ? AND p.deleted_at IS NULL', req.params.id);
  if (!row) throw notFound('Không tìm thấy sản phẩm');
  const viewerId = req.user?.user_id || null;
  if (row.status === 'removed' && row.seller_id !== viewerId && !['admin', 'moderator'].includes(req.user?.role || '')) throw notFound('Không tìm thấy sản phẩm');
  track(viewerId, 'product_view', 'product', row.id);
  ok(res, { product: productPayload(row, viewerId) });
}));

router.post('/marketplace/products', requireAuth, wrap(async (req, res) => {
  requireFeature('feature_marketplace');
  const title = v.str(req.body.title, { field: 'Tên sản phẩm', min: 2, max: 200 });
  const price = v.int(req.body.price_cents, { field: 'Giá', min: 0, max: 100000000000 });
  const productId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO products (id, seller_id, title, description, price_cents, currency, category, condition, location, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    productId, req.user.user_id, title,
    v.optionalStr(req.body.description, { field: 'Mô tả', max: 10000 }) || '',
    price, v.optionalStr(req.body.currency, { field: 'Tiền tệ', max: 8 }) || 'USD',
    v.optionalStr(req.body.category, { field: 'Danh mục', max: 60 }) || 'general',
    v.oneOf(req.body.condition, ['new', 'like_new', 'used', 'refurbished'], 'condition', 'used'),
    v.optionalStr(req.body.location, { field: 'Địa điểm', max: 200 }), now(), now(),
  );
  const insertMedia = db.prepare('INSERT INTO product_media (id, product_id, url, position) VALUES (?, ?, ?, ?)');
  for (const m of productMedia(req.body.media)) insertMedia.run(crypto.randomUUID(), productId, m.url, m.position);
  track(req.user.user_id, 'product_create', 'product', productId);
  const row = get('SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id = ?', productId);
  created(res, { product: productPayload(row, req.user.user_id) });
}));

router.patch('/marketplace/products/:id', requireAuth, wrap(async (req, res) => {
  requireFeature('feature_marketplace');
  const product = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!product) throw notFound('Không tìm thấy sản phẩm');
  if (product.seller_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể sửa sản phẩm này');
  const updates = [];
  const params = [];
  if (req.body.title !== undefined) { updates.push('title = ?'); params.push(v.str(req.body.title, { field: 'Tên sản phẩm', min: 2, max: 200 })); }
  if (req.body.description !== undefined) { updates.push('description = ?'); params.push(v.optionalStr(req.body.description, { field: 'Mô tả', max: 10000 }) || ''); }
  if (req.body.price_cents !== undefined) { updates.push('price_cents = ?'); params.push(v.int(req.body.price_cents, { field: 'Giá', min: 0 })); }
  if (req.body.category !== undefined) { updates.push('category = ?'); params.push(v.str(req.body.category, { field: 'Danh mục', max: 60 })); }
  if (req.body.condition !== undefined) { updates.push('condition = ?'); params.push(v.oneOf(req.body.condition, ['new', 'like_new', 'used', 'refurbished'], 'condition')); }
  if (req.body.location !== undefined) { updates.push('location = ?'); params.push(v.optionalStr(req.body.location, { field: 'Địa điểm', max: 200 })); }
  if (req.body.status !== undefined) {
    const status = v.oneOf(req.body.status, ['active', 'sold', 'removed', 'pending'], 'status');
    if (status === 'pending' && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Chỉ quản trị viên mới đặt trạng thái chờ duyệt');
    updates.push('status = ?');
    params.push(status);
  }
  if (req.body.media !== undefined) {
    db.prepare('DELETE FROM product_media WHERE product_id = ?').run(product.id);
    const insertMedia = db.prepare('INSERT INTO product_media (id, product_id, url, position) VALUES (?, ?, ?, ?)');
    for (const m of productMedia(req.body.media)) insertMedia.run(crypto.randomUUID(), product.id, m.url, m.position);
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now(), product.id);
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const row = get('SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id WHERE p.id = ?', product.id);
  ok(res, { product: productPayload(row, req.user.user_id) });
}));

router.post('/marketplace/products/:id/sold', requireAuth, wrap(async (req, res) => {
  requireFeature('feature_marketplace');
  const product = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!product) throw notFound('Không tìm thấy sản phẩm');
  if (product.seller_id !== req.user.user_id && !['admin'].includes(req.user.role)) throw forbidden('Chỉ người bán mới có thể đánh dấu đã bán');
  db.prepare("UPDATE products SET status = 'sold', updated_at = ? WHERE id = ?").run(now(), product.id);
  ok(res, { status: 'sold' });
}));

router.delete('/marketplace/products/:id', requireAuth, wrap(async (req, res) => {
  const product = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!product) throw notFound('Không tìm thấy sản phẩm');
  if (product.seller_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa sản phẩm này');
  db.prepare("UPDATE products SET deleted_at = ?, status = 'removed', updated_at = ? WHERE id = ?").run(now(), now(), product.id);
  noContent(res);
}));

router.post('/marketplace/products/:id/report', requireAuth, wrap(async (req, res) => {
  const product = get('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!product) throw notFound('Không tìm thấy sản phẩm');
  const reason = v.str(req.body.reason, { field: 'Lý do', min: 2, max: 200 });
  const details = v.optionalStr(req.body.details, { field: 'Chi tiết', max: 2000 });
  const reportId = crypto.randomUUID();
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(reportId, req.user.user_id, 'product', product.id, reason, details, 'open', now());
  if (product.seller_id !== req.user.user_id) notify({ userId: product.seller_id, kind: 'report', actorId: req.user.user_id, targetType: 'product', targetId: product.id });
  ok(res, { report: { id: reportId, status: 'open' } }, 201);
}));

router.get('/marketplace/categories', wrap(async (req, res) => {
  const rows = all("SELECT category, COUNT(*) AS c FROM products WHERE status = 'active' AND deleted_at IS NULL GROUP BY category ORDER BY c DESC");
  ok(res, { items: rows });
}));

export default router;
