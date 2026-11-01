import { api, auth } from '../api.js';
import { icon, esc, toast, spinner, empty, navigate, confirmDialog } from '../ui.js';
import {
  userRow, addFriendButton, bindFriendButtons, followButton, bindFollowButtons,
} from '../components.js';

export async function renderFriends(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Bạn bè & kết nối</h1><p class="page-sub">Quản lý bạn bè, lời mời và những người bạn theo dõi.</p></div>
      <a class="btn btn-ghost" href="#/search">${icon('search', 17)} Tìm người</a>
    </div>
    <div class="tabs mb" id="friends-tabs">
      <button class="tab active" data-tab="friends">Bạn bè</button>
      <button class="tab" data-tab="requests">Lời mời <span class="badge badge-primary" id="req-count"></span></button>
      <button class="tab" data-tab="suggestions">Gợi ý</button>
      <button class="tab" data-tab="following">Đang theo dõi</button>
      <button class="tab" data-tab="blocks">Đã chặn</button>
    </div>
    <div id="friends-content">${spinner()}</div>`;

  const content = container.querySelector('#friends-content');
  container.querySelector('#friends-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#friends-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    load(tab.dataset.tab);
  });

  async function load(tab) {
    content.innerHTML = spinner();
    try {
      if (tab === 'friends') return loadFriends();
      if (tab === 'requests') return loadRequests();
      if (tab === 'suggestions') return loadSuggestions();
      if (tab === 'following') return loadFollowing();
      if (tab === 'blocks') return loadBlocks();
    } catch (err) {
      content.innerHTML = empty(err.message, 'alert');
    }
  }

  async function loadFriends() {
    const data = await api.get('/api/friends?limit=100');
    if (!data.items.length) {
      content.innerHTML = empty('Bạn chưa có người bạn nào. Hãy kết nối nhé!', 'users', '<a class="btn btn-primary" href="#/search">Tìm bạn bè</a>');
      return;
    }
    content.innerHTML = `<div class="card list-card">${data.items.map((u) => userRow(u, `
      <button class="icon-btn js-message" data-id="${esc(u.id)}" title="Nhắn tin">${icon('message', 18)}</button>
      <button class="btn btn-sm btn-ghost js-unfriend" data-id="${esc(u.id)}" data-name="${esc(u.display_name)}">Hủy kết bạn</button>`)).join('')}</div>`;
    bindActions(content);
  }

  async function loadRequests() {
    const data = await api.get('/api/friends/requests');
    const countEl = container.querySelector('#req-count');
    if (countEl) { countEl.textContent = data.incoming.length || ''; countEl.classList.toggle('hide', !data.incoming.length); }
    content.innerHTML = `
      <div class="section-head"><h2>Lời mời nhận được (${data.incoming.length})</h2></div>
      <div class="card list-card mb">${data.incoming.length ? data.incoming.map((f) => userRow(
        { ...f, id: f.requester_id },
        `<button class="btn btn-sm btn-primary js-accept" data-id="${esc(f.requester_id)}">Chấp nhận</button>
         <button class="btn btn-sm btn-ghost js-decline" data-id="${esc(f.requester_id)}">Từ chối</button>`,
      )).join('') : '<p class="muted small" style="padding:16px">Không có lời mời mới</p>'}</div>
      <div class="section-head"><h2>Đã gửi (${data.outgoing.length})</h2></div>
      <div class="card list-card">${data.outgoing.length ? data.outgoing.map((f) => userRow(
        { ...f, id: f.addressee_id },
        `<span class="badge">Đang chờ</span>`,
      )).join('') : '<p class="muted small" style="padding:16px">Bạn chưa gửi lời mời nào</p>'}</div>`;
    content.querySelectorAll('.js-accept').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await api.post(`/api/friends/requests/${btn.dataset.id}/accept`);
          toast('Đã chấp nhận lời mời', 'success');
          load('requests');
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    });
    content.querySelectorAll('.js-decline').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api.post(`/api/friends/requests/${btn.dataset.id}/decline`);
          toast('Đã từ chối lời mời', 'info');
          load('requests');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  async function loadSuggestions() {
    const data = await api.get('/api/users/suggestions?limit=30');
    if (!data.items.length) { content.innerHTML = empty('Chưa có gợi ý mới', 'sparkles'); return; }
    content.innerHTML = `<div class="card list-card">${data.items.map((u) => userRow(u, `${addFriendButton(u)}${followButton(u)}`)).join('')}</div>`;
    bindFriendButtons(content);
    bindFollowButtons(content);
  }

  async function loadFollowing() {
    const [following, followers] = await Promise.all([
      api.get(`/api/users/${auth.user.id}/following?limit=50`),
      api.get(`/api/users/${auth.user.id}/followers?limit=50`),
    ]);
    content.innerHTML = `
      <div class="section-head"><h2>Đang theo dõi (${following.items.length})</h2></div>
      <div class="card list-card mb">${following.items.map((u) => userRow(u, `<button class="btn btn-sm btn-ghost js-unfollow" data-id="${esc(u.id)}">Bỏ theo dõi</button>`)).join('') || '<p class="muted small" style="padding:16px">Chưa theo dõi ai</p>'}</div>
      <div class="section-head"><h2>Người theo dõi (${followers.items.length})</h2></div>
      <div class="card list-card">${followers.items.map((u) => userRow(u, followButton(u))).join('') || '<p class="muted small" style="padding:16px">Chưa có người theo dõi</p>'}</div>`;
    bindFollowButtons(content);
    content.querySelectorAll('.js-unfollow').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api.del(`/api/follows/${btn.dataset.id}`);
          toast('Đã bỏ theo dõi', 'info');
          load('following');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  async function loadBlocks() {
    const data = await api.get('/api/blocks');
    content.innerHTML = `<div class="card list-card">${data.items.map((u) => userRow(u, `<button class="btn btn-sm btn-ghost js-unblock" data-id="${esc(u.id)}">Bỏ chặn</button>`)).join('') || '<p class="muted small" style="padding:16px">Bạn chưa chặn ai</p>'}</div>`;
    content.querySelectorAll('.js-unblock').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api.del(`/api/blocks/${btn.dataset.id}`);
          toast('Đã bỏ chặn', 'success');
          load('blocks');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  function bindActions(scope) {
    scope.querySelectorAll('.js-message').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const d = await api.post('/api/conversations', { kind: 'dm', user_id: btn.dataset.id });
          navigate(`/messages/${d.conversation.id}`);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      };
    });
    scope.querySelectorAll('.js-unfriend').forEach((btn) => {
      btn.onclick = async () => {
        if (!await confirmDialog(`Hủy kết bạn với ${btn.dataset.name}?`, { danger: true, confirmText: 'Hủy kết bạn' })) return;
        try {
          await api.del(`/api/friends/${btn.dataset.id}`);
          toast('Đã hủy kết bạn', 'info');
          load('friends');
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  try {
    const req = await api.get('/api/friends/requests');
    const countEl = container.querySelector('#req-count');
    if (countEl) { countEl.textContent = req.incoming.length || ''; countEl.classList.toggle('hide', !req.incoming.length); }
  } catch { /* ignore */ }

  load('friends');
}
