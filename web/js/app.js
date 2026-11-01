import { api, auth, clearToken, loadMe, connectStream, disconnectStream } from './api.js';
import { icon, avatar, esc, toast, modal, confirmDialog, timeAgo, navigate as go, empty, initReveal } from './ui.js';
import { register, startRouter, currentPath } from './router.js';
import { renderAuth } from './auth.js';
import { renderFeed, renderPostDetail } from './views/feed.js';
import { renderProfile } from './views/profile.js';
import { renderFriends } from './views/friends.js';
import { renderMessages } from './views/messages.js';
import { renderStories, renderReels, renderVideos, renderLive, renderLiveRoom } from './views/media.js';
import { renderGroups, renderGroup, renderPages, renderPage, renderEvents, renderEvent } from './views/communities.js';
import { renderNotifications, renderSearch, renderBookmarks, renderMemories } from './views/discover.js';
import { renderMarketplace } from './views/marketplace.js';
import { renderAnalytics } from './views/analytics.js';
import { renderMonetization } from './views/monetization.js';
import { renderSettings } from './views/settings.js';
import { renderAdmin, renderModeration } from './views/admin.js';
import { handleCallEvent, hangupActive } from './calls.js';

const NAV = [
  { section: 'Không gian' },
  { path: '/feed', label: 'Bảng tin', icon: 'home' },
  { path: '/friends', label: 'Bạn bè', icon: 'users' },
  { path: '/messages', label: 'Tin nhắn', icon: 'message', badge: 'messages' },
  { path: '/notifications', label: 'Thông báo', icon: 'bell', badge: 'notifications' },
  { section: 'Khám phá' },
  { path: '/stories', label: 'Tin 24 giờ', icon: 'clock' },
  { path: '/reels', label: 'Reels', icon: 'video' },
  { path: '/videos', label: 'Video', icon: 'grid' },
  { path: '/live', label: 'Livestream', icon: 'radio' },
  { path: '/groups', label: 'Nhóm', icon: 'users' },
  { path: '/pages', label: 'Trang', icon: 'flag' },
  { path: '/events', label: 'Sự kiện', icon: 'calendar' },
  { path: '/marketplace', label: 'Chợ', icon: 'shopping' },
  { section: 'Thư viện' },
  { path: '/bookmarks', label: 'Đã lưu', icon: 'bookmark' },
  { path: '/memories', label: 'Kỷ niệm', icon: 'sparkles' },
  { path: '/analytics', label: 'Thống kê', icon: 'chart' },
  { path: '/monetization', label: 'Kiếm tiền', icon: 'wallet' },
];

const TITLES = Object.fromEntries(NAV.filter((n) => n.path).map((n) => [n.path, n.label]));

function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme || 'dark';
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem('haonline.theme', theme || 'dark');
}

function shell() {
  const staff = ['admin', 'moderator'].includes(auth.user.role);
  document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#/feed">
          <span class="brand-mark">H</span>
          <div><div class="brand-name"><span>HAONLINE</span></div><div class="brand-sub">Social ecosystem</div></div>
        </a>
        <button class="btn btn-primary btn-block" id="btn-create">${icon('plus', 18)} Tạo bài viết</button>
        <nav class="nav">
          ${NAV.map((item) => item.section
            ? `<div class="nav-label">${esc(item.section)}</div>`
            : `<a class="nav-link" href="#${item.path}" data-nav="${item.path}">${icon(item.icon, 20)}<span>${esc(item.label)}</span>${item.badge ? `<span class="nav-badge zero" id="badge-${item.badge}"></span>` : ''}</a>`).join('')}
          ${staff ? `<div class="nav-label">Hệ thống</div>
            <a class="nav-link" href="#/moderation" data-nav="/moderation">${icon('shield', 20)}<span>Kiểm duyệt</span></a>
            <a class="nav-link" href="#/admin" data-nav="/admin">${icon('settings', 20)}<span>Quản trị</span></a>` : ''}
        </nav>
        <div class="sidebar-foot">
          <a class="user-chip" href="#/settings" id="sidebar-user">
            ${avatar(auth.user, 38)}
            <div class="grow"><div class="user-chip-name truncate">${esc(auth.user.display_name)}</div><div class="user-chip-handle truncate">@${esc(auth.user.username)}</div></div>
            ${icon('settings', 18)}
          </a>
          <button class="btn btn-ghost btn-block btn-sm mt" id="btn-logout">${icon('logout', 16)} Đăng xuất</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar-title" id="page-title">Bảng tin</div>
          <form class="search-pill" id="search-form" role="search">
            ${icon('search', 18)}
            <input type="search" id="search-input" placeholder="Tìm người, bài viết, nhóm, sản phẩm…" autocomplete="off" aria-label="Tìm kiếm">
            <kbd>/</kbd>
          </form>
          <div class="topbar-actions">
            <button class="icon-btn" id="btn-theme" title="Đổi giao diện" aria-label="Đổi giao diện">${icon('moon', 20)}</button>
            <button class="icon-btn" id="btn-notif" title="Thông báo" aria-label="Thông báo" style="position:relative">${icon('bell', 20)}<span class="dot hide" id="notif-dot"></span></button>
            <a class="icon-btn" href="#/messages" title="Tin nhắn" aria-label="Tin nhắn">${icon('message', 20)}</a>
            <button class="btn btn-ghost btn-sm topbar-logout" id="btn-logout-top" title="Đăng xuất" aria-label="Đăng xuất">${icon('logout', 16)}<span>Đăng xuất</span></button>
            <a href="#/profile/${esc(auth.user.username)}" title="Hồ sơ">${avatar(auth.user, 36)}</a>
          </div>
        </header>
        <main class="view-wrap" id="view"></main>
      </div>
      <nav class="mobile-nav">
        <a href="#/feed" data-nav="/feed">${icon('home', 21)}<span>Feed</span></a>
        <a href="#/friends" data-nav="/friends">${icon('users', 21)}<span>Bạn bè</span></a>
        <a href="#/messages" data-nav="/messages">${icon('message', 21)}<span>Tin nhắn</span></a>
        <a href="#/reels" data-nav="/reels">${icon('video', 21)}<span>Reels</span></a>
        <button class="icon-btn" id="btn-more" style="flex-direction:column;gap:2px;font-size:10px;height:auto;width:auto;padding:6px 10px">${icon('menu', 21)}<span>Thêm</span></button>
      </nav>
    </div>`;

  const view = document.getElementById('view');
  const setActive = () => {
    const path = currentPath();
    const root = path.split('/')[1] || 'feed';
    document.querySelectorAll('[data-nav]').forEach((link) => {
      const key = (link.dataset.nav || '').split('/')[1];
      link.classList.toggle('active', key === root);
    });
    const title = TITLES[`/${root}`] || (root === 'profile' ? 'Hồ sơ' : root === 'admin' ? 'Quản trị' : root === 'moderation' ? 'Kiểm duyệt' : root === 'post' ? 'Bài viết' : root === 'search' ? 'Tìm kiếm' : 'HAONLINE');
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = title;
    document.title = `${title} · HAONLINE`;
  };
  window.addEventListener('hashchange', setActive);
  setActive();

  document.getElementById('btn-create').onclick = () => import('./components.js').then((m) => m.openComposer({
    onCreated: (post) => {
      if (currentPath() === '/feed') window.dispatchEvent(new CustomEvent('haonline:new-post', { detail: post }));
      else go('/feed');
    },
  }));

  const themeBtn = document.getElementById('btn-theme');
  const syncThemeIcon = () => {
    const light = document.documentElement.dataset.theme === 'light';
    themeBtn.innerHTML = icon(light ? 'sun' : 'moon', 20);
  };
  syncThemeIcon();
  themeBtn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    syncThemeIcon();
    if (auth.user) api.patch('/api/settings', { settings: { theme: next } }).catch(() => {});
  };

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  searchForm.onsubmit = (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q) go(`/search?q=${encodeURIComponent(q)}`);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  document.getElementById('btn-notif').onclick = openNotifPanel;
  document.getElementById('btn-more').onclick = openMore;
  const requestLogout = async () => {
    if (!(await confirmDialog('Đăng xuất khỏi HAONLINE?', { confirmText: 'Đăng xuất', danger: true }))) return;
    window.dispatchEvent(new Event('haonline:logout'));
  };
  document.getElementById('btn-logout').onclick = requestLogout;
  document.getElementById('btn-logout-top').onclick = requestLogout;

  initReveal(view);
  startRouter(view);
}

function openMore() {
  const staff = ['admin', 'moderator'].includes(auth.user.role);
  const groups = NAV.filter((n) => n.path);
  const m = modal({
    title: 'Khám phá HAONLINE',
    wide: true,
    content: `<div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
      ${groups.map((n) => `<a class="btn btn-ghost" href="#${n.path}" data-close style="justify-content:flex-start">${icon(n.icon, 18)} ${esc(n.label)}</a>`).join('')}
      ${staff ? `<a class="btn btn-ghost" href="#/moderation" data-close style="justify-content:flex-start">${icon('shield', 18)} Kiểm duyệt</a><a class="btn btn-ghost" href="#/admin" data-close style="justify-content:flex-start">${icon('settings', 18)} Quản trị</a>` : ''}
      <a class="btn btn-ghost" href="#/settings" data-close style="justify-content:flex-start">${icon('user', 18)} Cài đặt</a>
    </div>
    <button class="btn btn-ghost btn-block mt" id="more-logout" style="color:var(--danger)">${icon('logout', 18)} Đăng xuất</button>`,
  });
  m.overlay.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', m.close));
  m.overlay.querySelector('#more-logout').onclick = async () => {
    if (!(await confirmDialog('Đăng xuất khỏi HAONLINE?', { confirmText: 'Đăng xuất', danger: true }))) return;
    m.close();
    window.dispatchEvent(new Event('haonline:logout'));
  };
}

let notifOpen = false;
async function openNotifPanel() {
  document.querySelector('.notif-pop')?.remove();
  if (notifOpen) { notifOpen = false; return; }
  notifOpen = true;
  const pop = document.createElement('div');
  pop.className = 'notif-pop card';
  pop.innerHTML = `<div class="row-between" style="padding:8px 10px"><b>Thông báo</b><a class="link" href="#/notifications" data-all>Xem tất cả</a></div><div id="notif-pop-list">${'<div class="loading"><span class="spinner"></span></div>'}</div>`;
  document.body.appendChild(pop);
  pop.querySelector('[data-all]').onclick = () => { pop.remove(); notifOpen = false; };
  const close = (e) => {
    if (!pop.contains(e.target) && !e.target.closest('#btn-notif')) {
      pop.remove(); notifOpen = false; document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
  try {
    const data = await api.get('/api/notifications?limit=8');
    pop.querySelector('#notif-pop-list').innerHTML = data.items.length ? data.items.map((n) => `
      <div class="notif-item ${n.read_at ? '' : 'unread'}" data-id="${esc(n.id)}" data-target="${esc(n.target_type || '')}" data-tid="${esc(n.target_id || '')}" style="cursor:pointer">
        ${avatar(n.actor || { display_name: 'HAONLINE' }, 34)}
        <div class="grow"><div class="notif-text">${esc(notifText(n))}</div><div class="notif-time">${timeAgo(n.created_at)}</div></div>
      </div>`).join('') : `<p class="muted small" style="padding:14px">Chưa có thông báo</p>`;
    pop.querySelectorAll('.notif-item').forEach((item) => {
      item.onclick = async () => {
        try { await api.post(`/api/notifications/${item.dataset.id}/read`); } catch { /* ignore */ }
        navigateNotif(item.dataset.target, item.dataset.tid);
        pop.remove(); notifOpen = false;
        refreshBadges();
      };
    });
  } catch (err) {
    pop.querySelector('#notif-pop-list').innerHTML = `<p class="error-text small" style="padding:14px">${esc(err.message)}</p>`;
  }
}

function notifText(n) {
  const name = n.actor?.display_name || 'Ai đó';
  const map = {
    reaction: `${name} đã bày tỏ cảm xúc về bài viết của bạn`,
    comment: `${name} đã bình luận bài viết của bạn`,
    reply: `${name} đã trả lời bình luận của bạn`,
    share: `${name} đã chia sẻ bài viết của bạn`,
    follow: `${name} đã theo dõi bạn`,
    friend_request: `${name} đã gửi lời mời kết bạn`,
    friend_accept: `${name} đã chấp nhận lời mời kết bạn`,
    mention: `${name} đã nhắc đến bạn`,
    message: `${name} đã gửi tin nhắn`,
    story: `${name} đã đăng tin mới`,
    live_viewer: `${name} đang xem buổi phát của bạn`,
    welcome: 'Chào mừng bạn đến với HAONLINE',
    email_verified: 'Email của bạn đã được xác minh',
    report_result: 'Báo cáo của bạn đã được xử lý',
    moderation_warning: 'Bạn nhận được cảnh cáo từ kiểm duyệt viên',
    payout_update: 'Yêu cầu chi trả của bạn đã được cập nhật',
    conversation: `${name} đã tạo cuộc trò chuyện`,
    story_like: `${name} đã thích tin của bạn`,
  };
  return map[n.kind] || n.data?.message || `Thông báo mới từ ${name}`;
}

function navigateNotif(type, id) {
  const paths = {
    post: `/post/${id}`, user: null, conversation: `/messages/${id}`, story: '/stories', live: `/live/${id}`,
    comment: null, reel: '/reels', product: '/marketplace',
  };
  if (type === 'user') {
    api.get(`/api/users/${id}`).then((d) => go(`/profile/${d.user.username}`)).catch(() => go('/notifications'));
    return;
  }
  if (type === 'payout' || type === 'earning') { go('/monetization'); return; }
  if (paths[type]) go(paths[type]);
  else go('/notifications');
}

async function refreshBadges() {
  try {
    const [notifs, convs] = await Promise.all([
      api.get('/api/notifications?limit=1&unread=true'),
      api.get('/api/conversations?limit=50'),
    ]);
    setBadge('notifications', notifs.unread || 0);
    const msg = convs.items.reduce((sum, c) => sum + (c.unread || 0), 0);
    setBadge('messages', msg);
    const dot = document.getElementById('notif-dot');
    if (dot) dot.classList.toggle('hide', !(notifs.unread > 0));
  } catch { /* offline */ }
}

function setBadge(name, count) {
  document.querySelectorAll(`#badge-${name}`).forEach((el) => {
    el.textContent = count > 99 ? '99+' : count ? String(count) : '';
    el.classList.toggle('zero', !count);
  });
}

function streamHandlers() {
  return {
    notification: (payload) => {
      const n = payload.notification || payload;
      toast(notifText(n), 'info', 5000);
      refreshBadges();
      window.dispatchEvent(new CustomEvent('haonline:notification', { detail: n }));
    },
    message: (payload) => {
      const msg = payload.message || {};
      if (msg.sender?.id === auth.user.id) return;
      const path = currentPath();
      if (path.startsWith('/messages')) {
        window.dispatchEvent(new CustomEvent('haonline:message', { detail: payload }));
      } else {
        toast(`${msg.sender?.display_name || 'Tin nhắn mới'}: ${msg.body ? String(msg.body).slice(0, 90) : '[tệp]'}`, 'info', 4500);
      }
      refreshBadges();
      window.dispatchEvent(new CustomEvent('haonline:message-badge'));
    },
    conversation_new: () => { refreshBadges(); window.dispatchEvent(new CustomEvent('haonline:conversations')); },
    conversation_update: () => { window.dispatchEvent(new CustomEvent('haonline:conversations')); },
    typing: (payload) => window.dispatchEvent(new CustomEvent('haonline:typing', { detail: payload })),
    call_incoming: (payload) => handleCallEvent('incoming', payload),
    call_answered: (payload) => handleCallEvent('answered', payload),
    call_signal: (payload) => handleCallEvent('signal', payload),
    call_ended: (payload) => handleCallEvent('ended', payload),
    live_comment: (payload) => window.dispatchEvent(new CustomEvent('haonline:live', { detail: { type: 'comment', ...payload } })),
    live_join: (payload) => window.dispatchEvent(new CustomEvent('haonline:live', { detail: { type: 'join', ...payload } })),
    live_signal: (payload) => window.dispatchEvent(new CustomEvent('haonline:live', { detail: { type: 'signal', ...payload } })),
    live_ended: (payload) => window.dispatchEvent(new CustomEvent('haonline:live', { detail: { type: 'ended', ...payload } })),
    notification_new: () => refreshBadges(),
  };
}

async function boot() {
  applyTheme(localStorage.getItem('haonline.theme') || 'dark');
  if (!auth.token) {
    renderAuth(() => { window.location.hash = '#/feed'; boot(); });
    return;
  }
  try {
    await loadMe();
    if (auth.settings?.theme) applyTheme(auth.settings.theme);
  } catch (err) {
    clearToken();
    renderAuth(() => boot());
    return;
  }
  shell();
  connectStream(streamHandlers());
  refreshBadges();
  const ping = setInterval(() => {
    if (document.hidden) return;
    api.post('/api/presence/ping').catch(() => {});
  }, 60000);
  api.post('/api/presence/ping').catch(() => {});
  window.addEventListener('beforeunload', () => clearInterval(ping));
  window.addEventListener('haonline:unauthorized', async () => {
    clearToken();
    disconnectStream();
    toast('Phiên đăng nhập đã hết hạn', 'error');
    renderAuth(() => boot());
  });
  window.addEventListener('haonline:logout', async () => {
    try { await api.post('/api/auth/logout'); } catch { /* already expired */ }
    clearToken();
    disconnectStream();
    hangupActive();
    renderAuth(() => boot());
  });
}

register('/', (c) => { go('/feed', { replace: true }); return null; });
register('/feed', (c) => renderFeed(c));
register('/post/:id', (c, p) => renderPostDetail(c, p));
register('/profile/:username', (c, p) => renderProfile(c, p));
register('/friends', (c) => renderFriends(c));
register('/messages', (c) => renderMessages(c, {}));
register('/messages/:id', (c, p) => renderMessages(c, p));
register('/notifications', (c) => renderNotifications(c));
register('/stories', (c) => renderStories(c));
register('/reels', (c) => renderReels(c));
register('/videos', (c) => renderVideos(c));
register('/live', (c) => renderLive(c));
register('/live/:id', (c, p) => renderLiveRoom(c, p));
register('/groups', (c) => renderGroups(c));
register('/groups/:id', (c, p) => renderGroup(c, p));
register('/pages', (c) => renderPages(c));
register('/pages/:id', (c, p) => renderPage(c, p));
register('/events', (c) => renderEvents(c));
register('/events/:id', (c, p) => renderEvent(c, p));
register('/marketplace', (c) => renderMarketplace(c));
register('/bookmarks', (c) => renderBookmarks(c));
register('/memories', (c) => renderMemories(c));
register('/analytics', (c) => renderAnalytics(c));
register('/monetization', (c) => renderMonetization(c));
register('/settings', (c, p, q) => renderSettings(c, q));
register('/admin', (c) => {
  if (auth.user.role !== 'admin') { c.innerHTML = empty('Bạn không có quyền truy cập', 'shield'); return null; }
  return renderAdmin(c);
});
register('/moderation', (c) => {
  if (!['admin', 'moderator'].includes(auth.user.role)) { c.innerHTML = empty('Bạn không có quyền truy cập', 'shield'); return null; }
  return renderModeration(c);
});
register('/search', (c, p, q) => renderSearch(c, q));
register('/auth', () => { clearToken(); boot(); return null; });

boot();
