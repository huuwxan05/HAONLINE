import { Router } from 'express';
import { get, all, now } from '../db.js';
import { wrap, ok } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { publicUser } from '../lib/social.js';

const router = Router();

router.get('/analytics/me', requireAuth, wrap(async (req, res) => {
  const userId = req.user.user_id;
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const postIds = all('SELECT id FROM posts WHERE author_id = ? AND deleted_at IS NULL', userId).map((r) => r.id);
  const marks = postIds.map(() => '?').join(',') || "''";
  const reactionsReceived = postIds.length
    ? get(`SELECT COUNT(*) AS c FROM reactions WHERE target_type = 'post' AND target_id IN (${marks})`, ...postIds).c : 0;
  const commentsReceived = postIds.length
    ? get(`SELECT COUNT(*) AS c FROM comments WHERE deleted_at IS NULL AND post_id IN (${marks})`, ...postIds).c : 0;
  const views = postIds.length
    ? get(`SELECT COUNT(*) AS c FROM analytics_events WHERE type = 'post_view' AND target_id IN (${marks})`, ...postIds).c : 0;
  const daily = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM analytics_events
     WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day`, userId, since,
  );
  ok(res, {
    days,
    followers: get('SELECT COUNT(*) AS c FROM follows WHERE following_id = ?', userId).c,
    following: get('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?', userId).c,
    friends: get("SELECT COUNT(*) AS c FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)", userId, userId).c,
    posts: postIds.length,
    reactions_received: reactionsReceived,
    comments_received: commentsReceived,
    post_views: views,
    reels_views: get('SELECT COALESCE(SUM(view_count),0) AS c FROM reels WHERE author_id = ? AND deleted_at IS NULL', userId).c,
    video_views: get('SELECT COALESCE(SUM(view_count),0) AS c FROM videos WHERE owner_id = ? AND deleted_at IS NULL', userId).c,
    earnings: get('SELECT COALESCE(SUM(amount_cents),0) AS c FROM creator_earnings WHERE user_id = ?', userId).c,
    daily_activity: daily,
    top_posts: postIds.length ? all(
      `SELECT p.id, p.body, p.created_at,
        (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.id) AS reactions,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments
       FROM posts p WHERE p.author_id = ? AND p.deleted_at IS NULL
       ORDER BY reactions DESC LIMIT 5`, userId,
    ) : [],
  });
}));

router.get('/analytics/trending', wrap(async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const posts = all(
    `SELECT p.id, substr(p.body, 1, 160) AS body, p.created_at, u.id AS author_id, u.username, u.display_name,
       (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.id) AS reactions,
       (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.created_at >= ? AND p.deleted_at IS NULL AND p.visibility = 'public'
     ORDER BY (reactions * 2 + comments) DESC LIMIT 10`, since,
  );
  const reels = all(
    `SELECT r.*, u.username, u.display_name, u.avatar_url FROM reels r JOIN users u ON u.id = r.author_id
     WHERE r.deleted_at IS NULL ORDER BY r.view_count DESC LIMIT 10`,
  );
  const tags = new Map();
  for (const row of all("SELECT body FROM posts WHERE created_at >= ? AND body LIKE '%#%' LIMIT 500", since)) {
    for (const tag of row.body.match(/#[\p{L}\p{N}_]{2,40}/gu) || []) {
      const key = tag.toLowerCase();
      tags.set(key, (tags.get(key) || 0) + 1);
    }
  }
  ok(res, {
    posts: posts.map((p) => ({ ...p, author: { id: p.author_id, username: p.username, display_name: p.display_name } })),
    reels: reels.map((r) => ({ ...r, author: { ...publicUser(r), id: r.author_id } })),
    hashtags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, count]) => ({ tag, count })),
  });
}));

export default router;
