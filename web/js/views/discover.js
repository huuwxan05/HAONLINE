import { api } from '../api.js';
import {
  icon, esc, avatar, timeAgo, fullDate, money, toast, spinner, empty, navigate,
} from '../ui.js';
import { postCard, bindPostInteractions, linkify } from '../components.js';

function targetUrl(n) {
  const t = n.target_type;
  const id = n.target_id;
  if (t === 'post') return `#/post/${id}`;
  if (t === 'video') return '#/videos';
  if (t === 'reel') return '#/reels';
  if (t === 'product') return `#/marketplace?product=${id}`;
  if (t === 'group') return `#/groups/${id}`;
  if (t === 'page') return `#/pages/${id}`;
  if (t === 'event') return `#/events/${id}`;
  if (t === 'conversation') return `#/messages/${id}`;
  if (t === 'story') return '#/stories';
  if (t === 'live') return `#/live/${id}`;
  if (t === 'user') return `#/profile/${n.data?.username || ''}`;
  return null;
}

const NOTIF_TEXT = {
  reaction: (n) => `${n.actor?.display_name || 'Ai đó'} đã bày tỏ cảm xúc về bài viết của bạn`,
  comment: (n) => `${n.actor?.display_name || 'Ai đó'} đã bình luận bài viết của bạn`,
  follow: (n) => `${n.actor?.display_name || 'Ai đó'} đã theo dõi bạn`,
  friend_request: (n) => `${n.actor?.display_name || 'Ai đó'} đã gửi lời mời kết bạn`,
  friend_accept: (n) => `${n.actor?.display_name || 'Ai đó'} đã chấp nhận lời mời kết bạn`,
  message: (n) => `${n.actor?.display_name || 'Ai đó'} đã gửi tin nhắn`,
  mention: (n) => `${n.actor?.display_name || 'Ai đó'} đã nhắc đến bạn`,
  share: (n) => `${n.actor?.display_name || 'Ai đó'} đã chia sẻ bài viết của bạn`,
  story: (n) => `${n.actor?.display_name || 'Ai đó'} vừa đăng tin mới`,
  live_viewer: (n) => `${n.actor?.display_name || 'Ai đó'} đang xem buổi phát của bạn`,
  call: (n) => `${n.actor?.display_name || 'Ai đó'} đã gọi cho bạn`,
  group_join: (n) => `${n.actor?.display_name || 'Ai đó'} đã tham gia nhóm của bạn`,
  group_join_request: (n) => `${n.actor?.display_name || 'Ai đó'} yêu cầu tham gia nhóm`,
  group_approved: () => 'Yêu cầu tham gia nhóm của bạn đã được duyệt',
  event_invite: (n) => `${n.actor?.display_name || 'Ai đó'} mời bạn tham gia sự kiện`,
  event_attend: (n) => `${n.actor?.display_name || 'Ai đó'} sẽ tham gia sự kiện của bạn`,
  page_follow: (n) => `${n.actor?.display_name || 'Ai đó'} đã theo dõi trang của bạn`,
};

const NOTIF_ICON = {
  reaction: 'heart', comment: 'comment', follow: 'userPlus', friend_request: 'userPlus', friend_accept: 'check',
  message: 'message', mention: 'user', share: 'share', story: 'clock', live_viewer: 'eye', call: 'phone',
  group_join: 'users', group_join_request: 'users', group_approved: 'check', event_invite: 'calendar',
  event_attend: 'calendar', page_follow: 'flag', report_result: 'shield',
};

export async function renderNotifications(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Thông báo</h1><p class="page-sub">Cập nhật mọi hoạt động liên quan đến bạn.</p></div>
      <button class="btn btn-ghost" id="read-all">${icon('check', 16)} Đánh dấu đã đọc</button>
    </div>
    <div class="tabs mb" id="notif-tabs"><button class="tab active" data-filter="all">Tất cả</button><button class="tab" data-filter="unread">Chưa đọc</button></div>
    <div id="notif-body">${spinner()}</div>`;
  let filter = 'all';
  const body = container.querySelector('#notif-body');

  container.querySelector('#notif-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#notif-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    filter = tab.dataset.filter;
    load();
  };
  container.querySelector('#read-all').onclick = async () => {
    try { await api.post('/api/notifications/read-all'); toast('Đã đánh dấu tất cả là đã đọc', 'success'); load(); window.dispatchEvent(new CustomEvent('haonline:notification-read')); }
    catch (err) { toast(err.message, 'error'); }
  };

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/notifications?limit=50${filter === 'unread' ? '&unread=true' : ''}`);
      if (!d.items.length) { body.innerHTML = empty('Không có thông báo nào', 'bell'); return; }
      body.innerHTML = `<div class="card list-card">${d.items.map((n) => {
        const url = targetUrl(n);
        const text = (NOTIF_TEXT[n.kind] || (() => `${n.actor?.display_name || 'Ai đó'} đã tương tác với bạn`))(n);
        return `<div class="notif-row ${n.read_at ? 'read' : 'unread'}" data-id="${esc(n.id)}" ${url ? `data-url="${esc(url)}"` : ''}>
          <span class="notif-icon">${icon(NOTIF_ICON[n.kind] || 'bell', 18)}</span>
          ${n.actor ? `<a href="#/profile/${esc(n.actor.username)}">${avatar(n.actor, 40)}</a>` : `<span class="notif-icon">${icon('bell', 20)}</span>`}
          <div class="grow"><div class="small">${esc(text)}</div><div class="tiny muted">${timeAgo(n.created_at)}</div></div>
          ${n.read_at ? '' : '<span class="unread-dot"></span>'}
          <button class="icon-btn" data-del="${esc(n.id)}" title="Xóa">${icon('trash', 15)}</button>
        </div>`;
      }).join('')}</div>`;
      body.querySelectorAll('.notif-row').forEach((row) => {
        row.addEventListener('click', async (e) => {
          if (e.target.closest('[data-del]')) return;
          const id = row.dataset.id;
          try { await api.post(`/api/notifications/${id}/read`); } catch { /* ignore */ }
          row.classList.remove('unread');
          if (row.dataset.url) navigate(row.dataset.url.slice(1));
        });
      });
      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          try { await api.del(`/api/notifications/${btn.dataset.del}`); btn.closest('.notif-row').remove(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }
  load();
}

/* ---------------- Search ---------------- */

const SEARCH_TABS = [
  ['all', 'Tất cả'], ['users', 'Mọi người'], ['posts', 'Bài viết'], ['groups', 'Nhóm'],
  ['pages', 'Trang'], ['events', 'Sự kiện'], ['products', 'Sản phẩm'], ['videos', 'Video'], ['reels', 'Reels'],
];

export async function renderSearch(container, query = {}) {
  const initial = query.q || '';
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Tìm kiếm</h1><p class="page-sub">Khám phá mọi người, nội dung và cộng đồng.</p></div></div>
    <form class="search-bar mb" id="search-form">${icon('search', 20)}<input type="search" id="search-input" placeholder="Tìm kiếm HAONLINE…" value="${esc(initial)}" autocomplete="off"><button class="btn btn-primary" type="submit">Tìm</button></form>
    <div class="tabs mb" id="search-tabs">${SEARCH_TABS.map(([v, l], i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-type="${v}">${l}</button>`).join('')}</div>
    <div id="search-body">${initial ? spinner() : empty('Nhập từ khóa để bắt đầu tìm kiếm', 'search')}</div>`;
  let type = 'all';
  let q = initial;
  const body = container.querySelector('#search-body');
  const input = container.querySelector('#search-input');

  container.querySelector('#search-form').onsubmit = (e) => {
    e.preventDefault();
    q = input.value.trim();
    run();
  };
  container.querySelector('#search-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#search-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    type = tab.dataset.type;
    if (q) run();
  };

  async function run() {
    if (!q) { body.innerHTML = empty('Nhập từ khóa để bắt đầu tìm kiếm', 'search'); return; }
    body.innerHTML = spinner();
    history.replaceState(null, '', `#/search?q=${encodeURIComponent(q)}`);
    try {
      const d = await api.get(`/api/search?q=${encodeURIComponent(q)}&type=${type}&limit=30`);
      const sections = [];
      if (d.users?.length) sections.push(section('Mọi người', d.users.map((u) => `<div class="person-row">${avatar(u, 42)}<div class="grow"><a class="person-name" href="#/profile/${esc(u.username)}">${esc(u.display_name)}</a><div class="person-meta">@${esc(u.username)}</div></div><a class="btn btn-sm btn-ghost" href="#/profile/${esc(u.username)}">Xem</a></div>`).join('')));
      if (d.posts?.length) sections.push(section('Bài viết', d.posts.map((p) => `<a class="person-row" href="#/post/${esc(p.id)}" style="text-decoration:none;color:inherit">${avatar(p.author, 40)}<div class="grow"><div class="small clamp-2">${linkify(p.body || '')}</div><div class="person-meta">${esc(p.author?.display_name || '')} · ${timeAgo(p.created_at)} · ${p.reactions_count} cảm xúc · ${p.comments_count} bình luận</div></div></a>`).join('')));
      if (d.groups?.length) sections.push(section('Nhóm', d.groups.map((g) => `<a class="person-row" href="#/groups/${esc(g.id)}" style="text-decoration:none;color:inherit"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('users', 19)}</span><div class="grow"><div class="person-name">${esc(g.name)}</div><div class="person-meta">${g.privacy === 'private' ? 'Riêng tư' : 'Công khai'} · ${g.member_count || ''}</div></div></a>`).join('')));
      if (d.pages?.length) sections.push(section('Trang', d.pages.map((p) => `<a class="person-row" href="#/pages/${esc(p.id)}" style="text-decoration:none;color:inherit"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('flag', 19)}</span><div class="grow"><div class="person-name">${esc(p.name)}</div><div class="person-meta">${esc(p.category || 'Chung')}</div></div></a>`).join('')));
      if (d.events?.length) sections.push(section('Sự kiện', d.events.map((ev) => `<a class="person-row" href="#/events/${esc(ev.id)}" style="text-decoration:none;color:inherit"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('calendar', 19)}</span><div class="grow"><div class="person-name">${esc(ev.title)}</div><div class="person-meta">${fullDate(ev.starts_at)}</div></div></a>`).join('')));
      if (d.products?.length) sections.push(section('Sản phẩm', d.products.map((p) => `<a class="person-row" href="#/marketplace?product=${esc(p.id)}" style="text-decoration:none;color:inherit">${p.image ? `<img class="avatar" src="${esc(p.image)}" alt="">` : `<span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('shopping', 19)}</span>`}<div class="grow"><div class="person-name">${esc(p.title)}</div><div class="person-meta">${money(p.price_cents, p.currency)} · ${esc(p.seller?.display_name || '')}</div></div></a>`).join('')));
      if (d.videos?.length) sections.push(section('Video', d.videos.map((v) => `<a class="person-row" href="#/videos" style="text-decoration:none;color:inherit"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('video', 19)}</span><div class="grow"><div class="person-name">${esc(v.title)}</div><div class="person-meta">${esc(v.owner?.display_name || '')} · ${v.view_count || 0} lượt xem</div></div></a>`).join('')));
      if (d.reels?.length) sections.push(section('Reels', d.reels.map((r) => `<a class="person-row" href="#/reels" style="text-decoration:none;color:inherit"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('play', 19)}</span><div class="grow"><div class="person-name">${esc((r.caption || 'Reel').slice(0, 80))}</div><div class="person-meta">${esc(r.author?.display_name || '')} · ${r.view_count || 0} lượt xem</div></div></a>`).join('')));
      body.innerHTML = sections.length ? sections.join('') : empty(`Không tìm thấy kết quả cho “${q}”`, 'search');
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function section(title, html) {
    return `<div class="section-head"><h2>${title}</h2></div><div class="card list-card mb">${html}</div>`;
  }

  if (initial) run();
}

/* ---------------- Bookmarks ---------------- */

export async function renderBookmarks(container) {
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Đã lưu</h1><p class="page-sub">Những nội dung bạn muốn xem lại.</p></div></div>
    <div class="tabs mb" id="bm-tabs"><button class="tab active" data-type="">Tất cả</button><button class="tab" data-type="post">Bài viết</button><button class="tab" data-type="video">Video</button><button class="tab" data-type="reel">Reels</button><button class="tab" data-type="product">Sản phẩm</button></div>
    <div id="bm-body">${spinner()}</div>`;
  let type = '';
  const body = container.querySelector('#bm-body');
  container.querySelector('#bm-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#bm-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    type = tab.dataset.type;
    load();
  };

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/bookmarks?limit=50${type ? `&type=${type}` : ''}`);
      if (!d.items.length) { body.innerHTML = empty('Chưa lưu nội dung nào', 'bookmark'); return; }
      body.innerHTML = d.items.map((b) => wrapBookmark(b)).join('');
      bindPostInteractions(body);
      body.querySelectorAll('[data-unbookmark]').forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await api.del(`/api/bookmarks/${btn.dataset.type}/${btn.dataset.unbookmark}`);
            toast('Đã bỏ lưu', 'info');
            load();
          } catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function wrapBookmark(b) {
    const t = b.target;
    if (b.target_type === 'post') {
      return `<div class="mb"><div class="row-between" style="padding:6px 2px"><span class="tiny muted">Đã lưu ${timeAgo(b.created_at)}</span><button class="btn btn-sm btn-ghost" data-unbookmark="${esc(b.target_id)}" data-type="post">${icon('bookmark', 14)} Bỏ lưu</button></div>${postCard(t)}</div>`;
    }
    if (b.target_type === 'video') {
      return `<div class="card card-pad mb"><div class="row-between"><div class="row" style="gap:10px">${videoThumb(t)}<div><a class="strong" href="#/videos">${esc(t.title)}</a><div class="tiny muted">${esc(t.author?.display_name || '')} · ${t.view_count || 0} lượt xem</div></div></div><button class="btn btn-sm btn-ghost" data-unbookmark="${esc(b.target_id)}" data-type="video">${icon('bookmark', 14)} Bỏ lưu</button></div></div>`;
    }
    if (b.target_type === 'reel') {
      return `<div class="card card-pad mb"><div class="row-between"><div class="row" style="gap:10px"><span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('play', 20)}</span><div><a class="strong" href="#/reels">${esc((t.caption || 'Reel').slice(0, 60))}</a><div class="tiny muted">${esc(t.author?.display_name || '')} · ${t.view_count || 0} lượt xem</div></div></div><button class="btn btn-sm btn-ghost" data-unbookmark="${esc(b.target_id)}" data-type="reel">${icon('bookmark', 14)} Bỏ lưu</button></div></div>`;
    }
    const image = t.media?.[0]?.url || t.image_url;
    return `<div class="card card-pad mb"><div class="row-between"><div class="row" style="gap:10px">${image ? `<img class="avatar" style="border-radius:12px" src="${esc(image)}" alt="">` : `<span class="avatar" style="display:grid;place-items:center;background:var(--surface-2)">${icon('shopping', 20)}</span>`}<div><a class="strong" href="#/marketplace?product=${esc(t.id)}">${esc(t.title)}</a><div class="tiny muted">${money(t.price_cents, t.currency)} · ${esc(t.seller?.display_name || '')}</div></div></div><button class="btn btn-sm btn-ghost" data-unbookmark="${esc(b.target_id)}" data-type="product">${icon('bookmark', 14)} Bỏ lưu</button></div></div>`;
  }

  function videoThumb(v) {
    return v.thumb_url ? `<img class="avatar" style="border-radius:12px" src="${esc(v.thumb_url)}" alt="">` : `<video class="avatar" style="border-radius:12px;object-fit:cover" src="${esc(v.url)}" preload="metadata" muted></video>`;
  }

  load();
}

/* ---------------- Memories ---------------- */

export async function renderMemories(container) {
  const today = new Date();
  const defaultDate = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Kỷ niệm</h1><p class="page-sub">Nhìn lại những gì bạn đã chia sẻ trong ngày này các năm trước.</p></div></div>
    <div class="card card-pad mb"><div class="row wrap"><div class="field grow" style="margin:0"><label>Chọn ngày (MM-DD)</label><input class="input" id="mem-date" value="${defaultDate}" pattern="\\d{2}-\\d{2}" maxlength="5"></div><button class="btn btn-primary" id="mem-load" style="align-self:flex-end">${icon('refresh', 16)} Xem</button></div></div>
    <div id="mem-body">${spinner()}</div>`;
  const body = container.querySelector('#mem-body');
  const dateInput = container.querySelector('#mem-date');
  container.querySelector('#mem-load').onclick = () => load(dateInput.value.trim());
  async function load(date) {
    if (!/^\d{2}-\d{2}$/.test(date)) return toast('Ngày phải có dạng MM-DD', 'error');
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/memories?date=${encodeURIComponent(date)}`);
      if (!d.items.length) {
        body.innerHTML = empty('Không có bài viết nào trong ngày này', 'sparkles');
        return;
      }
      const years = Object.keys(d.by_year).sort().reverse();
      body.innerHTML = years.map((y) => `<div class="section-head"><h2>${y} · ${d.by_year[y].length} bài viết</h2></div>${d.by_year[y].map(postCard).join('')}`).join('');
      bindPostInteractions(body);
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }
  load(defaultDate);
}
