import { Router } from 'express';
import crypto from 'node:crypto';
import { db, get, all, now, pagination } from '../db.js';
import { wrap, ok, created, noContent } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { canMessage, isBlocked, notify, publicUser, track } from '../lib/social.js';
import { requireFeature } from '../lib/features.js';
import { sendTo, sendToMany } from '../lib/realtime.js';

const router = Router();

function membership(conversationId, userId) {
  return get('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conversationId, userId);
}

function memberIds(conversationId) {
  return all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', conversationId).map((r) => r.user_id);
}

function conversationPayload(row, viewerId) {
  const members = all(
    `SELECT u.*, cm.role, cm.last_read_at, cm.muted FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE cm.conversation_id = ?`,
    row.id,
  );
  const others = members.filter((m) => m.id !== viewerId);
  const me = members.find((m) => m.id === viewerId);
  const last = get('SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1', row.id);
  const unread = me?.last_read_at
    ? get('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ? AND created_at > ? AND deleted_at IS NULL', row.id, viewerId, me.last_read_at).c
    : get('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL', row.id, viewerId).c;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title || (others.length === 1 ? others[0].display_name : others.map((m) => m.display_name).join(', ')),
    avatar_url: row.avatar_url || (row.kind === 'dm' && others.length === 1 ? others[0].avatar_url : null),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    members: members.map((m) => ({ ...publicUser(m), role: m.role, muted: !!m.muted })),
    unread,
    muted: !!me?.muted,
    last_message: last ? { id: last.id, body: last.body, kind: last.kind, media_url: last.media_url, created_at: last.created_at, sender: { ...publicUser(last), id: last.sender_id } } : null,
  };
}

function messagePayload(row) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender: { ...publicUser(row), id: row.sender_id },
    kind: row.kind,
    body: row.body,
    media_url: row.media_url,
    reply_to_id: row.reply_to_id,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

router.get('/conversations', requireAuth, wrap(async (req, res) => {
  const { limit, offset } = pagination(req.query);
  const rows = all(
    `SELECT c.* FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
     WHERE cm.user_id = ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
    req.user.user_id, limit, offset,
  );
  ok(res, { items: rows.map((row) => conversationPayload(row, req.user.user_id)), limit, offset });
}));

router.post('/conversations', requireAuth, wrap(async (req, res) => {
  const kind = v.oneOf(req.body.kind, ['dm', 'group'], 'kind', 'dm');
  const memberIdsInput = req.body.member_ids || (req.body.user_id ? [req.body.user_id] : []);
  if (!Array.isArray(memberIdsInput)) throw badRequest('member_ids phải là mảng');
  let memberIds = [...new Set([req.user.user_id, ...memberIdsInput.map(String)])];
  if (memberIds.length < 2) throw badRequest('Cần ít nhất 2 thành viên');
  if (kind === 'dm' && memberIds.length !== 2) throw badRequest('Chat cá nhân chỉ có 2 thành viên');
  for (const memberId of memberIds) {
    const user = get("SELECT id FROM users WHERE id = ? AND status = 'active'", memberId);
    if (!user) throw notFound('Không tìm thấy thành viên');
    if (memberId !== req.user.user_id && isBlocked(req.user.user_id, memberId)) throw forbidden('Không thể nhắn tin với người này');
  }
  if (kind === 'dm') {
    const other = memberIds.find((m) => m !== req.user.user_id);
    if (!canMessage(req.user.user_id, other)) throw forbidden('Người này không nhận tin nhắn');
    const existing = get(
      `SELECT c.* FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.kind = 'dm' LIMIT 1`,
      req.user.user_id, other,
    );
    if (existing) return ok(res, { conversation: conversationPayload(existing, req.user.user_id) });
  }
  const conversationId = crypto.randomUUID();
  db.prepare('INSERT INTO conversations (id, kind, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, kind, v.optionalStr(req.body.title, { field: 'Tên nhóm', max: 120 }), req.user.user_id, now(), now());
  const insert = db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?, ?, ?, ?, ?)');
  for (const memberId of memberIds) insert.run(conversationId, memberId, memberId === req.user.user_id ? 'owner' : 'member', now(), now());
  const row = get('SELECT * FROM conversations WHERE id = ?', conversationId);
  for (const memberId of memberIds) {
    if (memberId !== req.user.user_id) {
      sendTo(memberId, 'conversation_new', { conversation: conversationPayload(row, memberId) });
      notify({ userId: memberId, kind: 'conversation', actorId: req.user.user_id, targetType: 'conversation', targetId: conversationId });
    }
  }
  created(res, { conversation: conversationPayload(row, req.user.user_id) });
}));

router.get('/conversations/:id', requireAuth, wrap(async (req, res) => {
  const row = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!row) throw notFound('Không tìm thấy cuộc trò chuyện');
  if (!membership(row.id, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const { limit, offset } = pagination(req.query);
  const messages = all(
    `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    row.id, limit, offset,
  ).reverse();
  ok(res, { conversation: conversationPayload(row, req.user.user_id), messages: messages.map(messagePayload), limit, offset });
}));

router.patch('/conversations/:id', requireAuth, wrap(async (req, res) => {
  const row = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!row) throw notFound('Không tìm thấy cuộc trò chuyện');
  const me = membership(row.id, req.user.user_id);
  if (!me) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  if (row.kind === 'dm') throw badRequest('Không thể sửa chat cá nhân');
  if (!['owner', 'admin'].includes(me.role)) throw forbidden('Cần quyền quản lý nhóm chat');
  const updates = [];
  const params = [];
  if (req.body.title !== undefined) { updates.push('title = ?'); params.push(v.str(req.body.title, { field: 'Tên nhóm', min: 1, max: 120 })); }
  if (req.body.avatar_url !== undefined) { updates.push('avatar_url = ?'); params.push(v.optionalStr(req.body.avatar_url, { field: 'avatar', max: 500 })); }
  if (req.body.muted !== undefined) {
    db.prepare('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(v.bool(req.body.muted) ? 1 : 0, row.id, req.user.user_id);
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now(), row.id);
    db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  const updated = get('SELECT * FROM conversations WHERE id = ?', row.id);
  sendToMany(memberIds(row.id), 'conversation_update', { conversation: conversationPayload(updated, req.user.user_id) });
  ok(res, { conversation: conversationPayload(updated, req.user.user_id) });
}));

router.post('/conversations/:id/members', requireAuth, wrap(async (req, res) => {
  const row = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!row) throw notFound('Không tìm thấy cuộc trò chuyện');
  if (row.kind !== 'group') throw badRequest('Chỉ nhóm chat mới thêm thành viên');
  const me = membership(row.id, req.user.user_id);
  if (!me) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const userId = v.str(req.body.user_id, { field: 'user_id' });
  const user = get("SELECT id FROM users WHERE id = ? AND status = 'active'", userId);
  if (!user) throw notFound('Không tìm thấy người dùng');
  if (isBlocked(req.user.user_id, userId)) throw forbidden('Không thể thêm người này');
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(row.id, userId, 'member', now(), now());
  sendTo(userId, 'conversation_new', { conversation: conversationPayload(row, userId) });
  sendToMany(memberIds(row.id), 'conversation_update', { conversation: conversationPayload(row, req.user.user_id) });
  ok(res, { conversation: conversationPayload(row, req.user.user_id) });
}));

router.delete('/conversations/:id/members/:userId', requireAuth, wrap(async (req, res) => {
  const row = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!row) throw notFound('Không tìm thấy cuộc trò chuyện');
  const me = membership(row.id, req.user.user_id);
  if (!me) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  if (req.params.userId !== req.user.user_id && !['owner', 'admin'].includes(me.role)) throw forbidden('Cần quyền quản lý nhóm chat');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(row.id, req.params.userId);
  sendTo(req.params.userId, 'conversation_removed', { conversation_id: row.id });
  ok(res, { ok: true });
}));

router.get('/conversations/:id/messages', requireAuth, wrap(async (req, res) => {
  if (!membership(req.params.id, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const { limit, offset } = pagination(req.query);
  const before = req.query.before ? String(req.query.before) : null;
  const clauses = ['m.conversation_id = ?', 'm.deleted_at IS NULL'];
  const params = [req.params.id];
  if (before) { clauses.push('m.created_at < ?'); params.push(before); }
  const rows = all(
    `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE ${clauses.join(' AND ')} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset,
  ).reverse();
  ok(res, { items: rows.map(messagePayload), limit, offset });
}));

router.post('/conversations/:id/messages', requireAuth, wrap(async (req, res) => {
  const conversation = get('SELECT * FROM conversations WHERE id = ?', req.params.id);
  if (!conversation) throw notFound('Không tìm thấy cuộc trò chuyện');
  if (!membership(conversation.id, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const kind = v.oneOf(req.body.kind, ['text', 'image', 'video', 'file', 'audio', 'emoji'], 'kind', 'text');
  const body = v.str(req.body.body, { field: 'Tin nhắn', max: 10000, required: kind === 'text' });
  const mediaUrl = req.body.media_url ? v.str(req.body.media_url, { field: 'media_url', max: 1000 }) : null;
  if (kind !== 'text' && !mediaUrl && !body) throw badRequest('Cần tệp hoặc nội dung');
  if (conversation.kind === 'dm') {
    const others = memberIds(conversation.id).filter((m) => m !== req.user.user_id);
    for (const other of others) if (!canMessage(req.user.user_id, other)) throw forbidden('Không thể gửi tin nhắn');
  }
  let replyToId = null;
  if (req.body.reply_to_id) {
    const reply = get('SELECT id FROM messages WHERE id = ? AND conversation_id = ?', String(req.body.reply_to_id), conversation.id);
    if (reply) replyToId = reply.id;
  }
  const messageId = crypto.randomUUID();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, kind, body, media_url, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(messageId, conversation.id, req.user.user_id, kind, body, mediaUrl, replyToId, now());
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conversation.id);
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(now(), conversation.id, req.user.user_id);
  const row = get('SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?', messageId);
  const payload = messagePayload(row);
  const recipients = memberIds(conversation.id).filter((m) => m !== req.user.user_id);
  sendToMany(recipients, 'message', { conversation_id: conversation.id, message: payload });
  if (conversation.kind === 'dm') {
    for (const recipient of recipients) {
      notify({ userId: recipient, kind: 'message', actorId: req.user.user_id, targetType: 'conversation', targetId: conversation.id, data: { preview: body.slice(0, 120) || kind } });
    }
  }
  track(req.user.user_id, 'message_send', 'conversation', conversation.id, { kind });
  created(res, { message: payload });
}));

router.post('/conversations/:id/read', requireAuth, wrap(async (req, res) => {
  if (!membership(req.params.id, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const at = req.body.at ? v.date(req.body.at, 'at') : now();
  db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(at, req.params.id, req.user.user_id);
  ok(res, { read_at: at });
}));

router.post('/conversations/:id/typing', requireAuth, wrap(async (req, res) => {
  if (!membership(req.params.id, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
  const recipients = memberIds(req.params.id).filter((m) => m !== req.user.user_id);
  sendToMany(recipients, 'typing', { conversation_id: req.params.id, user_id: req.user.user_id, display_name: req.user.display_name });
  ok(res, { ok: true });
}));

router.delete('/messages/:id', requireAuth, wrap(async (req, res) => {
  const message = get('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL', req.params.id);
  if (!message) throw notFound('Không tìm thấy tin nhắn');
  if (message.sender_id !== req.user.user_id && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không thể xóa tin nhắn này');
  db.prepare('UPDATE messages SET deleted_at = ?, body = ? WHERE id = ?').run(now(), '', message.id);
  sendToMany(memberIds(message.conversation_id), 'message_deleted', { conversation_id: message.conversation_id, message_id: message.id });
  noContent(res);
}));

router.get('/messages/search', requireAuth, wrap(async (req, res) => {
  const q = v.str(req.query.q, { field: 'q', min: 1, max: 100 });
  const { limit } = pagination(req.query);
  const rows = all(
    `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m
     JOIN users u ON u.id = m.sender_id
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
     WHERE m.body LIKE ? AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT ?`,
    req.user.user_id, `%${q}%`, limit,
  );
  ok(res, { items: rows.map(messagePayload) });
}));

router.get('/calls/history', requireAuth, wrap(async (req, res) => {
  const { limit } = pagination(req.query);
  const rows = all(
    `SELECT c.*, u.username, u.display_name, u.avatar_url FROM calls c JOIN users u ON u.id = c.caller_id
     WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.created_at DESC LIMIT ?`,
    req.user.user_id, req.user.user_id, limit,
  );
  ok(res, { items: rows.map((c) => ({ ...c, caller: { ...publicUser(c), id: c.caller_id } })) });
}));

router.post('/calls', requireAuth, wrap(async (req, res) => {
  requireFeature('feature_calls');
  const kind = v.oneOf(req.body.kind, ['voice', 'video'], 'kind', 'video');
  let calleeId = req.body.callee_id ? String(req.body.callee_id) : null;
  let conversationId = req.body.conversation_id ? String(req.body.conversation_id) : null;
  if (conversationId) {
    const conversation = get('SELECT * FROM conversations WHERE id = ?', conversationId);
    if (!conversation) throw notFound('Không tìm thấy cuộc trò chuyện');
    if (!membership(conversationId, req.user.user_id)) throw forbidden('Bạn không thuộc cuộc trò chuyện này');
    if (conversation.kind !== 'dm') throw badRequest('Gọi nhóm chưa được hỗ trợ, hãy chọn một liên hệ');
    calleeId = memberIds(conversationId).find((m) => m !== req.user.user_id);
  }
  if (!calleeId) throw badRequest('Thiếu người nhận');
  const callee = get("SELECT * FROM users WHERE id = ? AND status = 'active'", calleeId);
  if (!callee) throw notFound('Không tìm thấy người nhận');
  if (isBlocked(req.user.user_id, calleeId)) throw forbidden('Không thể gọi người này');
  if (!canMessage(req.user.user_id, calleeId)) throw forbidden('Người này không nhận cuộc gọi');
  if (!conversationId) {
    const existing = get(
      `SELECT c.* FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.kind = 'dm' LIMIT 1`,
      req.user.user_id, calleeId,
    );
    if (existing) conversationId = existing.id;
  }
  const callId = crypto.randomUUID();
  db.prepare('INSERT INTO calls (id, conversation_id, caller_id, callee_id, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(callId, conversationId, req.user.user_id, calleeId, kind, 'ringing', now());
  sendTo(calleeId, 'call_incoming', {
    call: { id: callId, kind, status: 'ringing', conversation_id: conversationId, caller: { id: req.user.user_id, username: req.user.username, display_name: req.user.display_name, avatar_url: req.user.avatar_url } },
  });
  notify({ userId: calleeId, kind: 'call', actorId: req.user.user_id, targetType: 'call', targetId: callId, data: { call_kind: kind } });
  track(req.user.user_id, 'call_start', 'call', callId, { kind });
  created(res, { call: { id: callId, kind, status: 'ringing', conversation_id: conversationId } });
}));

router.get('/calls/:id', requireAuth, wrap(async (req, res) => {
  const call = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!call) throw notFound('Không tìm thấy cuộc gọi');
  if (![call.caller_id, call.callee_id].includes(req.user.user_id) && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không có quyền');
  ok(res, { call });
}));

router.post('/calls/:id/answer', requireAuth, wrap(async (req, res) => {
  const call = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!call) throw notFound('Không tìm thấy cuộc gọi');
  if (call.callee_id !== req.user.user_id) throw forbidden('Chỉ người nhận mới trả lời được');
  if (call.status !== 'ringing') return ok(res, { call });
  const accept = req.body.accept !== false;
  db.prepare('UPDATE calls SET status = ?, started_at = ? WHERE id = ?')
    .run(accept ? 'active' : 'declined', accept ? now() : null, call.id);
  const updated = get('SELECT * FROM calls WHERE id = ?', call.id);
  sendTo(call.caller_id, 'call_answered', { call: updated, accepted: accept });
  if (!accept) notify({ userId: call.caller_id, kind: 'call_declined', actorId: req.user.user_id, targetType: 'call', targetId: call.id });
  ok(res, { call: updated });
}));

router.post('/calls/:id/signal', requireAuth, wrap(async (req, res) => {
  const call = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!call) throw notFound('Không tìm thấy cuộc gọi');
  if (![call.caller_id, call.callee_id].includes(req.user.user_id)) throw forbidden('Không có quyền');
  if (!['ringing', 'active'].includes(call.status)) throw badRequest('Cuộc gọi đã kết thúc');
  const kind = v.oneOf(req.body.kind, ['offer', 'answer', 'ice'], 'kind');
  const payload = JSON.stringify(req.body.payload || {});
  db.prepare('INSERT INTO call_signals (id, call_id, from_user_id, to_user_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), call.id, req.user.user_id, call.caller_id === req.user.user_id ? call.callee_id : call.caller_id, kind, payload, now());
  const to = call.caller_id === req.user.user_id ? call.callee_id : call.caller_id;
  sendTo(to, 'call_signal', { call_id: call.id, from: req.user.user_id, kind, payload: JSON.parse(payload) });
  ok(res, { ok: true });
}));

router.get('/calls/:id/signals', requireAuth, wrap(async (req, res) => {
  const call = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!call) throw notFound('Không tìm thấy cuộc gọi');
  if (![call.caller_id, call.callee_id].includes(req.user.user_id)) throw forbidden('Không có quyền');
  const after = String(req.query.after || '1970-01-01T00:00:00.000Z');
  const rows = all('SELECT * FROM call_signals WHERE call_id = ? AND to_user_id = ? AND created_at > ? ORDER BY created_at LIMIT 100', call.id, req.user.user_id, after);
  ok(res, { items: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
}));

router.post('/calls/:id/end', requireAuth, wrap(async (req, res) => {
  const call = get('SELECT * FROM calls WHERE id = ?', req.params.id);
  if (!call) throw notFound('Không tìm thấy cuộc gọi');
  if (![call.caller_id, call.callee_id].includes(req.user.user_id) && !['admin', 'moderator'].includes(req.user.role)) throw forbidden('Không có quyền');
  db.prepare("UPDATE calls SET status = 'ended', ended_at = ? WHERE id = ? AND status IN ('ringing', 'active')").run(now(), call.id);
  const updated = get('SELECT * FROM calls WHERE id = ?', call.id);
  sendToMany([call.caller_id, call.callee_id], 'call_ended', { call: updated });
  ok(res, { call: updated });
}));

export default router;
