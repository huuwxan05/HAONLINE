import { api, auth } from '../api.js';
import {
  icon, esc, avatar, toast, spinner, empty, navigate,
} from '../ui.js';
import {
  postCard, bindPostInteractions, bindFollowButtons, followButton, openComposer,
} from '../components.js';
import { openStoryViewer, openStoryCreator } from './media.js';

function mountPosts(box, items, { prepend = false } = {}) {
  if (!box._postIndex) box._postIndex = new Map();
  for (const post of items) box._postIndex.set(post.id, post);
  const html = items.map(postCard).join('');
  if (prepend) box.insertAdjacentHTML('afterbegin', html);
  else box.insertAdjacentHTML('beforeend', html);
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    bindPostInteractions(box, {
      onChanged: (post, action) => {
        if (action === 'share' && post?.id) {
          box._postIndex.set(post.id, post);
          box.insertAdjacentHTML('afterbegin', postCard(post));
        }
      },
      onDeleted: (post) => {
        box._postIndex.delete(post.id);
        box.querySelector(`[data-post-id="${post.id}"]`)?.remove();
      },
    });
  }
}

async function storyRail(container) {
  try {
    const data = await api.get('/api/stories/feed');
    const own = data.items.find((g) => g.author.id === auth.user.id);
    const groups = [
      ...(own ? [own] : []),
      ...data.items.filter((g) => g.author.id !== auth.user.id),
    ];
    container.innerHTML = `
      <button class="story-item" id="story-add">
        <span class="story-add">${icon('plus', 24)}</span><span>Tạo tin</span>
      </button>
      ${groups.map((g, i) => `
        <button class="story-item js-open-story" data-index="${i}">
          <span class="avatar-ring">${avatar(g.author, 62)}</span>
          <span>${esc(g.author.id === auth.user.id ? 'Tin của bạn' : g.author.display_name)}</span>
        </button>`).join('')}`;
    container.querySelector('#story-add').onclick = () => openStoryCreator(() => storyRail(container));
    container.querySelectorAll('.js-open-story').forEach((btn) => {
      btn.onclick = () => openStoryViewer(groups, Number(btn.dataset.index));
    });
  } catch {
    container.innerHTML = `<button class="story-item" id="story-add"><span class="story-add">${icon('plus', 24)}</span><span>Tạo tin</span></button>`;
    container.querySelector('#story-add').onclick = () => openStoryCreator(() => storyRail(container));
  }
}

async function loadRail(container) {
  try {
    const [suggestions, trending, ads] = await Promise.all([
      api.get('/api/users/suggestions?limit=4').catch(() => ({ items: [] })),
      api.get('/api/analytics/trending').catch(() => ({ hashtags: [] })),
      api.get('/api/feed/sponsored').catch(() => ({ items: [] })),
    ]);
    container.innerHTML = `
      <div class="card rail-card">
        <div class="section-head"><h2>Gợi ý kết nối</h2><a href="#/friends">Tất cả</a></div>
        <div id="suggest-list">${suggestions.items.map((u) => `
          <div class="suggest-row">
            <a href="#/profile/${esc(u.username)}">${avatar(u, 40)}</a>
            <div class="grow"><a class="suggest-name truncate" href="#/profile/${esc(u.username)}">${esc(u.display_name)}</a><div class="suggest-handle truncate">@${esc(u.username)}${u.mutual ? ` · ${u.mutual} bạn chung` : ''}</div></div>
            ${followButton(u)}
          </div>`).join('') || '<p class="muted small">Chưa có gợi ý</p>'}</div>
        <a class="btn btn-ghost btn-block btn-sm mt" href="#/friends">Xem mọi người</a>
      </div>
      ${ads.items?.length ? `<div class="card rail-card">
        <div class="row-between mb"><span class="badge badge-warning">${icon('sparkles', 12)} Được tài trợ</span></div>
        <div class="strong mb">${esc(ads.items[0].text || ads.items[0].name)}</div>
        <button class="btn btn-soft btn-block btn-sm" id="ad-cta">Tìm hiểu thêm</button>
      </div>` : ''}
      <div class="card rail-card">
        <div class="section-head"><h2>Xu hướng tuần</h2><a href="#/search">Khám phá</a></div>
        ${(trending.hashtags || []).slice(0, 6).map((t, i) => `
          <a class="trend" href="#/search?q=${encodeURIComponent(t.tag)}">
            <span class="trend-rank">${i + 1}</span>
            <div class="grow"><div class="strong small">${esc(t.tag)}</div><div class="tiny faint">${t.count} bài viết</div></div>
          </a>`).join('') || '<p class="muted small">Chưa đủ dữ liệu xu hướng</p>'}
      </div>
      <div class="card rail-card">
        <div class="section-head"><h2>Đang diễn ra</h2></div>
        <a class="suggest-row" href="#/reels">${icon('video', 20)}<div class="grow"><div class="suggest-name">Reels</div><div class="suggest-handle">Video ngắn đang hot</div></div>${icon('chevronDown', 16)}</a>
        <a class="suggest-row" href="#/live">${icon('radio', 20)}<div class="grow"><div class="suggest-name">Livestream</div><div class="suggest-handle">Phát trực tiếp</div></div></a>
        <a class="suggest-row" href="#/marketplace">${icon('shopping', 20)}<div class="grow"><div class="suggest-name">Chợ</div><div class="suggest-handle">Mua bán trong cộng đồng</div></div></a>
      </div>`;
    bindFollowButtons(container, () => {});
    const ad = ads.items?.[0];
    if (ad) {
      container.querySelector('#ad-cta').onclick = async () => {
        try { await api.post(`/api/monetization/ads/${ad.id}/click`); } catch { /* ignore */ }
        if (ad.url) window.open(ad.url, '_blank', 'noopener');
        else toast('Nhà quảng cáo chưa cung cấp liên kết', 'info');
      };
    }
  } catch (err) {
    container.innerHTML = '';
  }
}

export async function renderFeed(container) {
  container.innerHTML = `
    <div class="layout-feed">
      <div>
        <section class="feed-hero" id="feed-hero">
          <div class="feed-hero-glow"></div>
          <div class="feed-hero-copy">
            <span class="feed-hero-eyebrow">${icon('sparkles', 13)} Không gian của bạn</span>
            <h1>Xin chào, <span>${esc(auth.user.display_name.split(' ')[0])}</span></h1>
            <p>Một nơi để chia sẻ khoảnh khắc, theo dõi cộng đồng và kết nối với những người bạn quan tâm.</p>
            <div class="feed-hero-actions">
              <button class="btn btn-primary" id="hero-compose">${icon('edit', 16)} Chia sẻ khoảnh khắc</button>
              <a class="btn btn-glass" href="#/reels">${icon('play', 16)} Xem reel</a>
            </div>
            <div class="feed-hero-chips">
              <span>${icon('video', 13)} Reels</span>
              <span>${icon('radio', 13)} Livestream</span>
              <span>${icon('users', 13)} Cộng đồng</span>
            </div>
          </div>
          <div class="feed-hero-art">
            <img src="/assets/hero-art.svg" alt="" aria-hidden="true" decoding="async">
          </div>
        </section>
        <div class="card composer fade-up">
          <div class="composer-row">
            ${avatar(auth.user, 42)}
            <button class="composer-fake" id="open-composer">Bạn đang nghĩ gì, ${esc(auth.user.display_name.split(' ')[0])}?</button>
          </div>
          <div class="composer-actions">
            <button class="composer-action" id="quick-photo">${icon('image', 18)} Ảnh / video</button>
            <button class="composer-action" id="quick-live" style="color:var(--danger)">${icon('radio', 18)} Livestream</button>
            <button class="composer-action" id="quick-reel">${icon('video', 18)} Reel</button>
          </div>
        </div>
        <div class="card fade-up" style="margin-bottom:16px"><div class="story-rail" id="story-rail">${spinner('Đang tải tin…')}</div></div>
        <div class="tabs mb" id="feed-tabs">
          <button class="tab active" data-scope="">Dành cho bạn</button>
          <button class="tab" data-scope="friends">Bạn bè</button>
          <button class="tab" data-scope="following">Đang theo dõi</button>
        </div>
        <div id="feed-list"></div>
        <div id="feed-more" class="center mt"></div>
      </div>
      <aside class="rail" id="feed-rail"></aside>
    </div>`;

  const storyRailEl = container.querySelector('#story-rail');
  storyRail(storyRailEl);
  loadRail(container.querySelector('#feed-rail'));

  const open = (opts = {}) => openComposer({
    ...opts,
    onCreated: (post) => {
      const box = container.querySelector('#feed-list');
      mountPosts(box, [post], { prepend: true });
    },
  });
  const hero = container.querySelector('#feed-hero');
  container.querySelector('#hero-compose').onclick = () => open();
  if (hero && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.setProperty('--px', '0');
      hero.style.setProperty('--py', '0');
    });
  }
  container.querySelector('#open-composer').onclick = () => open();
  container.querySelector('#quick-photo').onclick = () => open();
  container.querySelector('#quick-live').onclick = () => goLive();
  container.querySelector('#quick-reel').onclick = () => import('./media.js').then((m) => m.openReelCreator(() => navigate('/reels')));

  const list = container.querySelector('#feed-list');
  const more = container.querySelector('#feed-more');
  let scope = '';
  let offset = 0;
  let total = 0;
  let loading = false;

  async function load(reset = false) {
    if (loading) return;
    loading = true;
    if (reset) {
      offset = 0;
      list.innerHTML = '';
      if (!list._postIndex) list._postIndex = new Map();
      list._postIndex.clear();
    }
    more.innerHTML = spinner('Đang tải bài viết…');
    try {
      const data = await api.get(`/api/feed?limit=12&offset=${offset}${scope ? `&scope=${scope}` : ''}`);
      total = data.total;
      offset += data.items.length;
      if (!data.items.length && reset) {
        list.innerHTML = empty('Bảng tin đang trống. Hãy tạo bài viết đầu tiên!', 'home', '<button class="btn btn-primary" id="empty-create">Tạo bài viết</button>');
        list.querySelector('#empty-create').onclick = () => open();
      } else {
        mountPosts(list, data.items);
      }
      more.innerHTML = offset < total
        ? `<button class="btn btn-ghost" id="load-more">Xem thêm (${total - offset})</button>`
        : `<span class="faint small">Bạn đã xem hết bảng tin</span>`;
      const moreBtn = more.querySelector('#load-more');
      if (moreBtn) moreBtn.onclick = () => load();
    } catch (err) {
      more.innerHTML = `<div class="empty-state error-state"><p>${esc(err.message)}</p><button class="btn btn-ghost" id="retry">Thử lại</button></div>`;
      more.querySelector('#retry').onclick = () => load(true);
    } finally {
      loading = false;
    }
  }

  container.querySelector('#feed-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#feed-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope = tab.dataset.scope;
    load(true);
  });

  window.addEventListener('haonline:new-post', (e) => {
    mountPosts(list, [e.detail], { prepend: true });
  });

  load(true);
}

function goLive() {
  import('./media.js').then((m) => m.openGoLive());
}

export async function renderPostDetail(container, params) {
  container.innerHTML = `<div style="max-width:680px;margin:0 auto">${spinner('Đang tải bài viết…')}</div>`;
  try {
    const data = await api.get(`/api/posts/${params.id}`);
    const post = data.post || data;
    container.innerHTML = `<div style="max-width:680px;margin:0 auto">
      <button class="btn btn-ghost btn-sm mb" id="post-back">${icon('back', 16)} Quay lại</button>
      <div id="post-detail">${postCard(post)}</div>
    </div>`;
    container.querySelector('#post-back').addEventListener('click', () => (history.length > 1 ? history.back() : navigate('/feed')));
    const box = container.querySelector('#post-detail');
    box._postIndex = new Map([[post.id, post]]);
    bindPostInteractions(box);
    box.querySelector('.js-comment-toggle').click();
  } catch (err) {
    container.innerHTML = `<div class="empty-state error-state"><p>${esc(err.message)}</p><a class="btn btn-ghost" href="#/feed">Về bảng tin</a></div>`;
  }
}
