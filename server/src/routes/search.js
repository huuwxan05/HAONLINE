import { Router } from 'express';
import { all, get, pagination } from '../db.js';
import { wrap, ok } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { visibilityClause, publicUser } from '../lib/social.js';

const router = Router();

function userSearch(q, viewerId, limit) {
  const viewer = viewerId || '';
  return all(
    `SELECT u.* FROM users u WHERE u.status = 'active' AND (u.username LIKE ? OR u.display_name LIKE ? OR u.bio LIKE ?)
     AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
     AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
     AND (
       u.id = ?
       OR (
         COALESCE((SELECT searchable FROM privacy_settings ps WHERE ps.user_id = u.id), 1) = 1
         AND (
           COALESCE((SELECT profile_visibility FROM privacy_settings ps WHERE ps.user_id = u.id), 'public') = 'public'
           OR u.id IN (
             SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END FROM friendships
             WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
           )
         )
       )
     )
     ORDER BY CASE WHEN u.username = ? THEN 0 WHEN u.username LIKE ? THEN 1 ELSE 2 END, u.last_seen_at DESC LIMIT ?`,
    q, q, q, viewer, viewer, viewer, viewer, viewer, viewer, q.replace(/%/g, ''), q, limit,
  ).map((u) => publicUser(u));
}

function postSearch(q, viewerId, limit, offset) {
  const vis = visibilityClause(viewerId, 'p');
  const rows = all(
    `SELECT p.*, u.username, u.display_name, u.avatar_url FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.body LIKE ? AND ${vis.sql}
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    q, ...vis.params, limit, offset,
  );
  return rows.map((p) => ({
    id: p.id, body: p.body, created_at: p.created_at, visibility: p.visibility,
    author: { ...publicUser(p), id: p.author_id },
    reactions_count: get("SELECT COUNT(*) AS c FROM reactions WHERE target_type = 'post' AND target_id = ?", p.id).c,
    comments_count: get('SELECT COUNT(*) AS c FROM comments WHERE post_id = ? AND deleted_at IS NULL', p.id).c,
  }));
}

router.get('/search', wrap(async (req, res) => {
  const q = v.str(req.query.q, { field: 'q', min: 1, max: 100 });
  const like = `%${q}%`;
  const type = String(req.query.type || 'all');
  const { limit, offset } = pagination(req.query);
  const viewerId = req.user?.user_id || null;
  const result = { query: q, type };

  if (type === 'all' || type === 'users') result.users = userSearch(like, viewerId, type === 'all' ? 5 : limit);
  if (type === 'all' || type === 'posts') result.posts = postSearch(like, viewerId, type === 'all' ? 5 : limit, type === 'all' ? 0 : offset);

  if (type === 'all' || type === 'groups') {
    result.groups = all(
      `SELECT * FROM groups WHERE (name LIKE ? OR description LIKE ?)
       AND (privacy = 'public' OR id IN (SELECT group_id FROM group_members WHERE user_id = ? AND status = 'active'))
       ORDER BY created_at DESC LIMIT ?`,
      like, like, viewerId || '', type === 'all' ? 5 : limit,
    );
  }
  if (type === 'all' || type === 'pages') {
    result.pages = all('SELECT * FROM pages WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT ?', like, like, type === 'all' ? 5 : limit);
  }
  if (type === 'all' || type === 'events') {
    result.events = all(
      `SELECT * FROM events WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ?)
       AND (privacy = 'public' OR creator_id = ? OR id IN (SELECT event_id FROM event_attendees WHERE user_id = ?))
       ORDER BY starts_at ASC LIMIT ?`,
      like, like, viewerId || '', viewerId || '', type === 'all' ? 5 : limit,
    );
  }
  if (type === 'all' || type === 'products') {
    result.products = all(
      `SELECT p.*, u.username, u.display_name, u.avatar_url FROM products p JOIN users u ON u.id = p.seller_id
       WHERE p.status = 'active' AND p.deleted_at IS NULL AND (p.title LIKE ? OR p.description LIKE ?)
       ORDER BY p.created_at DESC LIMIT ?`, like, like, type === 'all' ? 5 : limit,
    ).map((p) => ({ ...p, seller: { ...publicUser(p), id: p.seller_id } }));
  }
  if (type === 'all' || type === 'videos') {
    result.videos = all(
      `SELECT v.*, u.username, u.display_name, u.avatar_url FROM videos v JOIN users u ON u.id = v.owner_id
       WHERE v.deleted_at IS NULL AND (v.visibility = 'public' OR v.owner_id = ?) AND (v.title LIKE ? OR v.description LIKE ?)
       ORDER BY v.created_at DESC LIMIT ?`, viewerId || '', like, like, type === 'all' ? 5 : limit,
    ).map((vid) => ({ ...vid, owner: { ...publicUser(vid), id: vid.owner_id } }));
  }
  if (type === 'all' || type === 'reels') {
    result.reels = all(
      `SELECT r.*, u.username, u.display_name, u.avatar_url FROM reels r JOIN users u ON u.id = r.author_id
       WHERE r.deleted_at IS NULL AND r.caption LIKE ? ORDER BY r.created_at DESC LIMIT ?`, like, type === 'all' ? 5 : limit,
    ).map((r) => ({ ...r, author: { ...publicUser(r), id: r.author_id } }));
  }
  ok(res, result);
}));

router.get('/search/suggestions', wrap(async (req, res) => {
  const trending = all(
    `SELECT substr(body, 1, 120) AS text, COUNT(*) AS c FROM posts
     WHERE created_at >= ? AND body != '' AND deleted_at IS NULL GROUP BY body ORDER BY c DESC LIMIT 5`,
    new Date(Date.now() - 7 * 86400000).toISOString(),
  );
  ok(res, {
    trending,
    recent_users: all(
      `SELECT u.* FROM users u LEFT JOIN privacy_settings ps ON ps.user_id = u.id
       WHERE u.status = 'active' AND COALESCE(ps.searchable, 1) = 1
       AND COALESCE(ps.profile_visibility, 'public') = 'public'
       ORDER BY u.last_seen_at DESC LIMIT 5`,
    ).map(publicUser),
  });
}));

export default router;
