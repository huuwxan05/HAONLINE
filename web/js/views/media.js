import { api, auth } from '../api.js';
import {
  icon, esc, avatar, timeAgo, toast, spinner, empty, modal, confirmDialog, navigate, mediaBlock,
  uploadProgress,
} from '../ui.js';
import { openReport, linkify } from '../components.js';

function duration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

async function uploadFile(file, onProgress) {
  return api.upload(file, onProgress);
}

/* ---------------- Stories ---------------- */

export async function renderStories(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Tin 24 giờ</h1><p class="page-sub">Chia sẻ khoảnh khắc, tự động biến mất sau 24 giờ.</p></div>
      <button class="btn btn-primary" id="new-story">${icon('plus', 17)} Tạo tin</button>
    </div>
    <div id="stories-body">${spinner()}</div>`;
  container.querySelector('#new-story').onclick = () => openStoryCreator(() => load());
  async function load() {
    const box = container.querySelector('#stories-body');
    try {
      const data = await api.get('/api/stories/feed');
      if (!data.items.length) {
        box.innerHTML = empty('Chưa có tin nào. Hãy tạo tin đầu tiên!', 'clock', '<button class="btn btn-primary" id="empty-story">Tạo tin</button>');
        box.querySelector('#empty-story').onclick = () => openStoryCreator(() => load());
        return;
      }
      box.innerHTML = `<div class="grid-cards">${data.items.map((g, i) => `
        <button class="card card-hover entity-card js-story" data-index="${i}" style="text-align:left">
          <div class="entity-cover" style="height:150px">${g.items[0].thumb_url || (g.items[0].kind === 'image' ? g.items[0].url : '') ? `<img src="${esc(g.items[0].thumb_url || g.items[0].url)}" alt="">` : ''}</div>
          <div class="entity-body row">
            ${avatar(g.author, 40)}
            <div class="grow"><div class="entity-name truncate">${esc(g.author.display_name)}</div><div class="entity-meta">${g.items.length} tin · ${timeAgo(g.items[g.items.length - 1].created_at)}</div></div>
          </div>
        </button>`).join('')}</div>`;
      box.querySelectorAll('.js-story').forEach((btn) => {
        btn.onclick = () => openStoryViewer(data.items, Number(btn.dataset.index), () => load());
      });
    } catch (err) {
      box.innerHTML = empty(err.message, 'alert');
    }
  }
  load();
}

export function openStoryCreator(onCreated) {
  const m = modal({
    title: 'Tạo tin 24 giờ',
    content: `
      <div id="story-preview" class="empty-state" style="border:1px dashed var(--border);border-radius:14px;min-height:220px">${icon('image', 32)}<p>Chọn ảnh hoặc video</p></div>
      <input type="file" id="story-file" accept="image/*,video/*" hidden>
      <div class="row mt"><button class="btn btn-ghost" id="story-pick">${icon('image', 17)} Chọn tệp</button></div>
      <div class="field mt"><label>Chú thích</label><input class="input" id="story-caption" maxlength="300" placeholder="Thêm chú thích…"></div>
      <div class="progress hide" id="story-progress"><span style="width:2%"></span></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-publish disabled>Đăng tin</button>`,
  });
  let media = null;
  const file = m.overlay.querySelector('#story-file');
  const preview = m.overlay.querySelector('#story-preview');
  const publish = m.overlay.querySelector('[data-publish]');
  m.overlay.querySelector('#story-pick').onclick = () => file.click();
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  file.onchange = async () => {
    if (!file.files[0]) return;
    const bar = m.overlay.querySelector('#story-progress');
    bar.classList.remove('hide');
    try {
      media = await uploadFile(file.files[0], (p) => uploadProgress(bar, p));
      preview.classList.remove('empty-state');
      preview.innerHTML = mediaBlock(media, { controls: media.kind === 'video' });
      publish.disabled = false;
      bar.classList.add('hide');
    } catch (err) { toast(err.message, 'error'); bar.classList.add('hide'); }
  };
  publish.onclick = async () => {
    if (!media) return;
    publish.disabled = true;
    try {
      await api.post('/api/stories', {
        kind: media.kind === 'video' ? 'video' : 'image', url: media.url, thumb_url: media.thumb_url,
        caption: m.overlay.querySelector('#story-caption').value.trim() || undefined,
      });
      m.close();
      toast('Đã đăng tin', 'success');
      if (onCreated) onCreated();
    } catch (err) { toast(err.message, 'error'); publish.disabled = false; }
  };
}

export function openStoryViewer(groups, startGroup = 0, onClose = null) {
  let gi = startGroup;
  let ii = 0;
  let timer = null;
  const overlay = document.createElement('div');
  overlay.className = 'story-viewer';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  };

  const close = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  };

  const next = () => {
    clearTimeout(timer);
    const group = groups[gi];
    if (ii < group.items.length - 1) { ii += 1; draw(); return; }
    if (gi < groups.length - 1) { gi += 1; ii = 0; draw(); return; }
    close();
  };
  const prev = () => {
    clearTimeout(timer);
    if (ii > 0) { ii -= 1; draw(); return; }
    if (gi > 0) { gi -= 1; ii = 0; draw(); return; }
  };

  function draw() {
    const group = groups[gi];
    if (!group) return close();
    const story = group.items[ii];
    const own = group.author.id === auth.user.id;
    overlay.innerHTML = `
      <div class="story-frame">
        <div class="story-progress">${group.items.map((s, idx) => `<span class="${idx < ii ? 'done' : idx === ii ? 'active' : ''}" style="--dur:${s.kind === 'video' ? 15 : 5}s"><i></i></span>`).join('')}</div>
        <div class="story-top">
          <a href="#/profile/${esc(group.author.username)}">${avatar(group.author, 34)}</a>
          <div class="grow"><div class="strong small">${esc(group.author.display_name)}</div><div class="tiny">${timeAgo(story.created_at)}</div></div>
          ${own ? `<button class="icon-btn" data-viewers style="color:#fff" title="Người xem">${icon('eye', 19)}</button>` : ''}
          <button class="icon-btn" data-close style="color:#fff" aria-label="Đóng">${icon('close', 22)}</button>
        </div>
        ${story.kind === 'video'
          ? `<video class="media" src="${esc(story.url)}" autoplay playsinline ${own ? 'controls' : ''}></video>`
          : `<img class="media" src="${esc(story.url)}" alt="${esc(story.caption || '')}">`}
        <div style="position:absolute;left:14px;right:14px;bottom:20px;z-index:3;color:#fff">
          ${story.caption ? `<div class="strong mb" style="text-shadow:0 1px 8px #000">${esc(story.caption)}</div>` : ''}
          <div class="row-between"><span class="tiny">${own ? `${story.viewers_count || 0} lượt xem` : `@${esc(group.author.username)}`}</span>
          ${own ? `<button class="icon-btn" data-delete style="color:#fff" title="Xóa tin">${icon('trash', 18)}</button>` : ''}</div>
        </div>
        <div class="story-nav"><button data-prev aria-label="Trước"></button><button data-next aria-label="Sau"></button></div>
      </div>`;
    overlay.querySelector('[data-close]').onclick = close;
    overlay.querySelector('[data-prev]').onclick = prev;
    overlay.querySelector('[data-next]').onclick = next;
    const del = overlay.querySelector('[data-delete]');
    if (del) del.onclick = async (e) => {
      e.stopPropagation();
      if (!await confirmDialog('Xóa tin này?', { danger: true, confirmText: 'Xóa' })) return;
      try {
        await api.del(`/api/stories/${story.id}`);
        group.items.splice(ii, 1);
        if (!group.items.length) { groups.splice(gi, 1); gi = Math.min(gi, groups.length - 1); ii = 0; }
        else ii = Math.min(ii, group.items.length - 1);
        toast('Đã xóa tin', 'success');
        draw();
      } catch (err) { toast(err.message, 'error'); }
    };
    const viewers = overlay.querySelector('[data-viewers]');
    if (viewers) viewers.onclick = () => showViewers(story.id);
    api.post(`/api/stories/${story.id}/view`).catch(() => {});
    clearTimeout(timer);
    timer = setTimeout(next, story.kind === 'video' ? 15000 : 5000);
    const video = overlay.querySelector('video');
    if (video) { video.onended = next; }
  }

  async function showViewers(storyId) {
    try {
      const data = await api.get(`/api/stories/${storyId}`);
      modal({
        title: `Người xem (${data.viewers.length})`,
        content: data.viewers.length ? `<div class="list-card">${data.viewers.map((u) => `<div class="person-row">${avatar(u, 36)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">${timeAgo(u.viewed_at)}</div></div></div>`).join('')}</div>` : '<p class="muted">Chưa có người xem</p>',
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  document.addEventListener('keydown', onKey);
  draw();
  return close;
}

/* ---------------- Reels ---------------- */

export function openReelCreator(onCreated) {
  const m = modal({
    title: 'Tạo reel',
    content: `
      <div id="reel-preview" class="empty-state" style="border:1px dashed var(--border);border-radius:14px;min-height:180px">${icon('video', 32)}<p>Chọn video dọc</p></div>
      <input type="file" id="reel-file" accept="video/*" hidden>
      <button class="btn btn-ghost mt" id="reel-pick">${icon('video', 17)} Chọn video</button>
      <div class="field mt"><label>Chú thích</label><textarea class="textarea" id="reel-caption" maxlength="500" placeholder="Mô tả reel của bạn…"></textarea></div>
      <div class="progress hide" id="reel-progress"><span style="width:2%"></span></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-publish disabled>Đăng reel</button>`,
  });
  let media = null;
  const file = m.overlay.querySelector('#reel-file');
  m.overlay.querySelector('#reel-pick').onclick = () => file.click();
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  file.onchange = async () => {
    if (!file.files[0]) return;
    const bar = m.overlay.querySelector('#reel-progress');
    bar.classList.remove('hide');
    try {
      media = await uploadFile(file.files[0], (p) => uploadProgress(bar, p));
      m.overlay.querySelector('#reel-preview').outerHTML = `<div id="reel-preview" style="border-radius:14px;overflow:hidden;max-height:320px">${mediaBlock(media, { controls: true })}</div>`;
      m.overlay.querySelector('[data-publish]').disabled = false;
      bar.classList.add('hide');
    } catch (err) { toast(err.message, 'error'); bar.classList.add('hide'); }
  };
  m.overlay.querySelector('[data-publish]').onclick = async () => {
    if (!media) return;
    try {
      await api.post('/api/reels', {
        url: media.url, thumb_url: media.thumb_url, caption: m.overlay.querySelector('#reel-caption').value.trim(),
        duration: media.duration || null,
      });
      m.close();
      toast('Đã đăng reel', 'success');
      if (onCreated) onCreated();
    } catch (err) { toast(err.message, 'error'); }
  };
}

export async function renderReels(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Reels</h1><p class="page-sub">Video ngắn, cuộn không dừng.</p></div>
      <div class="row"><button class="btn btn-ghost" id="reel-mute">${icon('volume', 17)} Âm thanh</button><button class="btn btn-primary" id="new-reel">${icon('plus', 17)} Tạo reel</button></div>
    </div>
    <div id="reels-body">${spinner()}</div>`;
  let muted = true;
  const muteBtn = container.querySelector('#reel-mute');
  muteBtn.onclick = () => {
    muted = !muted;
    container.querySelectorAll('.reel video').forEach((v) => { v.muted = muted; });
    muteBtn.innerHTML = `${icon(muted ? 'volume' : 'micOff', 17)} ${muted ? 'Âm thanh' : 'Tắt tiếng'}`;
  };
  container.querySelector('#new-reel').onclick = () => openReelCreator(() => load());
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target.querySelector('video');
      if (!video) continue;
      if (entry.isIntersecting) {
        video.muted = muted;
        video.play().catch(() => {});
        const id = entry.target.dataset.id;
        if (id && !entry.target.dataset.viewed) {
          entry.target.dataset.viewed = '1';
          api.post(`/api/reels/${id}/view`).catch(() => {});
        }
      } else {
        video.pause();
      }
    }
  }, { threshold: 0.65 });

  async function load() {
    const box = container.querySelector('#reels-body');
    try {
      const data = await api.get('/api/reels?limit=20');
      if (!data.items.length) {
        box.innerHTML = empty('Chưa có reel nào. Hãy tạo reel đầu tiên!', 'video');
        return;
      }
      box.innerHTML = `<div class="reel-shell" id="reel-shell">${data.items.map((r) => reelHtml(r)).join('')}</div>`;
      const shell = box.querySelector('#reel-shell');
      shell.querySelectorAll('.reel').forEach((el) => observer.observe(el));
      bindReels(shell, data.items);
    } catch (err) { box.innerHTML = empty(err.message, 'alert'); }
  }

  function reelHtml(r) {
    return `
      <div class="reel" data-id="${esc(r.id)}">
        <video src="${esc(r.url)}" loop playsinline muted preload="metadata" ${r.thumb_url ? `poster="${esc(r.thumb_url)}"` : ''}></video>
        <div class="reel-info">
          <a class="row" href="#/profile/${esc(r.author.username)}" style="gap:8px">${avatar(r.author, 36)}<b>@${esc(r.author.username)}</b></a>
          <p class="small mt" style="margin:8px 0 0">${r.caption ? linkify(r.caption) : ''}</p>
          <div class="tiny mt" style="opacity:.75">${icon('volume', 13)} ${esc(r.audio || 'Âm thanh gốc')} · ${r.view_count || 0} lượt xem</div>
        </div>
        <div class="reel-actions">
          <div class="center"><button class="js-reel-react ${r.reactions?.mine ? 'liked' : ''}">${icon('heart', 21)}</button><div class="tiny" style="color:#fff">${r.reactions?.total || 0}</div></div>
          <div class="center"><button class="js-reel-bookmark ${r.bookmarked ? 'liked' : ''}">${icon('bookmark', 21)}</button><div class="tiny" style="color:#fff">Lưu</div></div>
          <button class="js-reel-mute">${icon('volume', 21)}</button>
          <button class="js-reel-more">${icon('more', 21)}</button>
          ${r.author.id === auth.user.id ? `<button class="js-reel-delete" style="background:rgba(251,113,133,.45)">${icon('trash', 20)}</button>` : ''}
        </div>
      </div>`;
  }

  function bindReels(shell, items) {
    const map = new Map(items.map((r) => [r.id, r]));
    shell.addEventListener('click', async (e) => {
      const reelEl = e.target.closest('.reel');
      if (!reelEl) return;
      const reel = map.get(reelEl.dataset.id);
      if (!reel) return;
      const reactBtn = e.target.closest('.js-reel-react');
      if (reactBtn) {
        try {
          const d = await api.post('/api/reactions', {
            target_type: 'reel', target_id: reel.id, kind: reel.reactions?.mine || 'like',
          });
          reel.reactions = reel.reactions || { total: 0, mine: null };
          if (d.reaction) { if (!reel.reactions.mine) reel.reactions.total += 1; reel.reactions.mine = d.reaction; }
          else { reel.reactions.total = Math.max(0, reel.reactions.total - 1); reel.reactions.mine = null; }
          reactBtn.classList.toggle('liked', !!d.reaction);
          reactBtn.nextElementSibling.textContent = reel.reactions.total;
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      const bm = e.target.closest('.js-reel-bookmark');
      if (bm) {
        try {
          if (reel.bookmarked) { await api.del(`/api/bookmarks/reel/${reel.id}`); reel.bookmarked = false; }
          else { await api.post('/api/bookmarks', { target_type: 'reel', target_id: reel.id }); reel.bookmarked = true; }
          bm.classList.toggle('liked', reel.bookmarked);
          toast(reel.bookmarked ? 'Đã lưu reel' : 'Đã bỏ lưu', 'success');
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      if (e.target.closest('.js-reel-mute')) {
        const video = reelEl.querySelector('video');
        video.muted = !video.muted;
        toast(video.muted ? 'Đã tắt tiếng' : 'Đã bật tiếng', 'info', 1500);
        return;
      }
      if (e.target.closest('.js-reel-delete')) {
        if (!await confirmDialog('Xóa reel này?', { danger: true, confirmText: 'Xóa' })) return;
        try { await api.del(`/api/reels/${reel.id}`); reelEl.remove(); toast('Đã xóa reel', 'success'); }
        catch (err) { toast(err.message, 'error'); }
        return;
      }
      if (e.target.closest('.js-reel-more')) { openReport('reel', reel.id); return; }
      const video = reelEl.querySelector('video');
      if (video.paused) video.play().catch(() => {}); else video.pause();
    });
  }

  load();
  return () => observer.disconnect();
}

/* ---------------- Videos ---------------- */

export function openVideoUploader(onCreated) {
  const m = modal({
    title: 'Tải video lên',
    content: `
      <div id="video-preview" class="empty-state" style="border:1px dashed var(--border);border-radius:14px;min-height:180px">${icon('video', 32)}<p>Chọn video</p></div>
      <input type="file" id="video-file" accept="video/*" hidden>
      <button class="btn btn-ghost mt" id="video-pick">${icon('video', 17)} Chọn video</button>
      <div class="progress hide mt" id="video-progress"><span style="width:2%"></span></div>
      <div class="field mt"><label>Tiêu đề</label><input class="input" id="video-title" maxlength="200" placeholder="Tiêu đề video"></div>
      <div class="field"><label>Mô tả</label><textarea class="textarea" id="video-desc" maxlength="5000"></textarea></div>
      <div class="field"><label>Quyền xem</label><select class="select" id="video-visibility"><option value="public">Công khai</option><option value="friends">Bạn bè</option><option value="private">Riêng tư</option></select></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-publish disabled>Tải lên</button>`,
  });
  let media = null;
  const file = m.overlay.querySelector('#video-file');
  m.overlay.querySelector('#video-pick').onclick = () => file.click();
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  file.onchange = async () => {
    if (!file.files[0]) return;
    const bar = m.overlay.querySelector('#video-progress');
    bar.classList.remove('hide');
    try {
      media = await uploadFile(file.files[0], (p) => uploadProgress(bar, p));
      m.overlay.querySelector('#video-preview').outerHTML = `<div id="video-preview" style="border-radius:14px;overflow:hidden">${mediaBlock(media, { controls: true })}</div>`;
      m.overlay.querySelector('[data-publish]').disabled = false;
      bar.classList.add('hide');
    } catch (err) { toast(err.message, 'error'); bar.classList.add('hide'); }
  };
  m.overlay.querySelector('[data-publish]').onclick = async () => {
    const title = m.overlay.querySelector('#video-title').value.trim();
    if (!title) return toast('Cần nhập tiêu đề', 'error');
    try {
      await api.post('/api/videos', {
        title, description: m.overlay.querySelector('#video-desc').value.trim(),
        url: media.url, thumb_url: media.thumb_url, duration: media.duration,
        visibility: m.overlay.querySelector('#video-visibility').value,
      });
      m.close();
      toast('Đã tải video', 'success');
      if (onCreated) onCreated();
    } catch (err) { toast(err.message, 'error'); }
  };
}

export async function renderVideos(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Video</h1><p class="page-sub">Kho video của bạn và cộng đồng.</p></div>
      <button class="btn btn-primary" id="new-video">${icon('plus', 17)} Tải video</button>
    </div>
    <div class="row mb wrap">
      <div class="tabs" id="video-tabs">
        <button class="tab active" data-scope="public">Công khai</button>
        <button class="tab" data-scope="following">Đang theo dõi</button>
        <button class="tab" data-scope="mine">Của tôi</button>
      </div>
      <form class="search-pill" id="video-search" style="max-width:300px">${icon('search', 17)}<input type="search" placeholder="Tìm video…"></form>
    </div>
    <div id="video-body">${spinner()}</div>`;
  let scope = 'public';
  let q = '';
  const body = container.querySelector('#video-body');
  container.querySelector('#new-video').onclick = () => openVideoUploader(() => load());
  container.querySelector('#video-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#video-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope = tab.dataset.scope;
    load();
  });
  container.querySelector('#video-search').onsubmit = (e) => {
    e.preventDefault();
    q = e.target.querySelector('input').value.trim();
    load();
  };

  async function load() {
    body.innerHTML = spinner();
    try {
      const data = await api.get(`/api/videos?scope=${scope}&limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!data.items.length) { body.innerHTML = empty('Chưa có video nào', 'video'); return; }
      body.innerHTML = `<div class="video-grid">${data.items.map(videoCard).join('')}</div>`;
      body.querySelectorAll('.js-video').forEach((el) => {
        el.onclick = () => openVideoDetail(data.items.find((v) => v.id === el.dataset.id), () => load());
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function videoCard(v) {
    return `<div class="card card-hover video-card js-video" data-id="${esc(v.id)}">
      <div class="video-thumb">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="">` : `<video src="${esc(v.url)}" preload="metadata"></video>`}
        ${v.duration ? `<span class="video-dur">${duration(v.duration)}</span>` : ''}
        ${v.visibility !== 'public' ? `<span class="badge" style="position:absolute;top:8px;left:8px">${icon('lock', 11)} ${v.visibility === 'friends' ? 'Bạn bè' : 'Riêng tư'}</span>` : ''}
      </div>
      <div class="video-meta">
        <div class="strong clamp-2">${esc(v.title)}</div>
        <div class="row tiny muted mt"><span>${esc((v.owner || v.author)?.display_name || '')}</span><span>·</span><span>${v.view_count || 0} lượt xem</span><span>·</span><span>${timeAgo(v.created_at)}</span></div>
      </div>
    </div>`;
  }

  function openVideoDetail(video, refresh) {
    if (!video) return;
    api.post(`/api/videos/${video.id}/view`).catch(() => {});
    const owner = video.owner || video.author;
    const m = modal({
      title: video.title,
      wide: true,
      content: `<video src="${esc(video.url)}" controls autoplay playsinline style="width:100%;max-height:65vh;background:#000;border-radius:12px"></video>
        <div class="row-between mt"><div class="row"><a href="#/profile/${esc(owner?.username || '')}">${avatar(owner, 36)}</a><div><div class="strong small">${esc(owner?.display_name || '')}</div><div class="tiny muted">${video.view_count || 0} lượt xem · ${timeAgo(video.created_at)}</div></div></div>
        <span class="badge">${video.visibility}</span></div>
        ${video.description ? `<p class="mt" style="white-space:pre-wrap">${linkify(video.description)}</p>` : ''}
        <div class="row mt" style="gap:8px">
          <button class="btn btn-ghost btn-sm js-video-like">${icon('heart', 16)} ${video.reactions?.total || 0} cảm xúc</button>
          <button class="btn btn-ghost btn-sm js-video-bookmark">${icon('bookmark', 16)} ${video.bookmarked ? 'Đã lưu' : 'Lưu'}</button>
          <button class="btn btn-ghost btn-sm js-video-report">${icon('flag', 16)} Báo cáo</button>
          ${owner?.id === auth.user.id ? `<button class="btn btn-ghost btn-sm js-video-delete" style="color:var(--danger)">${icon('trash', 16)} Xóa</button>` : ''}
        </div>`,
    });
    m.overlay.querySelector('.js-video-like').onclick = async () => {
      try {
        const d = await api.post('/api/reactions', { target_type: 'video', target_id: video.id, kind: video.reactions?.mine || 'like' });
        video.reactions = video.reactions || { total: 0, mine: null };
        if (d.reaction) { if (!video.reactions.mine) video.reactions.total += 1; video.reactions.mine = d.reaction; }
        else { video.reactions.total = Math.max(0, video.reactions.total - 1); video.reactions.mine = null; }
        m.overlay.querySelector('.js-video-like').innerHTML = `${icon('heart', 16)} ${video.reactions.total} cảm xúc`;
        m.overlay.querySelector('.js-video-like').classList.toggle('btn-soft', !!d.reaction);
      } catch (err) { toast(err.message, 'error'); }
    };
    m.overlay.querySelector('.js-video-bookmark').onclick = async () => {
      try {
        if (video.bookmarked) { await api.del(`/api/bookmarks/video/${video.id}`); video.bookmarked = false; }
        else { await api.post('/api/bookmarks', { target_type: 'video', target_id: video.id }); video.bookmarked = true; }
        m.overlay.querySelector('.js-video-bookmark').innerHTML = `${icon('bookmark', 16)} ${video.bookmarked ? 'Đã lưu' : 'Lưu'}`;
      } catch (err) { toast(err.message, 'error'); }
    };
    m.overlay.querySelector('.js-video-report').onclick = () => openReport('video', video.id);
    const del = m.overlay.querySelector('.js-video-delete');
    if (del) del.onclick = async () => {
      if (!await confirmDialog('Xóa video này?', { danger: true, confirmText: 'Xóa' })) return;
      try { await api.del(`/api/videos/${video.id}`); m.close(); toast('Đã xóa video', 'success'); refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
    return m;
  }

  load();
}

/* ---------------- Live ---------------- */

export async function openGoLive() {
  const m = modal({
    title: 'Bắt đầu livestream',
    content: `<div class="field"><label>Tiêu đề buổi phát</label><input class="input" id="live-title" maxlength="200" placeholder="Ví dụ: Giao lưu cùng cộng đồng"></div>
      <p class="hint">Camera và micro sẽ được yêu cầu sau khi bắt đầu. Buổi phát dùng WebRTC trực tiếp.</p>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-start>Bắt đầu</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-start]').onclick = async () => {
    try {
      const d = await api.post('/api/live', { title: m.overlay.querySelector('#live-title').value.trim() || 'Live' });
      m.close();
      navigate(`/live/${d.stream.id}`);
    } catch (err) { toast(err.message, 'error'); }
  };
}

export async function renderLive(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Livestream</h1><p class="page-sub">Phát trực tiếp và trò chuyện cùng mọi người.</p></div>
      <button class="btn btn-primary" id="start-live">${icon('radio', 17)} Bắt đầu live</button>
    </div>
    <div id="live-body">${spinner()}</div>`;
  container.querySelector('#start-live').onclick = () => openGoLive();
  try {
    const data = await api.get('/api/live');
    const body = container.querySelector('#live-body');
    if (!data.items.length) { body.innerHTML = empty('Hiện không có buổi phát nào. Hãy bắt đầu!', 'radio'); return; }
    body.innerHTML = `<div class="grid-cards">${data.items.map((s) => `
      <a class="card card-hover entity-card" href="#/live/${esc(s.id)}">
        <div class="entity-cover" style="height:150px;background:linear-gradient(135deg,#1f1235,#0b1220);display:grid;place-items:center">
          ${avatar(s.host, 64)}
          <span class="badge badge-danger live-badge" style="top:10px;left:10px;position:absolute"><span class="pulse-dot"></span> LIVE</span>
        </div>
        <div class="entity-body"><div class="entity-name">${esc(s.title)}</div><div class="entity-meta">${esc(s.host.display_name)} · ${s.viewers || 0} đang xem</div></div>
      </a>`).join('')}</div>`;
  } catch (err) {
    container.querySelector('#live-body').innerHTML = empty(err.message, 'alert');
  }
}

export async function renderLiveRoom(container, params) {
  container.innerHTML = spinner('Đang vào phòng live…');
  let cleanup = () => {};
  try {
    const data = await api.get(`/api/live/${params.id}`);
    const stream = data.stream;
    const host = stream.host;
    const isHost = host.id === auth.user.id;
    container.innerHTML = `
      <div class="row mb"><a class="btn btn-ghost btn-sm" href="#/live">${icon('back', 16)} Tất cả live</a>
        ${isHost ? `<button class="btn btn-danger btn-sm" id="end-live" style="margin-left:auto">${icon('phoneOff', 16)} Kết thúc</button>` : `<button class="btn btn-ghost btn-sm" id="leave-live" style="margin-left:auto">Rời phòng</button>`}</div>
      <div class="layout-feed">
        <div>
          <div class="live-stage" id="live-stage">
            <video id="live-remote" class="remote" autoplay playsinline ${isHost ? 'muted' : ''}></video>
            <span class="badge badge-danger live-badge"><span class="pulse-dot"></span> LIVE</span>
            <div id="live-status" class="muted small" style="position:absolute;bottom:12px;left:12px;color:#fff;text-shadow:0 1px 6px #000"></div>
          </div>
          <div class="card card-pad mt">
            <div class="row-between"><div><h2 style="margin:0;font-size:19px">${esc(stream.title)}</h2>
              <div class="row small muted mt"><a href="#/profile/${esc(host.username)}">${avatar(host, 30)} @${esc(host.username)}</a><span>· ${stream.viewers || 0} người xem</span></div></div></div>
          </div>
        </div>
        <aside class="rail mobile-show">
          <div class="card" style="display:flex;flex-direction:column;height:520px">
            <div class="card-pad" style="padding:12px 14px;border-bottom:1px solid var(--border)"><b>Trò chuyện trực tiếp</b></div>
            <div class="live-chat" id="live-chat"></div>
            <form class="composer-msg" id="live-chat-form"><input class="input" name="body" maxlength="500" placeholder="Gửi bình luận…" style="border-radius:99px"><button class="icon-btn" type="submit">${icon('send', 18)}</button></form>
          </div>
        </aside>
      </div>`;

    const localVideo = container.querySelector('#live-remote');
    const statusEl = container.querySelector('#live-status');
    const chat = container.querySelector('#live-chat');
    const appendComment = (c) => {
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
      chat.insertAdjacentHTML('beforeend', `<div class="live-msg"><b>${esc(c.user?.display_name || 'Ai đó')}</b> ${esc(c.body)}</div>`);
      if (atBottom) chat.scrollTop = chat.scrollHeight;
    };
    (data.comments || []).forEach(appendComment);

    let localStream = null;
    const peers = new Map();
    let closed = false;
    let poller = null;
    let signalCursor = new Date(Date.now() - 2000).toISOString();
    const handledSignals = new Set();

    async function postSignal(to, kind, payload) {
      await api.post(`/api/live/${stream.id}/signal`, { to, kind, payload }).catch((err) => console.warn('signal', err.message));
    }

    function createPeer(peerId, { hostSide = false } = {}) {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peers.set(peerId, pc);
      if (hostSide && localStream) {
        for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) postSignal(peerId, 'ice', e.candidate.toJSON());
      };
      pc.ontrack = (e) => {
        if (!isHost) {
          localVideo.srcObject = e.streams[0];
          statusEl.textContent = 'Đang phát trực tiếp';
        }
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          peers.delete(peerId);
        }
      };
      return pc;
    }

    async function cleanupPeers() {
      for (const pc of peers.values()) { try { pc.close(); } catch { /* ignore */ } }
      peers.clear();
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      localVideo.srcObject = null;
    }
    cleanup = () => {
      closed = true;
      cleanupPeers();
      if (isHost) api.post(`/api/live/${stream.id}/end`).catch(() => {});
      else api.post(`/api/live/${stream.id}/leave`).catch(() => {});
      window.removeEventListener('haonline:live', liveHandler);
      document.removeEventListener('visibilitychange', onVis);
      if (poller) clearInterval(poller);
    };

    async function handleSignal(from, kind, payload) {
      if (isHost) {
        if (kind === 'answer') {
          const pc = peers.get(from);
          if (pc) await pc.setRemoteDescription(payload).catch(() => {});
          return;
        }
        if (kind === 'ice') {
          const pc = peers.get(from);
          if (pc) await pc.addIceCandidate(payload).catch(() => {});
          return;
        }
        return;
      }
      if (kind === 'offer') {
        let pc = peers.get(host.id);
        if (!pc) pc = createPeer(host.id);
        await pc.setRemoteDescription(payload).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await postSignal(host.id, 'answer', answer);
        return;
      }
      if (kind === 'ice') {
        const pc = peers.get(host.id);
        if (pc) await pc.addIceCandidate(payload).catch(() => {});
      }
    }

    async function hostOffer(viewerId) {
      if (!localStream) return;
      let pc = peers.get(viewerId);
      if (!pc) pc = createPeer(viewerId, { hostSide: true });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await postSignal(viewerId, 'offer', offer);
    }

    if (isHost) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localVideo.muted = true;
        statusEl.textContent = 'Bạn đang phát trực tiếp';
      } catch (err) {
        statusEl.textContent = 'Không thể truy cập camera/micro';
        toast('Cần quyền camera và micro để livestream', 'error', 6000);
        container.querySelector('#end-live')?.click();
        return () => {};
      }
    } else {
      try { await api.post(`/api/live/${stream.id}/join`); } catch (err) { toast(err.message, 'error'); }
      statusEl.textContent = 'Đang kết nối tới người phát…';
    }

    const liveHandler = (e) => {
      const d = e.detail || {};
      if (d.stream_id !== stream.id) return;
      if (d.type === 'comment') appendComment(d.comment);
      if (d.type === 'join' && isHost && d.user) {
        toast(`${d.user.display_name} đã tham gia`, 'info', 2500);
        hostOffer(d.user.id);
      }
      if (d.type === 'signal') {
        const key = `${d.from}:${d.kind}:${JSON.stringify(d.payload).length}`;
        handleSignal(d.from, d.kind, d.payload);
      }
      if (d.type === 'ended' && !isHost) {
        toast('Buổi phát đã kết thúc', 'info');
        cleanup();
        container.innerHTML = empty('Buổi phát đã kết thúc', 'radio', '<a class="btn btn-primary" href="#/live">Xem live khác</a>');
      }
    };
    window.addEventListener('haonline:live', liveHandler);

    poller = setInterval(async () => {
      if (closed) return;
      try {
        const res = await api.get(`/api/live/${stream.id}/signals?after=${encodeURIComponent(signalCursor)}`);
        for (const sig of res.items) {
          if (handledSignals.has(sig.id)) continue;
          handledSignals.add(sig.id);
          signalCursor = sig.created_at;
          handleSignal(sig.from_user_id, sig.kind, sig.payload);
        }
      } catch { /* realtime takes over */ }
    }, 5000);

    const onVis = () => { if (document.hidden) localVideo.pause?.(); };
    document.addEventListener('visibilitychange', onVis);

    container.querySelector('#live-chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try {
        const d = await api.post(`/api/live/${stream.id}/comments`, { body });
        appendComment(d.comment);
      } catch (err) { toast(err.message, 'error'); input.value = body; }
    };
    const endBtn = container.querySelector('#end-live');
    if (endBtn) endBtn.onclick = async () => {
      if (!await confirmDialog('Kết thúc buổi phát?', { danger: true, confirmText: 'Kết thúc' })) return;
      try { await api.post(`/api/live/${stream.id}/end`); } catch (err) { toast(err.message, 'error'); }
      cleanup();
      navigate('/live');
    };
    const leaveBtn = container.querySelector('#leave-live');
    if (leaveBtn) leaveBtn.onclick = () => { cleanup(); navigate('/live'); };

    return () => cleanup();
  } catch (err) {
    container.innerHTML = empty(err.message, 'alert', '<a class="btn btn-ghost" href="#/live">Quay lại</a>');
    return () => cleanup();
  }
}
