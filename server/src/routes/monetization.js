import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { notify, audit, track, publicUser } from '../lib/social.js';

const router = Router();

function balances(userId) {
  const sum = (status) => get('SELECT COALESCE(SUM(amount_cents),0) AS c FROM creator_earnings WHERE user_id = ? AND status = ?', userId, status).c;
  return {
    pending_cents: sum('pending'),
    available_cents: sum('available'),
    paid_cents: sum('paid'),
    currency: config.payments.currency,
  };
}

router.get('/monetization/status', requireAuth, wrap(async (req, res) => {
  ok(res, {
    payments_configured: Boolean(config.payments.stripeSecret),
    currency: config.payments.currency,
    balance: balances(req.user.user_id),
    active_campaigns: get("SELECT COUNT(*) AS c FROM ad_campaigns WHERE advertiser_id = ? AND status = 'active'", req.user.user_id).c,
    pending_payouts: get("SELECT COUNT(*) AS c FROM payouts WHERE user_id = ? AND status IN ('requested','processing')", req.user.user_id).c,
    minimum_payout_cents: 500,
  });
}));

router.get('/monetization/ads', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all('SELECT * FROM ad_campaigns WHERE advertiser_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', req.user.user_id, limit, offset);
  ok(res, {
    items: rows.map((c) => ({
      ...c,
      impressions: get("SELECT COUNT(*) AS c FROM ad_events WHERE campaign_id = ? AND kind = 'impression'", c.id).c,
      clicks: get("SELECT COUNT(*) AS c FROM ad_events WHERE campaign_id = ? AND kind = 'click'", c.id).c,
    })),
    payments_configured: Boolean(config.payments.stripeSecret),
  });
}));

router.post('/monetization/ads', requireAuth, wrap(async (req, res) => {
  const name = v.str(req.body.name, { field: 'Tên chiến dịch', min: 2, max: 120 });
  const budget = v.int(req.body.budget_cents, { field: 'Ngân sách', min: 100 });
  const startsAt = req.body.starts_at ? v.date(req.body.starts_at, 'starts_at') : now();
  const endsAt = req.body.ends_at ? v.date(req.body.ends_at, 'ends_at', false) : null;
  if (endsAt && endsAt <= startsAt) throw badRequest('Thời gian kết thúc phải sau bắt đầu');
  const campaignId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ad_campaigns (id, advertiser_id, name, creative_text, creative_url, budget_cents, spent_cents, status, starts_at, ends_at, targeting, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?)`,
  ).run(
    campaignId, req.user.user_id, name,
    v.optionalStr(req.body.creative_text, { field: 'Nội dung quảng cáo', max: 500 }) || '',
    v.optionalStr(req.body.creative_url, { field: 'Liên kết', max: 1000 }),
    budget, startsAt, endsAt,
    req.body.targeting ? JSON.stringify(req.body.targeting) : null, now(), now(),
  );
  track(req.user.user_id, 'ad_campaign_create', 'ad_campaign', campaignId);
  created(res, { campaign: get('SELECT * FROM ad_campaigns WHERE id = ?', campaignId) });
}));

router.patch('/monetization/ads/:id', requireAuth, wrap(async (req, res) => {
  const campaign = get('SELECT * FROM ad_campaigns WHERE id = ?', req.params.id);
  if (!campaign) throw notFound('Không tìm thấy chiến dịch');
  if (campaign.advertiser_id !== req.user.user_id && req.user.role !== 'admin') throw forbidden('Không thể sửa chiến dịch này');
  if (!['draft', 'paused'].includes(campaign.status) && req.user.role !== 'admin') throw badRequest('Chiến dịch đang chạy, tạm dừng trước khi sửa');
  const updates = [];
  const params = [];
  if (req.body.name !== undefined) { updates.push('name = ?'); params.push(v.str(req.body.name, { field: 'Tên', min: 2, max: 120 })); }
  if (req.body.creative_text !== undefined) { updates.push('creative_text = ?'); params.push(v.optionalStr(req.body.creative_text, { field: 'Nội dung', max: 500 }) || ''); }
  if (req.body.creative_url !== undefined) { updates.push('creative_url = ?'); params.push(v.optionalStr(req.body.creative_url, { field: 'Liên kết', max: 1000 })); }
  if (req.body.budget_cents !== undefined) { updates.push('budget_cents = ?'); params.push(v.int(req.body.budget_cents, { field: 'Ngân sách', min: 100 })); }
  if (req.body.status !== undefined && req.user.role === 'admin') {
    updates.push('status = ?');
    params.push(v.oneOf(req.body.status, ['draft', 'active', 'paused', 'ended'], 'status'));
  }
  if (req.body.targeting !== undefined) { updates.push('targeting = ?'); params.push(JSON.stringify(req.body.targeting)); }
  if (!updates.length) return ok(res, { campaign });
  updates.push('updated_at = ?');
  params.push(now(), campaign.id);
  db.prepare(`UPDATE ad_campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  ok(res, { campaign: get('SELECT * FROM ad_campaigns WHERE id = ?', campaign.id) });
}));

router.post('/monetization/ads/:id/pause', requireAuth, wrap(async (req, res) => {
  const campaign = get('SELECT * FROM ad_campaigns WHERE id = ?', req.params.id);
  if (!campaign) throw notFound('Không tìm thấy chiến dịch');
  if (campaign.advertiser_id !== req.user.user_id && req.user.role !== 'admin') throw forbidden('Không thể sửa chiến dịch này');
  db.prepare("UPDATE ad_campaigns SET status = 'paused', updated_at = ? WHERE id = ?").run(now(), campaign.id);
  ok(res, { status: 'paused' });
}));

router.post('/monetization/ads/:id/activate', requireAuth, wrap(async (req, res) => {
  const campaign = get('SELECT * FROM ad_campaigns WHERE id = ?', req.params.id);
  if (!campaign) throw notFound('Không tìm thấy chiến dịch');
  if (campaign.advertiser_id !== req.user.user_id && req.user.role !== 'admin') throw forbidden('Không thể kích hoạt chiến dịch này');
  if (campaign.status === 'active') return ok(res, { campaign });
  const paid = get(
    "SELECT COALESCE(SUM(amount_cents),0) AS c FROM transactions WHERE kind = 'ad_spend' AND status = 'completed' AND json_extract(meta, '$.campaign_id') = ?",
    campaign.id,
  ).c;
  if (paid < campaign.budget_cents && req.user.role !== 'admin') {
    throw badRequest('Chiến dịch chưa được thanh toán đủ ngân sách');
  }
  db.prepare("UPDATE ad_campaigns SET status = 'active', updated_at = ? WHERE id = ?").run(now(), campaign.id);
  audit(req.user.user_id, 'ad_campaign_activate', 'ad_campaign', campaign.id);
  ok(res, { campaign: get('SELECT * FROM ad_campaigns WHERE id = ?', campaign.id) });
}));

router.get('/monetization/ads/serve', requireAuth, wrap(async (req, res) => {
  const campaign = get(
    `SELECT * FROM ad_campaigns WHERE status = 'active' AND budget_cents > spent_cents
     AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
     AND advertiser_id != ? ORDER BY RANDOM() LIMIT 1`, now(), now(), req.user.user_id,
  );
  if (!campaign) return ok(res, { items: [] });
  db.prepare('INSERT INTO ad_events (id, campaign_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), campaign.id, req.user.user_id, 'impression', now());
  ok(res, { items: [{ id: campaign.id, name: campaign.name, text: campaign.creative_text, url: campaign.creative_url, advertiser_id: campaign.advertiser_id }] });
}));

router.post('/monetization/ads/:id/click', requireAuth, wrap(async (req, res) => {
  const campaign = get("SELECT * FROM ad_campaigns WHERE id = ? AND status = 'active'", req.params.id);
  if (!campaign) throw notFound('Không tìm thấy chiến dịch');
  db.prepare('INSERT INTO ad_events (id, campaign_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), campaign.id, req.user.user_id, 'click', now());
  const cpc = 20;
  const remaining = campaign.budget_cents - campaign.spent_cents;
  db.prepare('UPDATE ad_campaigns SET spent_cents = spent_cents + ?, status = CASE WHEN spent_cents + ? >= budget_cents THEN ? ELSE status END, updated_at = ? WHERE id = ?')
    .run(Math.min(cpc, Math.max(remaining, 0)), Math.min(cpc, Math.max(remaining, 0)), 'ended', now(), campaign.id);
  ok(res, { ok: true });
}));

router.get('/monetization/earnings', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  ok(res, {
    balance: balances(req.user.user_id),
    items: all('SELECT * FROM creator_earnings WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', req.user.user_id, limit, offset),
    payouts: all('SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', req.user.user_id),
  });
}));

router.post('/monetization/earnings/request-payout', requireAuth, wrap(async (req, res) => {
  const amount = v.int(req.body.amount_cents, { field: 'Số tiền', min: 500 });
  const balance = balances(req.user.user_id);
  if (balance.available_cents < amount) throw badRequest('Số dư khả dụng không đủ');
  const payoutId = crypto.randomUUID();
  db.prepare('INSERT INTO payouts (id, user_id, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(payoutId, req.user.user_id, amount, config.payments.currency, 'requested', now());
  let remaining = amount;
  const earnings = all("SELECT * FROM creator_earnings WHERE user_id = ? AND status = 'available' ORDER BY created_at ASC", req.user.user_id);
  for (const earning of earnings) {
    if (remaining <= 0) break;
    if (earning.amount_cents <= remaining) {
      db.prepare("UPDATE creator_earnings SET status = 'paid', reference = ? WHERE id = ?").run(payoutId, earning.id);
      remaining -= earning.amount_cents;
    } else {
      db.prepare("UPDATE creator_earnings SET amount_cents = amount_cents - ? WHERE id = ?").run(remaining, earning.id);
      remaining = 0;
    }
  }
  audit(req.user.user_id, 'payout_request', 'payout', payoutId, { amount_cents: amount });
  created(res, { payout: get('SELECT * FROM payouts WHERE id = ?', payoutId), balance: balances(req.user.user_id) });
}));

router.get('/monetization/payouts', requireAuth, wrap(async (req, res) => {
  const rows = req.user.role === 'admin'
    ? all('SELECT p.*, u.username, u.display_name FROM payouts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100')
    : all('SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', req.user.user_id);
  ok(res, { items: rows });
}));

router.patch('/monetization/payouts/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const payout = get('SELECT * FROM payouts WHERE id = ?', req.params.id);
  if (!payout) throw notFound('Không tìm thấy yêu cầu chi trả');
  const status = v.oneOf(req.body.status, ['requested', 'processing', 'paid', 'rejected'], 'status');
  db.prepare('UPDATE payouts SET status = ?, provider_ref = ?, processed_at = ? WHERE id = ?')
    .run(status, v.optionalStr(req.body.provider_ref, { field: 'provider_ref', max: 200 }), ['paid', 'rejected'].includes(status) ? now() : null, payout.id);
  notify({ userId: payout.user_id, kind: 'payout_update', data: { status, amount_cents: payout.amount_cents } });
  audit(req.user.user_id, 'payout_update', 'payout', payout.id, { status });
  ok(res, { payout: get('SELECT * FROM payouts WHERE id = ?', payout.id) });
}));

router.get('/monetization/transactions', requireAuth, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  const rows = req.user.role === 'admin'
    ? all('SELECT t.*, u.username FROM transactions t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT ?', limit)
    : all('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', req.user.user_id, limit);
  ok(res, { items: rows });
}));

async function stripeRequest(endpoint, params) {
  if (!config.payments.stripeSecret) throw badRequest('Chưa cấu hình cổng thanh toán STRIPE_SECRET_KEY');
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.payments.stripeSecret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

router.post('/monetization/ads/:id/checkout', requireAuth, wrap(async (req, res) => {
  const campaign = get('SELECT * FROM ad_campaigns WHERE id = ?', req.params.id);
  if (!campaign) throw notFound('Không tìm thấy chiến dịch');
  if (campaign.advertiser_id !== req.user.user_id && req.user.role !== 'admin') throw forbidden('Không thể thanh toán chiến dịch này');
  if (!config.payments.stripeSecret) throw badRequest('Cổng thanh toán chưa được cấu hình');
  const session = await stripeRequest('checkout/sessions', {
    mode: 'payment',
    success_url: `${config.publicUrl}/?checkout=success&campaign=${campaign.id}`,
    cancel_url: `${config.publicUrl}/?checkout=cancel`,
    client_reference_id: campaign.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': config.payments.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(campaign.budget_cents),
    'line_items[0][price_data][product_data][name]': `HAONLINE Ads: ${campaign.name}`,
    'metadata[campaign_id]': campaign.id,
    'metadata[user_id]': req.user.user_id,
    'metadata[kind]': 'ad_spend',
  });
  ok(res, { checkout_url: session.url, session_id: session.id });
}));

router.post('/monetization/tips', requireAuth, wrap(async (req, res) => {
  const toUser = get("SELECT id FROM users WHERE id = ? AND status = 'active'", String(req.body.user_id || ''));
  if (!toUser) throw notFound('Không tìm thấy người nhận');
  if (toUser.id === req.user.user_id) throw badRequest('Không thể tự ủng hộ chính mình');
  const amount = v.int(req.body.amount_cents, { field: 'Số tiền', min: 100 });
  if (!config.payments.stripeSecret) {
    const tipId = crypto.randomUUID();
    db.prepare('INSERT INTO transactions (id, user_id, provider, provider_ref, amount_cents, currency, status, kind, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(tipId, req.user.user_id, 'internal', null, amount, config.payments.currency, 'pending', 'tip', JSON.stringify({ to_user_id: toUser.id }), now());
    return created(res, { status: 'pending_payment_configuration', transaction_id: tipId, message: 'Cần cấu hình cổng thanh toán để hoàn tất ủng hộ' });
  }
  const session = await stripeRequest('checkout/sessions', {
    mode: 'payment',
    success_url: `${config.publicUrl}/?checkout=success&tip=${toUser.id}`,
    cancel_url: `${config.publicUrl}/?checkout=cancel`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': config.payments.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': 'HAONLINE creator support',
    'metadata[to_user_id]': toUser.id,
    'metadata[user_id]': req.user.user_id,
    'metadata[kind]': 'tip',
  });
  ok(res, { checkout_url: session.url, session_id: session.id });
}));

function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const parts = signature.split(',').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > -1) acc[part.slice(0, idx)] = part.slice(idx + 1);
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

export async function stripeWebhookHandler(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  if (!config.payments.stripeWebhookSecret) return res.status(501).json({ error: { code: 'not_configured', message: 'Webhook thanh toán chưa được cấu hình' } });
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], config.payments.stripeWebhookSecret)) {
    return res.status(400).json({ error: { code: 'invalid_signature', message: 'Chữ ký webhook không hợp lệ' } });
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: { code: 'invalid_payload', message: 'Payload không hợp lệ' } });
  }
  if (!['checkout.session.completed', 'payment_intent.succeeded'].includes(event.type)) {
    return res.json({ received: true, ignored: event.type });
  }
  const object = event.data.object || {};
  const meta = object.metadata || {};
  const amount = Number(object.amount_total || object.amount_received || object.amount || 0);
  const kind = meta.kind || 'payment';
  db.prepare('INSERT INTO transactions (id, user_id, provider, provider_ref, amount_cents, currency, status, kind, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), meta.user_id || null, 'stripe', object.id || event.id, amount, (object.currency || config.payments.currency).toUpperCase(), 'completed', kind, JSON.stringify(meta), now());
  if (kind === 'ad_spend' && meta.campaign_id) {
    db.prepare("UPDATE ad_campaigns SET status = 'active', updated_at = ? WHERE id = ?").run(now(), meta.campaign_id);
    notify({ userId: meta.user_id, kind: 'ad_campaign_active', targetType: 'ad_campaign', targetId: meta.campaign_id });
  }
  if (kind === 'tip' && meta.to_user_id) {
    db.prepare('INSERT INTO creator_earnings (id, user_id, amount_cents, currency, source, status, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), meta.to_user_id, amount, (object.currency || config.payments.currency).toUpperCase(), 'tip', 'available', object.id || event.id, now());
    notify({ userId: meta.to_user_id, kind: 'tip_received', actorId: meta.user_id || null, data: { amount_cents: amount } });
  }
  res.json({ received: true });
}

export default router;
