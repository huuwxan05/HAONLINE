import { api, auth } from '../api.js';
import {
  icon, esc, avatar, timeAgo, fullDate, toast, spinner, empty, modal, confirmDialog, navigate, mediaBlock,
  formatDateTimeLocal,
} from '../ui.js';
import { openComposer, postCard, bindPostInteractions } from '../components.js';

const CATEGORIES = [
  ['general', 'Chung'], ['business', 'Doanh nghiệp'], ['education', 'Giáo dục'], ['entertainment', 'Giải trí'],
  ['music', 'Âm nhạc'], ['sports', 'Thể thao'], ['technology', 'Công nghệ'], ['travel', 'Du lịch'],
];

function cover(url, cls = 'entity-cover') {
  return `<div class="${cls}">${url ? `<img src="${esc(url)}" alt="">` : ''}</div>`;
}

async function renderEntityFeed(container, query) {
  const box = container.querySelector('#entity-feed');
  try {
    const d = await api.get(`/api/feed?${query}&limit=20`);
    if (!d.items.length) { box.innerHTML = empty('Chưa có bài viết nào'); return; }
    box.innerHTML = d.items.map(postCard).join('');
    bindPostInteractions(box);
  } catch (err) { box.innerHTML = empty(err.message, 'alert'); }
}

/* ---------------- Groups ---------------- */

export async function renderGroups(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Nhóm</h1><p class="page-sub">Cộng đồng theo chủ đề, nơi mọi người cùng chia sẻ.</p></div>
      <button class="btn btn-primary" id="new-group">${icon('plus', 17)} Tạo nhóm</button>
    </div>
    <div class="row mb wrap">
      <div class="tabs" id="group-tabs"><button class="tab active" data-scope="all">Khám phá</button><button class="tab" data-scope="mine">Nhóm của tôi</button></div>
      <form class="search-pill" id="group-search" style="max-width:300px">${icon('search', 16)}<input type="search" placeholder="Tìm nhóm…"></form>
    </div>
    <div id="groups-body">${spinner()}</div>`;
  let scope = 'all';
  let q = '';
  const body = container.querySelector('#groups-body');
  container.querySelector('#new-group').onclick = () => openGroupForm(null, () => load());
  container.querySelector('#group-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#group-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope = tab.dataset.scope;
    load();
  };
  container.querySelector('#group-search').onsubmit = (e) => { e.preventDefault(); q = e.target.querySelector('input').value.trim(); load(); };

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/groups?limit=30${scope === 'mine' ? '&mine=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!d.items.length) { body.innerHTML = empty(scope === 'mine' ? 'Bạn chưa tham gia nhóm nào' : 'Chưa có nhóm nào', 'users'); return; }
      body.innerHTML = `<div class="grid-cards">${d.items.map((g) => `
        <a class="card card-hover entity-card" href="#/groups/${esc(g.id)}">
          ${cover(g.cover_url)}
          <div class="entity-body">
            <div class="row-between"><div class="entity-name truncate">${esc(g.name)}</div>${g.privacy === 'private' ? `<span class="badge">${icon('lock', 11)} Riêng tư</span>` : ''}</div>
            <div class="entity-meta mt">${g.members_count} thành viên · ${g.posts_count} bài viết</div>
            ${g.my_status === 'pending' ? '<div class="badge mt">Đang chờ duyệt</div>' : g.my_role ? '<div class="badge badge-primary mt">Đã tham gia</div>' : ''}
          </div>
        </a>`).join('')}</div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }
  load();
}

function openGroupForm(group, onDone) {
  const m = modal({
    title: group ? 'Sửa nhóm' : 'Tạo nhóm mới',
    content: `
      <div class="field"><label>Tên nhóm</label><input class="input" id="g-name" maxlength="120" value="${esc(group?.name || '')}" placeholder="Tên nhóm"></div>
      <div class="field"><label>Mô tả</label><textarea class="textarea" id="g-desc" maxlength="5000" placeholder="Nhóm này nói về điều gì?">${esc(group?.description || '')}</textarea></div>
      <div class="field"><label>Quyền riêng tư</label><select class="select" id="g-privacy"><option value="public" ${group?.privacy === 'public' ? 'selected' : ''}>Công khai</option><option value="private" ${group?.privacy === 'private' ? 'selected' : ''}>Riêng tư</option></select></div>
      <div class="form-grid">
        <div class="field"><label>Ảnh bìa</label><input type="file" accept="image/*" id="g-cover" class="input"></div>
        <div class="field"><label>Ảnh đại diện</label><input type="file" accept="image/*" id="g-avatar" class="input"></div>
      </div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>${group ? 'Lưu' : 'Tạo nhóm'}</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-save]').onclick = async () => {
    const name = m.overlay.querySelector('#g-name').value.trim();
    if (name.length < 2) return toast('Tên nhóm quá ngắn', 'error');
    const btn = m.overlay.querySelector('[data-save]');
    btn.disabled = true;
    try {
      const payload = {
        name, description: m.overlay.querySelector('#g-desc').value.trim(),
        privacy: m.overlay.querySelector('#g-privacy').value,
      };
      const coverFile = m.overlay.querySelector('#g-cover').files[0];
      const avatarFile = m.overlay.querySelector('#g-avatar').files[0];
      if (coverFile) payload.cover_url = (await api.upload(coverFile)).url;
      if (avatarFile) payload.avatar_url = (await api.upload(avatarFile)).url;
      if (group) await api.patch(`/api/groups/${group.id}`, payload);
      else await api.post('/api/groups', payload);
      m.close();
      toast(group ? 'Đã cập nhật nhóm' : 'Đã tạo nhóm', 'success');
      if (onDone) onDone();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

export async function renderGroup(container, params) {
  container.innerHTML = spinner();
  let group;
  try { ({ group } = await api.get(`/api/groups/${params.id}`)); }
  catch (err) {
    container.innerHTML = empty(err.message, 'lock', '<a class="btn btn-ghost" href="#/groups">Xem nhóm khác</a>');
    return;
  }
  const member = group.my_status === 'active';
  const canManage = ['owner', 'admin', 'moderator'].includes(group.my_role) || auth.user.role === 'admin';
  const isOwner = group.owner_id === auth.user.id;

  container.innerHTML = `
    <div class="card mb" style="overflow:hidden">
      <div class="profile-cover" style="height:200px">${group.cover_url ? `<img src="${esc(group.cover_url)}" alt="">` : ''}</div>
      <div class="card-pad">
        <div class="row wrap" style="align-items:flex-end;gap:14px">
          <div class="profile-avatar" style="margin-top:-56px">${group.avatar_url ? `<img class="avatar" style="width:100%;height:100%;border-radius:inherit" src="${esc(group.avatar_url)}" alt="">` : icon('users', 40)}</div>
          <div class="grow"><h1 style="margin:0;font-size:26px">${esc(group.name)}</h1>
            <div class="row small muted mt">${group.privacy === 'private' ? 'Nhóm riêng tư' : 'Nhóm công khai'} · ${group.members_count} thành viên · ${group.posts_count} bài viết</div>
          </div>
          <div class="row wrap" style="gap:8px">
            ${member
              ? `<button class="btn btn-primary" id="group-post">${icon('plus', 16)} Đăng bài</button>${isOwner
                ? `<button class="btn btn-ghost" id="group-edit">${icon('edit', 16)} Sửa</button>`
                : `<button class="btn btn-ghost" id="group-leave">Rời nhóm</button>`}`
              : group.my_status === 'pending'
                ? `<button class="btn btn-ghost" disabled>Đang chờ duyệt</button>`
                : `<button class="btn btn-primary" id="group-join">${icon('userPlus', 16)} Tham gia</button>`}
            ${canManage && isOwner ? `<button class="btn btn-ghost" id="group-delete" style="color:var(--danger)">${icon('trash', 16)}</button>` : ''}
          </div>
        </div>
        ${group.description ? `<p class="mt" style="white-space:pre-wrap">${esc(group.description)}</p>` : ''}
      </div>
    </div>
    <div class="tabs mb" id="group-tabs-view"><button class="tab active" data-tab="feed">Thảo luận</button><button class="tab" data-tab="members">Thành viên</button><button class="tab" data-tab="about">Giới thiệu</button></div>
    <div id="group-panel"></div>`;

  const panel = container.querySelector('#group-panel');
  const joinBtn = container.querySelector('#group-join');
  if (joinBtn) joinBtn.onclick = async () => {
    try {
      const d = await api.post(`/api/groups/${group.id}/join`);
      toast(d.status === 'pending' ? 'Đã gửi yêu cầu tham gia' : 'Đã tham gia nhóm', 'success');
      renderGroup(container, params);
    } catch (err) { toast(err.message, 'error'); }
  };
  const leaveBtn = container.querySelector('#group-leave');
  if (leaveBtn) leaveBtn.onclick = async () => {
    if (!await confirmDialog('Rời khỏi nhóm này?', { danger: true, confirmText: 'Rời nhóm' })) return;
    try { await api.post(`/api/groups/${group.id}/leave`); toast('Đã rời nhóm', 'info'); renderGroup(container, params); }
    catch (err) { toast(err.message, 'error'); }
  };
  const editBtn = container.querySelector('#group-edit');
  if (editBtn) editBtn.onclick = () => openGroupForm(group, () => renderGroup(container, params));
  const delBtn = container.querySelector('#group-delete');
  if (delBtn) delBtn.onclick = async () => {
    if (!await confirmDialog('Xóa nhóm này? Hành động không thể hoàn tác.', { danger: true, confirmText: 'Xóa nhóm' })) return;
    try { await api.del(`/api/groups/${group.id}`); toast('Đã xóa nhóm', 'success'); navigate('/groups'); }
    catch (err) { toast(err.message, 'error'); }
  };
  const postBtn = container.querySelector('#group-post');
  if (postBtn) postBtn.onclick = () => openComposer({ groupId: group.id, onCreated: () => showTab('feed') });

  container.querySelector('#group-tabs-view').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#group-tabs-view .tab').forEach((t) => t.classList.toggle('active', t === tab));
    showTab(tab.dataset.tab);
  };

  function showTab(tab) {
    if (tab === 'feed') {
      panel.innerHTML = `<div id="entity-feed">${spinner()}</div>`;
      renderEntityFeed(panel, `group_id=${encodeURIComponent(group.id)}`);
    } else if (tab === 'members') {
      renderGroupMembers(panel, group, canManage, () => renderGroup(container, params));
    } else {
      panel.innerHTML = `<div class="card card-pad"><h3 class="mt-0">Giới thiệu</h3>
        <p style="white-space:pre-wrap">${esc(group.description || 'Chưa có mô tả.')}</p>
        <div class="form-grid mt"><div><div class="tiny muted">Quyền riêng tư</div><div>${group.privacy === 'private' ? 'Riêng tư' : 'Công khai'}</div></div>
        <div><div class="tiny muted">Ngày tạo</div><div>${fullDate(group.created_at)}</div></div>
        <div><div class="tiny muted">Vai trò của bạn</div><div>${group.my_role ? esc(group.my_role) : 'Chưa tham gia'}</div></div></div></div>`;
    }
  }
  showTab('feed');
}

async function renderGroupMembers(panel, group, canManage, refresh) {
  panel.innerHTML = spinner();
  try {
    const [active, pending] = await Promise.all([
      api.get(`/api/groups/${group.id}/members?limit=100&status=active`),
      canManage ? api.get(`/api/groups/${group.id}/members?limit=100&status=pending`) : Promise.resolve({ items: [] }),
    ]);
    panel.innerHTML = `
      ${pending.items.length ? `<div class="section-head"><h2>Chờ duyệt (${pending.items.length})</h2></div>
        <div class="card list-card mb">${pending.items.map((u) => `<div class="person-row">${avatar(u, 40)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)}</div></div>
          <button class="btn btn-sm btn-primary" data-approve="${esc(u.id)}">Duyệt</button>
          <button class="btn btn-sm btn-ghost" data-reject="${esc(u.id)}">Từ chối</button></div>`).join('')}</div>` : ''}
      <div class="section-head"><h2>Thành viên (${active.items.length})</h2></div>
      <div class="card list-card">${active.items.map((u) => {
        const own = u.id === auth.user.id;
        return `<div class="person-row">${avatar(u, 40)}<div class="grow"><div class="person-name">${esc(u.display_name)} ${u.role !== 'member' ? `<span class="badge">${esc(u.role)}</span>` : ''}</div><div class="person-meta">@${esc(u.username)} · tham gia ${timeAgo(u.joined_at)}</div></div>
          <a class="btn btn-sm btn-ghost" href="#/profile/${esc(u.username)}">Xem</a>
          ${canManage && !own && u.role !== 'owner' ? `<button class="icon-btn" title="Tùy chọn" data-manage="${esc(u.id)}" data-name="${esc(u.display_name)}" data-role="${esc(u.role)}">${icon('more', 18)}</button>` : ''}</div>`;
      }).join('')}</div>`;
    panel.querySelectorAll('[data-approve]').forEach((b) => {
      b.onclick = async () => {
        try { await api.post(`/api/groups/${group.id}/members/${b.dataset.approve}/approve`); toast('Đã duyệt', 'success'); renderGroupMembers(panel, group, canManage, refresh); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
    panel.querySelectorAll('[data-reject]').forEach((b) => {
      b.onclick = async () => {
        try { await api.post(`/api/groups/${group.id}/members/${b.dataset.reject}/reject`); toast('Đã từ chối', 'info'); renderGroupMembers(panel, group, canManage, refresh); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
    panel.querySelectorAll('[data-manage]').forEach((b) => {
      b.onclick = () => {
        const m = modal({
          title: b.dataset.name,
          content: `<div class="list-card">
            <button class="list-action" data-role="admin">${icon('shield', 18)} Bổ nhiệm quản trị</button>
            <button class="list-action" data-role="moderator">${icon('shield', 18)} Bổ nhiệm điều hành</button>
            <button class="list-action" data-role="member">${icon('user', 18)} Hạ xuống thành viên</button>
            <button class="list-action danger" data-kick>${icon('userX', 18)} Xóa khỏi nhóm</button>
          </div>`,
        });
        m.overlay.querySelectorAll('[data-role]').forEach((r) => {
          r.onclick = async () => {
            try { await api.patch(`/api/groups/${group.id}/members/${b.dataset.manage}`, { role: r.dataset.role }); m.close(); toast('Đã cập nhật vai trò', 'success'); renderGroupMembers(panel, group, canManage, refresh); }
            catch (err) { toast(err.message, 'error'); }
          };
        });
        m.overlay.querySelector('[data-kick]').onclick = async () => {
          if (!await confirmDialog(`Xóa ${b.dataset.name} khỏi nhóm?`, { danger: true, confirmText: 'Xóa' })) return;
          try { await api.del(`/api/groups/${group.id}/members/${b.dataset.manage}`); m.close(); toast('Đã xóa thành viên', 'success'); renderGroupMembers(panel, group, canManage, refresh); }
          catch (err) { toast(err.message, 'error'); }
        };
      };
    });
  } catch (err) { panel.innerHTML = empty(err.message, 'alert'); }
}

/* ---------------- Pages ---------------- */

export async function renderPages(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Trang</h1><p class="page-sub">Thương hiệu, cộng đồng và người sáng tạo.</p></div>
      <button class="btn btn-primary" id="new-page">${icon('plus', 17)} Tạo trang</button>
    </div>
    <div class="row mb wrap">
      <div class="tabs" id="page-tabs"><button class="tab active" data-scope="all">Khám phá</button><button class="tab" data-scope="mine">Trang của tôi</button></div>
      <form class="search-pill" id="page-search" style="max-width:300px">${icon('search', 16)}<input type="search" placeholder="Tìm trang…"></form>
    </div>
    <div id="pages-body">${spinner()}</div>`;
  let scope = 'all';
  let q = '';
  const body = container.querySelector('#pages-body');
  container.querySelector('#new-page').onclick = () => openPageForm(null, () => load());
  container.querySelector('#page-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#page-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope = tab.dataset.scope;
    load();
  };
  container.querySelector('#page-search').onsubmit = (e) => { e.preventDefault(); q = e.target.querySelector('input').value.trim(); load(); };

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/pages?limit=30${scope === 'mine' ? '&mine=true' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!d.items.length) { body.innerHTML = empty(scope === 'mine' ? 'Bạn chưa có trang nào' : 'Chưa có trang nào', 'flag'); return; }
      body.innerHTML = `<div class="grid-cards">${d.items.map((p) => `
        <a class="card card-hover entity-card" href="#/pages/${esc(p.id)}">
          ${cover(p.cover_url)}
          <img class="entity-logo" src="${esc(p.avatar_url || '')}" alt="" ${p.avatar_url ? '' : 'style="display:none"'}>
          <div class="entity-body">
            <div class="entity-name">${esc(p.name)} ${p.verified ? icon('check', 15) : ''}</div>
            <div class="entity-meta mt">${esc(p.category || 'Chung')} · ${p.followers_count} người theo dõi</div>
            ${p.following ? '<div class="badge badge-primary mt">Đang theo dõi</div>' : ''}
          </div>
        </a>`).join('')}</div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }
  load();
}

function openPageForm(page, onDone) {
  const m = modal({
    title: page ? 'Sửa trang' : 'Tạo trang',
    content: `
      <div class="field"><label>Tên trang</label><input class="input" id="p-name" maxlength="120" value="${esc(page?.name || '')}"></div>
      <div class="field"><label>Danh mục</label><select class="select" id="p-category">${CATEGORIES.map(([v, l]) => `<option value="${v}" ${page?.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Mô tả</label><textarea class="textarea" id="p-desc" maxlength="5000">${esc(page?.description || '')}</textarea></div>
      <div class="form-grid"><div class="field"><label>Ảnh bìa</label><input type="file" accept="image/*" id="p-cover" class="input"></div>
      <div class="field"><label>Ảnh đại diện</label><input type="file" accept="image/*" id="p-avatar" class="input"></div></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>${page ? 'Lưu' : 'Tạo trang'}</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-save]').onclick = async () => {
    const name = m.overlay.querySelector('#p-name').value.trim();
    if (name.length < 2) return toast('Tên trang quá ngắn', 'error');
    const btn = m.overlay.querySelector('[data-save]');
    btn.disabled = true;
    try {
      const payload = {
        name, category: m.overlay.querySelector('#p-category').value,
        description: m.overlay.querySelector('#p-desc').value.trim(),
      };
      const coverFile = m.overlay.querySelector('#p-cover').files[0];
      const avatarFile = m.overlay.querySelector('#p-avatar').files[0];
      if (coverFile) payload.cover_url = (await api.upload(coverFile)).url;
      if (avatarFile) payload.avatar_url = (await api.upload(avatarFile)).url;
      if (page) await api.patch(`/api/pages/${page.id}`, payload);
      else await api.post('/api/pages', payload);
      m.close();
      toast(page ? 'Đã cập nhật trang' : 'Đã tạo trang', 'success');
      if (onDone) onDone();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

export async function renderPage(container, params) {
  container.innerHTML = spinner();
  let page;
  try { ({ page } = await api.get(`/api/pages/${params.id}`)); }
  catch (err) { container.innerHTML = empty(err.message, 'alert', '<a class="btn btn-ghost" href="#/pages">Xem trang khác</a>'); return; }
  const canManage = page.owner_id === auth.user.id || ['admin'].includes(page.my_role) || auth.user.role === 'admin';
  const isOwner = page.owner_id === auth.user.id;

  container.innerHTML = `
    <div class="card mb" style="overflow:hidden">
      <div class="profile-cover" style="height:200px">${page.cover_url ? `<img src="${esc(page.cover_url)}" alt="">` : ''}</div>
      <div class="card-pad">
        <div class="row wrap" style="align-items:flex-end;gap:14px">
          <div class="profile-avatar" style="margin-top:-56px">${page.avatar_url ? `<img class="avatar" style="width:100%;height:100%;border-radius:inherit" src="${esc(page.avatar_url)}" alt="">` : icon('flag', 36)}</div>
          <div class="grow"><h1 style="margin:0;font-size:26px">${esc(page.name)} ${page.verified ? icon('check', 18) : ''}</h1>
            <div class="row small muted mt">${esc(page.category || 'Chung')} · ${page.followers_count} người theo dõi · ${page.posts_count} bài viết</div></div>
          <div class="row wrap" style="gap:8px">
            ${page.owner_id !== auth.user.id ? `<button class="btn ${page.following ? 'btn-ghost' : 'btn-primary'}" id="page-follow">${page.following ? 'Đang theo dõi' : `${icon('plus', 16)} Theo dõi`}</button>` : ''}
            ${canManage ? `<button class="btn btn-primary" id="page-post">${icon('plus', 16)} Đăng bài</button><button class="btn btn-ghost" id="page-edit">${icon('edit', 16)} Sửa</button>` : ''}
            ${canManage ? `<button class="btn btn-ghost" id="page-analytics">${icon('chart', 16)} Thống kê</button>` : ''}
            ${isOwner ? `<button class="btn btn-ghost" id="page-delete" style="color:var(--danger)">${icon('trash', 16)}</button>` : ''}
          </div>
        </div>
        ${page.description ? `<p class="mt" style="white-space:pre-wrap">${esc(page.description)}</p>` : ''}
      </div>
    </div>
    <div class="tabs mb" id="page-tabs-view"><button class="tab active" data-tab="feed">Bài viết</button><button class="tab" data-tab="about">Giới thiệu</button><button class="tab" data-tab="followers">Người theo dõi</button></div>
    <div id="page-panel"></div>`;

  const panel = container.querySelector('#page-panel');
  const followBtn = container.querySelector('#page-follow');
  if (followBtn) followBtn.onclick = async () => {
    try {
      if (page.following) { await api.del(`/api/pages/${page.id}/follow`); toast('Đã bỏ theo dõi', 'info'); }
      else { await api.post(`/api/pages/${page.id}/follow`); toast('Đã theo dõi trang', 'success'); }
      renderPage(container, params);
    } catch (err) { toast(err.message, 'error'); }
  };
  container.querySelector('#page-post')?.addEventListener('click', () => openComposer({ pageId: page.id, onCreated: () => showTab('feed') }));
  container.querySelector('#page-edit')?.addEventListener('click', () => openPageForm(page, () => renderPage(container, params)));
  container.querySelector('#page-analytics')?.addEventListener('click', () => openPageAnalytics(page));
  container.querySelector('#page-delete')?.addEventListener('click', async () => {
    if (!await confirmDialog('Xóa trang này?', { danger: true, confirmText: 'Xóa trang' })) return;
    try { await api.del(`/api/pages/${page.id}`); toast('Đã xóa trang', 'success'); navigate('/pages'); }
    catch (err) { toast(err.message, 'error'); }
  });
  container.querySelector('#page-tabs-view').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#page-tabs-view .tab').forEach((t) => t.classList.toggle('active', t === tab));
    showTab(tab.dataset.tab);
  };

  function showTab(tab) {
    if (tab === 'feed') {
      panel.innerHTML = `<div id="entity-feed">${spinner()}</div>`;
      renderEntityFeed(panel, `page_id=${encodeURIComponent(page.id)}`);
    } else if (tab === 'about') {
      panel.innerHTML = `<div class="card card-pad"><h3 style="margin-top:0">Giới thiệu</h3><p style="white-space:pre-wrap">${esc(page.description || 'Chưa có mô tả.')}</p>
        <div class="form-grid mt"><div><div class="tiny muted">Danh mục</div><div>${esc(page.category || 'Chung')}</div></div>
        <div><div class="tiny muted">Ngày tạo</div><div>${fullDate(page.created_at)}</div></div>
        <div><div class="tiny muted">Vai trò của bạn</div><div>${page.my_role ? esc(page.my_role) : page.owner_id === auth.user.id ? 'Chủ trang' : 'Người theo dõi'}</div></div></div></div>`;
    } else {
      panel.innerHTML = spinner();
      api.get(`/api/pages/${page.id}/followers?limit=100`).then((d) => {
        panel.innerHTML = `<div class="card list-card">${d.items.map((u) => `<div class="person-row">${avatar(u, 40)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)} · theo dõi ${timeAgo(u.followed_at)}</div></div><a class="btn btn-sm btn-ghost" href="#/profile/${esc(u.username)}">Xem</a></div>`).join('') || '<p class="muted small" style="padding:16px">Chưa có người theo dõi</p>'}</div>`;
      }).catch((err) => { panel.innerHTML = empty(err.message, 'alert'); });
    }
  }
  showTab('feed');
}

function openPageAnalytics(page) {
  const m = modal({ title: `Thống kê · ${page.name}`, wide: true, content: spinner() });
  api.get(`/api/pages/${page.id}/analytics`).then(({ analytics: a }) => {
    const max = Math.max(1, ...a.daily.map((d) => d.c));
    m.overlay.querySelector('.modal-body').innerHTML = `
      <div class="stat-grid">
        <div class="card card-pad center"><div class="tiny muted">Người theo dõi</div><div class="profile-stat"><b>${a.followers}</b></div></div>
        <div class="card card-pad center"><div class="tiny muted">Bài viết</div><div class="profile-stat"><b>${a.posts}</b></div></div>
        <div class="card card-pad center"><div class="tiny muted">Cảm xúc</div><div class="profile-stat"><b>${a.reactions}</b></div></div>
        <div class="card card-pad center"><div class="tiny muted">Bình luận</div><div class="profile-stat"><b>${a.comments}</b></div></div>
      </div>
      <h3 class="mt">Lượt xem 30 ngày</h3>
      <div class="chart-bars">${a.daily.map((d) => `<div class="chart-bar" style="height:${Math.max(4, Math.round((d.c / max) * 140))}px" title="${esc(d.day)}: ${d.c}"><span>${esc(d.day.slice(5))}</span></div>`).join('') || '<p class="muted small">Chưa có dữ liệu</p>'}</div>`;
  }).catch((err) => { m.overlay.querySelector('.modal-body').innerHTML = empty(err.message, 'alert'); });
}

/* ---------------- Events ---------------- */

export async function renderEvents(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Sự kiện</h1><p class="page-sub">Gặp gỡ, tham gia và mời bạn bè.</p></div>
      <button class="btn btn-primary" id="new-event">${icon('plus', 17)} Tạo sự kiện</button>
    </div>
    <div class="row mb wrap">
      <div class="tabs" id="event-tabs"><button class="tab active" data-scope="upcoming">Sắp diễn ra</button><button class="tab" data-scope="going">Sẽ tham gia</button><button class="tab" data-scope="mine">Của tôi</button></div>
      <form class="search-pill" id="event-search" style="max-width:300px">${icon('search', 16)}<input type="search" placeholder="Tìm sự kiện…"></form>
    </div>
    <div id="events-body">${spinner()}</div>`;
  let scope = 'upcoming';
  let q = '';
  const body = container.querySelector('#events-body');
  container.querySelector('#new-event').onclick = () => openEventForm(null, () => load());
  container.querySelector('#event-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#event-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    scope = tab.dataset.scope;
    load();
  };
  container.querySelector('#event-search').onsubmit = (e) => { e.preventDefault(); q = e.target.querySelector('input').value.trim(); load(); };

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/events?scope=${scope}&limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!d.items.length) { body.innerHTML = empty('Không có sự kiện nào', 'calendar'); return; }
      body.innerHTML = `<div class="grid-cards">${d.items.map((ev) => `
        <a class="card card-hover entity-card" href="#/events/${esc(ev.id)}">
          ${cover(ev.cover_url)}
          <div class="entity-body">
            <div class="row" style="gap:10px"><div class="date-chip"><b>${new Date(ev.starts_at).getDate()}</b><span>Th${new Date(ev.starts_at).getMonth() + 1}</span></div>
              <div class="grow"><div class="entity-name clamp-2">${esc(ev.title)}</div><div class="entity-meta">${fullDate(ev.starts_at)}</div></div></div>
            <div class="row-between mt"><span class="tiny muted">${ev.going_count} người tham gia</span>${ev.my_status === 'going' ? '<span class="badge badge-primary">Đã tham gia</span>' : ev.my_status === 'interested' ? '<span class="badge">Quan tâm</span>' : ''}</div>
            ${ev.location ? `<div class="tiny muted mt">${icon('pin', 12)} ${esc(ev.location)}</div>` : ''}
          </div>
        </a>`).join('')}</div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }
  load();
}

function openEventForm(event, onDone) {
  const m = modal({
    title: event ? 'Sửa sự kiện' : 'Tạo sự kiện',
    content: `
      <div class="field"><label>Tên sự kiện</label><input class="input" id="e-title" maxlength="200" value="${esc(event?.title || '')}" placeholder="Tên sự kiện"></div>
      <div class="field"><label>Mô tả</label><textarea class="textarea" id="e-desc" maxlength="5000">${esc(event?.description || '')}</textarea></div>
      <div class="field"><label>Địa điểm</label><input class="input" id="e-location" maxlength="300" value="${esc(event?.location || '')}" placeholder="Địa điểm hoặc liên kết"></div>
      <div class="form-grid">
        <div class="field"><label>Bắt đầu</label><input class="input" type="datetime-local" id="e-start" value="${formatDateTimeLocal(event?.starts_at)}"></div>
        <div class="field"><label>Kết thúc</label><input class="input" type="datetime-local" id="e-end" value="${event?.ends_at ? formatDateTimeLocal(event.ends_at) : ''}"></div>
      </div>
      <div class="field"><label>Quyền riêng tư</label><select class="select" id="e-privacy"><option value="public" ${event?.privacy === 'public' ? 'selected' : ''}>Công khai</option><option value="private" ${event?.privacy === 'private' ? 'selected' : ''}>Riêng tư</option></select></div>
      <div class="field"><label>Ảnh bìa</label><input type="file" accept="image/*" id="e-cover" class="input"></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>${event ? 'Lưu' : 'Tạo sự kiện'}</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-save]').onclick = async () => {
    const title = m.overlay.querySelector('#e-title').value.trim();
    const start = m.overlay.querySelector('#e-start').value;
    if (title.length < 2) return toast('Tên sự kiện quá ngắn', 'error');
    if (!start) return toast('Chọn thời gian bắt đầu', 'error');
    const btn = m.overlay.querySelector('[data-save]');
    btn.disabled = true;
    try {
      const payload = {
        title, description: m.overlay.querySelector('#e-desc').value.trim(),
        location: m.overlay.querySelector('#e-location').value.trim(),
        starts_at: new Date(start).toISOString(),
        ends_at: m.overlay.querySelector('#e-end').value ? new Date(m.overlay.querySelector('#e-end').value).toISOString() : null,
        privacy: m.overlay.querySelector('#e-privacy').value,
      };
      const coverFile = m.overlay.querySelector('#e-cover').files[0];
      if (coverFile) payload.cover_url = (await api.upload(coverFile)).url;
      if (event) await api.patch(`/api/events/${event.id}`, payload);
      else await api.post('/api/events', payload);
      m.close();
      toast(event ? 'Đã cập nhật sự kiện' : 'Đã tạo sự kiện', 'success');
      if (onDone) onDone();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

export async function renderEvent(container, params) {
  container.innerHTML = spinner();
  let event;
  try { ({ event } = await api.get(`/api/events/${params.id}`)); }
  catch (err) { container.innerHTML = empty(err.message, 'lock', '<a class="btn btn-ghost" href="#/events">Xem sự kiện khác</a>'); return; }
  const mine = event.creator_id === auth.user.id || ['admin', 'moderator'].includes(auth.user.role);
  const start = new Date(event.starts_at);

  container.innerHTML = `
    <div class="card mb" style="overflow:hidden">
      <div class="profile-cover" style="height:240px">${event.cover_url ? `<img src="${esc(event.cover_url)}" alt="">` : ''}</div>
      <div class="card-pad">
        <div class="row-between wrap" style="gap:12px">
          <div class="row" style="gap:14px"><div class="date-chip lg"><b>${start.getDate()}</b><span>Th${start.getMonth() + 1}</span></div>
            <div><h1 style="margin:0;font-size:25px">${esc(event.title)}</h1>
            <div class="small muted mt">${fullDate(event.starts_at)}${event.ends_at ? ` – ${fullDate(event.ends_at)}` : ''}</div>
            <div class="small muted">${event.location ? `${icon('pin', 13)} ${esc(event.location)} · ` : ''}${event.going_count} người tham gia</div></div>
          </div>
          <div class="row wrap" style="gap:8px">
            <button class="btn ${event.my_status === 'going' ? 'btn-soft' : 'btn-primary'}" id="ev-going">${event.my_status === 'going' ? 'Đã tham gia' : 'Tham gia'}</button>
            <button class="btn btn-ghost" id="ev-interested">${event.my_status === 'interested' ? 'Đã quan tâm' : 'Quan tâm'}</button>
            <button class="btn btn-ghost" id="ev-invite">${icon('userPlus', 16)} Mời</button>
            ${mine ? `<button class="btn btn-ghost" id="ev-edit">${icon('edit', 16)}</button><button class="btn btn-ghost" id="ev-delete" style="color:var(--danger)">${icon('trash', 16)}</button>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="layout-split">
      <div><div class="card card-pad"><h3 style="margin-top:0">Chi tiết</h3><p style="white-space:pre-wrap">${esc(event.description || 'Chưa có mô tả.')}</p>
        <div class="small muted mt">Người tạo: <a href="#/profile/${esc(event.creator?.username || '')}">${esc(event.creator?.display_name || '')}</a> · ${event.privacy === 'private' ? 'Riêng tư' : 'Công khai'}</div></div></div>
      <aside><div class="card card-pad"><h3 style="margin-top:0">Người tham gia</h3><div id="ev-attendees">${spinner()}</div></div></aside>
    </div>`;

  const attend = async (status) => {
    try {
      await api.post(`/api/events/${event.id}/attend`, { status });
      toast(status === 'going' ? 'Đã đăng ký tham gia' : status === 'interested' ? 'Đã đánh dấu quan tâm' : 'Đã cập nhật', 'success');
      renderEvent(container, params);
    } catch (err) { toast(err.message, 'error'); }
  };
  container.querySelector('#ev-going').onclick = () => attend(event.my_status === 'going' ? 'declined' : 'going');
  container.querySelector('#ev-interested').onclick = () => attend('interested');
  container.querySelector('#ev-invite').onclick = () => openInvite(event);
  container.querySelector('#ev-edit')?.addEventListener('click', () => openEventForm(event, () => renderEvent(container, params)));
  container.querySelector('#ev-delete')?.addEventListener('click', async () => {
    if (!await confirmDialog('Xóa sự kiện này?', { danger: true, confirmText: 'Xóa' })) return;
    try { await api.del(`/api/events/${event.id}`); toast('Đã xóa sự kiện', 'success'); navigate('/events'); }
    catch (err) { toast(err.message, 'error'); }
  });

  api.get(`/api/events/${event.id}/attendees?limit=30`).then((d) => {
    const box = container.querySelector('#ev-attendees');
    if (!box) return;
    box.innerHTML = d.items.length ? d.items.map((u) => `<div class="row" style="gap:8px;padding:6px 0">${avatar(u, 32)}<div class="grow"><div class="small strong">${esc(u.display_name)}</div><div class="tiny muted">${u.status === 'going' ? 'Sẽ tham gia' : u.status === 'interested' ? 'Quan tâm' : u.status}</div></div></div>`).join('') : '<p class="muted small">Chưa có ai</p>';
  }).catch(() => {});
}

async function openInvite(event) {
  const m = modal({
    title: 'Mời bạn bè',
    content: `<div class="search-pill mb">${icon('search', 16)}<input type="search" id="invite-search" placeholder="Tìm bạn bè…"></div><div id="invite-list">${spinner()}</div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Đóng</button><button class="btn btn-primary" data-send>Gửi lời mời</button>`,
  });
  const selected = new Set();
  const list = m.overlay.querySelector('#invite-list');
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  const load = async (q = '') => {
    list.innerHTML = spinner();
    let users = [];
    try {
      if (q) {
        const d = await api.get(`/api/search?q=${encodeURIComponent(q)}&type=users&limit=30`);
        users = d.users || d.items || [];
      } else users = (await api.get('/api/friends?limit=50')).items;
    } catch (err) { list.innerHTML = empty(err.message, 'alert'); return; }
    list.innerHTML = users.map((u) => `<div class="person-row">${avatar(u, 36)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)}</div></div>
      <button class="btn btn-sm ${selected.has(u.id) ? 'btn-soft' : 'btn-ghost'}" data-pick="${esc(u.id)}">${selected.has(u.id) ? 'Đã chọn' : 'Chọn'}</button></div>`).join('') || '<p class="muted small">Không có ai</p>';
    list.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => {
        if (selected.has(b.dataset.pick)) selected.delete(b.dataset.pick); else selected.add(b.dataset.pick);
        b.classList.toggle('btn-soft', selected.has(b.dataset.pick));
        b.classList.toggle('btn-ghost', !selected.has(b.dataset.pick));
        b.textContent = selected.has(b.dataset.pick) ? 'Đã chọn' : 'Chọn';
      };
    });
  };
  m.overlay.querySelector('#invite-search').oninput = (e) => load(e.target.value.trim());
  m.overlay.querySelector('[data-send]').onclick = async () => {
    if (!selected.size) return toast('Chọn ít nhất một người', 'error');
    try {
      const d = await api.post(`/api/events/${event.id}/invite`, { user_ids: [...selected] });
      m.close();
      toast(`Đã gửi ${d.invited} lời mời`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  load();
}
