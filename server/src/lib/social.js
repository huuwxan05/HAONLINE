import crypto from 'node:crypto';
import { db, get, now } from '../db.js';
import { forbidden, notFound } from './errors.js';
import { sendTo } from './realtime.js';
import { sendPushToUser } from './push.js';

export function isBlocked(a, b) {
  if (!a || !b) return false;
  return !!get('SELECT 1 AS x FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a);
}

export function areFriends(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return !!get(
    `SELECT 1 AS x FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    a, b, b, a,
  );
}

export function friendIds(userId) {
  return db.prepare(
    `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
     FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
  ).all(userId, userId, userId).map((r) => r.friend_id);
}

export function followIds(userId) {
  return db.prepare('SELECT following_id FROM follows WHERE follower_id = ?').all(userId).map((r) => r.following_id);
}

export function groupMembership(groupId, userId) {
  return get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
}

export function isGroupMember(groupId, userId) {
  const m = groupMembership(groupId, userId);
  return !!m && m.status === 'active';
}

export function groupRole(groupId, userId) {
  const m = groupMembership(groupId, userId);
  return m && m.status === 'active' ? m.role : null;
}

export function requireGroupRole(groupId, userId, roles = ['owner', 'admin', 'moderator']) {
  const role = groupRole(groupId, userId);
  if (!role || !roles.includes(role)) throw forbidden('Bạn không có quyền quản lý nhóm này');
  return role;
}

export function pageRole(pageId, userId) {
  const page = get('SELECT * FROM pages WHERE id = ?', pageId);
  if (!page) throw notFound('Không tìm thấy trang');
  if (page.owner_id === userId) return 'owner';
  const row = get('SELECT role FROM page_roles WHERE page_id = ? AND user_id = ?', pageId, userId);
  return row ? row.role : null;
}

export function requirePageRole(pageId, userId, roles = ['owner', 'admin', 'editor']) {
  const role = pageRole(pageId, userId);
  if (!role || !roles.includes(role)) throw forbidden('Bạn không có quyền quản lý trang này');
  return role;
}

export function canViewPost(post, viewerId) {
  if (!post || post.deleted_at) return false;
  if (post.status !== 'active') return false;
  if (viewerId && post.author_id === viewerId) return true;
  if (post.author_id && isBlocked(post.author_id, viewerId)) return false;
  if (post.group_id) {
    const group = get('SELECT privacy FROM groups WHERE id = ?', post.group_id);
    if (!group) return false;
    if (group.privacy === 'public') return true;
    return viewerId ? isGroupMember(post.group_id, viewerId) : false;
  }
  if (post.visibility === 'private') return false;
  if (post.visibility === 'friends') {
    if (!viewerId) return false;
    return areFriends(post.author_id, viewerId);
  }
  return true;
}

export function canViewProfile(targetId, viewerId) {
  const target = get('SELECT * FROM users WHERE id = ?', targetId);
  if (!target || target.status === 'deleted') return false;
  if (viewerId && targetId === viewerId) return true;
  if (viewerId && isBlocked(targetId, viewerId)) return false;
  const privacy = get('SELECT profile_visibility FROM privacy_settings WHERE user_id = ?', targetId);
  const visibility = privacy?.profile_visibility || 'public';
  if (visibility === 'public') return true;
  if (visibility === 'friends') return !!(viewerId && areFriends(targetId, viewerId));
  return false;
}

export function canMessage(fromId, toId) {
  if (fromId === toId) return false;
  if (isBlocked(fromId, toId)) return false;
  const privacy = get('SELECT who_can_message FROM privacy_settings WHERE user_id = ?', toId);
  const policy = privacy?.who_can_message || 'everyone';
  if (policy === 'none') return false;
  if (policy === 'friends') return areFriends(fromId, toId);
  return true;
}

export function visibilityClause(viewerId, alias = 'p') {
  if (!viewerId) {
    return {
      sql: `${alias}.visibility = 'public' AND (${alias}.group_id IS NULL OR ${alias}.group_id IN (SELECT id FROM groups WHERE privacy = 'public'))`,
      params: [],
    };
  }
  return {
    sql: `(
      ${alias}.author_id = ?
      OR (${alias}.visibility = 'public' AND ${alias}.author_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?) AND ${alias}.author_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?))
      OR (${alias}.visibility = 'friends' AND ${alias}.author_id IN (
          SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
        ))
      OR (${alias}.group_id IS NOT NULL AND (
          ${alias}.group_id IN (SELECT id FROM groups WHERE privacy = 'public')
          OR ${alias}.group_id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'active')
      ))
    )`,
    params: [viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId],
  };
}

export function notify({ userId, kind, actorId = null, targetType = null, targetId = null, data = {} }) {
  if (!userId) return null;
  if (actorId && userId === actorId && kind !== 'system') return null;
  const notifId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO notifications (id, user_id, kind, actor_id, target_type, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(notifId, userId, kind, actorId, targetType, targetId, JSON.stringify(data), now());
  const actor = actorId ? get('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?', actorId) : null;
  sendTo(userId, 'notification', { id: notifId, kind, actor, target_type: targetType, target_id: targetId, data, created_at: now() });
  sendPushToUser(userId).catch(() => {});
  return notifId;
}

export function audit(actorId, action, targetType = null, targetId = null, details = null) {
  db.prepare('INSERT INTO audit_log (id, actor_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), actorId, action, targetType, targetId, details ? JSON.stringify(details) : null, now());
}

export function track(userId, type, targetType = null, targetId = null, meta = null) {
  try {
    db.prepare('INSERT INTO analytics_events (id, user_id, type, target_type, target_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, type, targetType, targetId, meta ? JSON.stringify(meta) : null, now());
  } catch {
    // analytics must never break a request
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    role: row.role,
    email_verified: !!row.email_verified,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };
}

export function selfUser(row) {
  if (!row) return null;
  return {
    ...publicUser(row),
    email: row.email,
    phone: row.phone,
    birthday: row.birthday,
    gender: row.gender,
    locale: row.locale,
    timezone: row.timezone,
    email_verified: !!row.email_verified,
    phone_verified: !!row.phone_verified,
    twofa_enabled: !!row.twofa_enabled,
    status: row.status,
  };
}

export function saveSettings(userId, values) {
  const stmt = db.prepare('INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  for (const [key, value] of Object.entries(values)) {
    stmt.run(userId, key, typeof value === 'string' ? value : JSON.stringify(value), now());
  }
}

export function getSettings(userId) {
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
  const out = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}
