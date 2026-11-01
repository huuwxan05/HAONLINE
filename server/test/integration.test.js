import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let app;
let alice;
let bob;

before(async () => {
  app = await startTestServer();
  alice = await app.register('alice', { display_name: 'Alice Nguyen' });
  bob = await app.register('bob', { display_name: 'Bob Tran' });
});

after(async () => {
  await app.close();
});

test('registration, verification, session, login and logout', async () => {
  const me = await app.request('GET', '/api/auth/me', { token: alice.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, alice.email);
  assert.equal(me.data.user.email_verified, false);

  const verify = await app.request('POST', '/api/auth/email/verify', {
    body: { email: alice.email, code: alice.verification.code },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.verified, true);

  const duplicate = await app.request('POST', '/api/auth/register', {
    body: {
      email: alice.email,
      username: `other${Date.now()}`,
      password: 'Passw0rd123',
      display_name: 'Duplicate',
    },
  });
  assert.equal(duplicate.status, 409);

  const login = await app.request('POST', '/api/auth/login', {
    body: { email: alice.email, password: alice.password },
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);

  const logout = await app.request('POST', '/api/auth/logout', { token: login.data.token });
  assert.equal(logout.status, 200);
  const afterLogout = await app.request('GET', '/api/auth/me', { token: login.data.token });
  assert.equal(afterLogout.status, 401);
});

test('post lifecycle with reactions, comments, sharing and bookmarks', async () => {
  const created = await app.request('POST', '/api/posts', {
    token: alice.token,
    body: { body: 'Xin chào <b>HAONLINE</b>', visibility: 'public' },
  });
  assert.equal(created.status, 201);
  const post = created.data.post;
  assert.equal(post.author.username, alice.username);

  const feed = await app.request('GET', '/api/feed?limit=50', { token: bob.token });
  assert.equal(feed.status, 200);
  assert.ok(feed.data.items.some((item) => item.id === post.id));

  const reaction = await app.request('POST', `/api/posts/${post.id}/react`, {
    token: bob.token,
    body: { kind: 'love' },
  });
  assert.equal(reaction.status, 200);
  assert.equal(reaction.data.reaction, 'love');

  const viewed = await app.request('GET', `/api/posts/${post.id}`, { token: bob.token });
  assert.equal(viewed.data.post.reactions.mine, 'love');
  assert.equal(viewed.data.post.reactions.counts.love, 1);

  const comment = await app.request('POST', `/api/posts/${post.id}/comments`, {
    token: bob.token,
    body: { body: 'Bài viết hay' },
  });
  assert.equal(comment.status, 201);
  assert.equal(comment.data.comment.author.id, bob.user.id);

  const comments = await app.request('GET', `/api/posts/${post.id}/comments`, { token: alice.token });
  assert.equal(comments.status, 200);
  assert.equal(comments.data.total, 1);

  const share = await app.request('POST', `/api/posts/${post.id}/share`, {
    token: bob.token,
    body: { body: 'Chia sẻ bài viết', visibility: 'public' },
  });
  assert.equal(share.status, 201);
  assert.equal(share.data.post.shared_post.id, post.id);

  const original = await app.request('GET', `/api/posts/${post.id}`, { token: alice.token });
  assert.equal(original.data.post.shares_count, 1);

  const bookmark = await app.request('POST', '/api/bookmarks', {
    token: bob.token,
    body: { target_type: 'post', target_id: post.id },
  });
  assert.equal(bookmark.status, 201);
  const bookmarks = await app.request('GET', '/api/bookmarks?type=post', { token: bob.token });
  assert.ok(bookmarks.data.items.some((item) => item.target_id === post.id));

  const notifications = await app.request('GET', '/api/notifications', { token: alice.token });
  const kinds = new Set(notifications.data.items.map((n) => n.kind));
  assert.ok(kinds.has('reaction'));
  assert.ok(kinds.has('comment'));
  assert.ok(kinds.has('share'));
});

test('friendship and messaging flow', async () => {
  const request = await app.request('POST', `/api/friends/requests/${bob.user.id}`, { token: alice.token });
  assert.equal(request.status, 201);
  assert.equal(request.data.status, 'request_sent');

  const incoming = await app.request('GET', '/api/friends/requests', { token: bob.token });
  assert.equal(incoming.data.incoming.length, 1);

  const accept = await app.request('POST', `/api/friends/requests/${alice.user.id}/accept`, { token: bob.token });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.status, 'friends');

  const friends = await app.request('GET', '/api/friends', { token: alice.token });
  assert.ok(friends.data.items.some((item) => item.id === bob.user.id));

  const conversation = await app.request('POST', '/api/conversations', {
    token: alice.token,
    body: { kind: 'dm', member_ids: [bob.user.id] },
  });
  assert.equal(conversation.status, 201);
  const conversationId = conversation.data.conversation.id;

  const message = await app.request('POST', `/api/conversations/${conversationId}/messages`, {
    token: alice.token,
    body: { kind: 'text', body: 'Chào Bob' },
  });
  assert.equal(message.status, 201);

  const history = await app.request('GET', `/api/conversations/${conversationId}`, { token: bob.token });
  assert.equal(history.status, 200);
  assert.equal(history.data.messages.length, 1);
  assert.equal(history.data.messages[0].body, 'Chào Bob');

  const unread = await app.request('GET', '/api/conversations', { token: bob.token });
  assert.ok(unread.data.items.some((item) => item.id === conversationId));
});

test('groups, pages and events', async () => {
  const group = await app.request('POST', '/api/groups', {
    token: alice.token,
    body: { name: 'Cộng đồng thử nghiệm', privacy: 'public' },
  });
  assert.equal(group.status, 201);
  const groupId = group.data.group.id;

  const joined = await app.request('POST', `/api/groups/${groupId}/join`, { token: bob.token });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.status, 'active');

  const groupPost = await app.request('POST', '/api/posts', {
    token: bob.token,
    body: { body: 'Bài trong nhóm', group_id: groupId },
  });
  assert.equal(groupPost.status, 201);
  assert.equal(groupPost.data.post.group.id, groupId);

  const page = await app.request('POST', '/api/pages', {
    token: alice.token,
    body: { name: 'HAONLINE Studio', description: 'Trang chính thức', category: 'technology' },
  });
  assert.equal(page.status, 201);
  const pageId = page.data.page.id;

  const followed = await app.request('POST', `/api/pages/${pageId}/follow`, { token: bob.token });
  assert.equal(followed.status, 200);

  const pagePost = await app.request('POST', '/api/posts', {
    token: alice.token,
    body: { body: 'Bài trên trang', page_id: pageId },
  });
  assert.equal(pagePost.status, 201);

  const event = await app.request('POST', '/api/events', {
    token: alice.token,
    body: {
      title: 'Gặp gỡ HAONLINE',
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      location: 'Hà Nội',
    },
  });
  assert.equal(event.status, 201);
  const eventId = event.data.event.id;

  const attend = await app.request('POST', `/api/events/${eventId}/attend`, {
    token: bob.token,
    body: { status: 'going' },
  });
  assert.equal(attend.status, 200);

  const attendees = await app.request('GET', `/api/events/${eventId}/attendees`, { token: alice.token });
  assert.ok(attendees.data.items.some((item) => item.id === bob.user.id));
});

test('media, stories, reels and videos', async () => {
  const upload = await app.request('POST', '/api/media?filename=note.txt&mime=text/plain', {
    token: alice.token,
    headers: { 'Content-Type': 'text/plain' },
    rawBody: Buffer.from('HAONLINE test upload'),
  });
  assert.equal(upload.status, 201);
  assert.ok(upload.data.media.url.startsWith('/uploads/'));

  const rejected = await app.request('POST', '/api/media?filename=evil.html', {
    token: alice.token,
    headers: { 'Content-Type': 'text/html' },
    rawBody: Buffer.from('<script>alert(1)</script>'),
  });
  assert.equal(rejected.status, 400);

  const story = await app.request('POST', '/api/stories', {
    token: alice.token,
    body: { kind: 'image', url: '/uploads/test.jpg', caption: 'Story thử nghiệm' },
  });
  assert.equal(story.status, 201);
  const storyFeed = await app.request('GET', '/api/stories/feed', { token: bob.token });
  assert.ok(storyFeed.data.items.some((group) => group.items.some((item) => item.id === story.data.story.id)));

  const reel = await app.request('POST', '/api/reels', {
    token: alice.token,
    body: { url: '/uploads/reel.mp4', caption: 'Reel thử nghiệm' },
  });
  assert.equal(reel.status, 201);
  const reelView = await app.request('POST', `/api/reels/${reel.data.reel.id}/view`, { token: bob.token });
  assert.equal(reelView.status, 200);
  assert.equal(reelView.data.views, 1);

  const video = await app.request('POST', '/api/videos', {
    token: alice.token,
    body: { title: 'Video thử nghiệm', url: '/uploads/video.mp4' },
  });
  assert.equal(video.status, 201);
  const videoView = await app.request('POST', `/api/videos/${video.data.video.id}/view`, { token: bob.token });
  assert.equal(videoView.status, 200);
  assert.equal(videoView.data.views, 1);
});

test('marketplace, settings, privacy and export', async () => {
  const product = await app.request('POST', '/api/marketplace/products', {
    token: alice.token,
    body: {
      title: 'Laptop cũ',
      price_cents: 25000000,
      description: 'Máy còn tốt',
      category: 'electronics',
      condition: 'used',
    },
  });
  assert.equal(product.status, 201);
  const productId = product.data.product.id;

  const listed = await app.request('GET', '/api/marketplace/products?q=Laptop', { token: bob.token });
  assert.ok(listed.data.items.some((item) => item.id === productId));

  const bookmark = await app.request('POST', '/api/bookmarks', {
    token: bob.token,
    body: { target_type: 'product', target_id: productId },
  });
  assert.equal(bookmark.status, 201);

  const settings = await app.request('PATCH', '/api/settings', {
    token: alice.token,
    body: { settings: { theme: 'light', font_size: 'large', reduce_motion: true } },
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.updated, 3);

  const privacy = await app.request('PATCH', '/api/privacy', {
    token: alice.token,
    body: {
      profile_visibility: 'friends',
      who_can_message: 'friends',
      searchable: false,
    },
  });
  assert.equal(privacy.status, 200);

  const visibleToFriend = await app.request('GET', `/api/users/${alice.user.id}`, { token: bob.token });
  assert.equal(visibleToFriend.data.user.limited, false);

  const exportJob = await app.request('POST', '/api/privacy/export', { token: alice.token });
  assert.equal(exportJob.status, 201);
  const exportStatus = await app.request('GET', `/api/privacy/export/${exportJob.data.job.id}`, { token: alice.token });
  assert.equal(exportStatus.status, 200);
  assert.equal(exportStatus.data.job.status, 'completed');

  const search = await app.request('GET', '/api/search?q=HAONLINE', { token: bob.token });
  assert.equal(search.status, 200);
  assert.ok(Array.isArray(search.data.posts));
});

test('analytics and monetization endpoints', async () => {
  const analytics = await app.request('GET', '/api/analytics/me', { token: alice.token });
  assert.equal(analytics.status, 200);
  assert.ok(analytics.data.posts >= 1);
  assert.ok(Array.isArray(analytics.data.top_posts));

  const status = await app.request('GET', '/api/monetization/status', { token: alice.token });
  assert.equal(status.status, 200);

  const ad = await app.request('POST', '/api/monetization/ads', {
    token: alice.token,
    body: {
      name: 'Chiến dịch thử nghiệm',
      creative_text: 'Quảng cáo HAONLINE',
      budget_cents: 100000,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
  });
  assert.equal(ad.status, 201);

  const unpaid = await app.request('POST', `/api/monetization/ads/${ad.data.campaign.id}/activate`, { token: alice.token });
  assert.equal(unpaid.status, 400);
  assert.equal(unpaid.data.error.code, 'bad_request');

  const paused = await app.request('POST', `/api/monetization/ads/${ad.data.campaign.id}/pause`, { token: alice.token });
  assert.equal(paused.status, 200);
  assert.equal(paused.data.status, 'paused');
});
