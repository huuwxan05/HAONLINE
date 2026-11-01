import { api, auth, loadMe } from '../api.js';
import {
  icon, esc, avatar, timeAgo, toast, spinner, empty, modal, confirmDialog, navigate,
} from '../ui.js';
import {
  postCard, bindPostInteractions, addFriendButton, bindFriendButtons, followButton, bindFollowButtons,
  userRow, openReport,
} from '../components.js';

function profileActions(user) {
  if (user.relationship === 'self') {
    return `<button class="btn btn-primary" id="edit-profile">${icon('edit', 16)} Chỉnh sửa hồ sơ</button>
      <a class="btn btn-ghost" href="#/settings?tab=privacy">${icon('lock', 16)} Quyền riêng tư</a>`;
  }
  if (user.relationship === 'blocked') {
    return `<button class="btn btn-ghost" data-unblock>${icon('lock', 16)} Bỏ chặn</button>`;
  }
  const msg = user.relationship === 'friends' || user.relationship === 'following' || user.relationship === 'none' || user.relationship === 'request_received';
  return `
    ${msg ? `<button class="btn btn-primary" id="btn-message">${icon('message', 16)} Nhắn tin</button>` : ''}
    ${addFriendButton(user)}
    ${followButton(user)}
    <button class="icon-btn" id="profile-more" aria-label="Tùy chọn">${icon('more', 20)}</button>`;
}

function coverHtml(user) {
  return `<div class="profile-cover">${user.cover_url ? `<img src="${esc(user.cover_url)}" alt="Ảnh bìa">` : ''}</div>`;
}

export async function renderProfile(container, params) {
  container.innerHTML = spinner('Đang tải hồ sơ…');
  try {
    const data = await api.get(`/api/users/${encodeURIComponent(params.username)}`);
    const user = data.user;
    if (user.limited) {
      container.innerHTML = `<div style="max-width:680px;margin:0 auto">
        <div class="card profile-hero">${coverHtml(user)}
          <div class="profile-body">
            ${avatar(user, 116, "profile-avatar")}
            <h1 class="profile-name">${esc(user.display_name)}</h1>
            <div class="profile-handle">@${esc(user.username)}</div>
            <div class="empty-state">${icon('lock', 34)}<p>Hồ sơ này được bảo vệ. Hãy kết bạn để xem thêm.</p></div>
            <div class="profile-actions">${profileActions(user)}</div>
          </div>
        </div>
      </div>`;
      bindActions(container, user);
      return;
    }

    container.innerHTML = `
      <div style="max-width:880px;margin:0 auto">
        <div class="card profile-hero fade-up">
          ${coverHtml(user)}
          <div class="profile-body">
            <div class="profile-top">
              <div>
                <div class="profile-avatar" style="display:inline-flex">${avatar(user, 116)}</div>
                <h1 class="profile-name">${esc(user.display_name)} ${user.email_verified ? `<span title="Đã xác minh">${icon('verified', 18)}</span>` : ''}</h1>
                <div class="profile-handle">@${esc(user.username)} ${user.online ? '<span class="badge badge-success" style="margin-left:6px">Đang hoạt động</span>' : ''}</div>
              </div>
              <div class="profile-actions">${profileActions(user)}</div>
            </div>
            ${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : '<p class="profile-bio faint">Chưa có tiểu sử.</p>'}
            <div class="profile-stats">
              <button class="profile-stat" data-tab="friends" style="border:0;background:none;color:inherit;text-align:left"><b>${user.friends_count}</b><span>Bạn bè</span></button>
              <div class="profile-stat"><b>${user.followers}</b><span>Người theo dõi</span></div>
              <div class="profile-stat"><b>${user.following}</b><span>Đang theo dõi</span></div>
              <div class="profile-stat"><b>${user.posts_count}</b><span>Bài viết</span></div>
            </div>
          </div>
        </div>
        <div class="tabs mb" id="profile-tabs">
          <button class="tab active" data-tab="posts">Bài viết</button>
          <button class="tab" data-tab="friends">Bạn bè</button>
          <button class="tab" data-tab="about">Giới thiệu</button>
        </div>
        <div id="profile-content"></div>
      </div>`;

    bindActions(container, user);
    const content = container.querySelector('#profile-content');
    container.querySelector('#profile-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      container.querySelectorAll('#profile-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
      openTab(tab.dataset.tab);
    });

    async function openTab(name) {
      if (name === 'posts') return loadPosts();
      if (name === 'friends') return loadFriends();
      content.innerHTML = `<div class="card card-pad">
        <div class="section-head"><h2>Giới thiệu</h2></div>
        <div class="col">
          <div class="row">${icon('user', 18)}<div><div class="faint small">Tên</div><div>${esc(user.display_name)}</div></div></div>
          <div class="row">${icon('message', 18)}<div><div class="faint small">Username</div><div>@${esc(user.username)}</div></div></div>
          ${user.bio ? `<div class="row">${icon('edit', 18)}<div><div class="faint small">Tiểu sử</div><div>${esc(user.bio)}</div></div></div>` : ''}
          ${user.birthday ? `<div class="row">${icon('calendar', 18)}<div><div class="faint small">Ngày sinh</div><div>${esc(new Date(user.birthday).toLocaleDateString('vi-VN'))}</div></div></div>` : ''}
          ${user.gender ? `<div class="row">${icon('users', 18)}<div><div class="faint small">Giới tính</div><div>${esc(user.gender)}</div></div></div>` : ''}
          <div class="row">${icon('clock', 18)}<div><div class="faint small">Tham gia</div><div>${esc(new Date(user.created_at).toLocaleDateString('vi-VN'))}</div></div></div>
          <div class="row">${icon('globe', 18)}<div><div class="faint small">Quyền riêng tư hồ sơ</div><div>${user.privacy?.profile_visibility === 'public' ? 'Công khai' : user.privacy?.profile_visibility === 'friends' ? 'Bạn bè' : 'Riêng tư'}</div></div></div>
        </div>
      </div>`;
    }

    async function loadPosts() {
      content.innerHTML = spinner('Đang tải bài viết…');
      let offset = 0;
      try {
        const data = await api.get(`/api/feed?author=${encodeURIComponent(user.id)}&limit=10&offset=0`);
        if (!data.items.length) {
          content.innerHTML = empty(user.relationship === 'self' ? 'Bạn chưa có bài viết nào. Hãy chia sẻ điều gì đó!' : 'Chưa có bài viết nào', 'edit');
          return;
        }
        content.innerHTML = `<div id="profile-posts"></div><div id="profile-more" class="center mt"></div>`;
        const box = content.querySelector('#profile-posts');
        box._postIndex = new Map(data.items.map((p) => [p.id, p]));
        box.innerHTML = data.items.map(postCard).join('');
        bindPostInteractions(box, {
          onChanged: (post, action) => {
            if (action === 'share' && post?.id) {
              box._postIndex.set(post.id, post);
              box.insertAdjacentHTML('afterbegin', postCard(post));
            }
          },
        });
        offset = data.items.length;
        const more = content.querySelector('#profile-more');
        const drawMore = () => {
          more.innerHTML = offset < data.total ? `<button class="btn btn-ghost">Xem thêm</button>` : '';
          const btn = more.querySelector('button');
          if (!btn) return;
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const next = await api.get(`/api/feed?author=${encodeURIComponent(user.id)}&limit=10&offset=${offset}`);
              for (const p of next.items) box._postIndex.set(p.id, p);
              box.insertAdjacentHTML('beforeend', next.items.map(postCard).join(''));
              offset += next.items.length;
              drawMore();
            } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
          };
        };
        drawMore();
      } catch (err) {
        content.innerHTML = empty(err.message, 'alert');
      }
    }

    async function loadFriends() {
      content.innerHTML = spinner('Đang tải bạn bè…');
      try {
        const data = await api.get(`/api/users/${user.id}/friends?limit=50`);
        if (!data.items.length) { content.innerHTML = empty('Chưa có bạn bè', 'users'); return; }
        content.innerHTML = `<div class="card list-card">${data.items.map((u) => userRow(u, addFriendButton(u))).join('')}</div>`;
        bindFriendButtons(content);
      } catch (err) { content.innerHTML = empty(err.message, 'alert'); }
    }

    if (params.tab === 'friends') {
      container.querySelector(`#profile-tabs [data-tab="friends"]`)?.click();
    } else {
      loadPosts();
    }

    function bindActions(scope, u) {
      bindFriendButtons(scope, () => renderProfile(container, params));
      bindFollowButtons(scope);
      const edit = scope.querySelector('#edit-profile');
      if (edit) edit.onclick = () => openEditProfile(user, () => renderProfile(container, params));
      const msg = scope.querySelector('#btn-message');
      if (msg) msg.onclick = async () => {
        msg.disabled = true;
        try {
          const d = await api.post('/api/conversations', { kind: 'dm', user_id: user.id });
          navigate(`/messages/${d.conversation.id}`);
        } catch (err) { toast(err.message, 'error'); msg.disabled = false; }
      };
      const unblock = scope.querySelector('[data-unblock]');
      if (unblock) unblock.onclick = async () => {
        try {
          await api.del(`/api/blocks/${user.id}`);
          toast('Đã bỏ chặn', 'success');
          renderProfile(container, params);
        } catch (err) { toast(err.message, 'error'); }
      };
      const more = scope.querySelector('#profile-more');
      if (more) more.onclick = () => {
        const m = modal({
          title: 'Tùy chọn hồ sơ',
          content: `<div class="col">
            <button class="btn btn-ghost btn-block" data-report>${icon('flag', 17)} Báo cáo người dùng</button>
            <button class="btn btn-ghost btn-block" data-block style="color:var(--danger)">${icon('lock', 17)} Chặn người dùng</button>
          </div>`,
        });
        m.overlay.querySelector('[data-report]').onclick = () => { m.close(); openReport('user', user.id); };
        m.overlay.querySelector('[data-block]').onclick = async () => {
          m.close();
          if (!await confirmDialog(`Chặn @${user.username}? Hai bạn sẽ không thể nhắn tin hay xem nội dung của nhau.`, { danger: true, confirmText: 'Chặn' })) return;
          try {
            await api.post(`/api/blocks/${user.id}`);
            toast('Đã chặn người dùng', 'success');
            renderProfile(container, params);
          } catch (err) { toast(err.message, 'error'); }
        };
      };
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state error-state">${icon('alert', 34)}<p>${esc(err.message)}</p><a class="btn btn-ghost" href="#/feed">Về bảng tin</a></div>`;
  }
}

function openEditProfile(user, onSaved) {
  const m = modal({
    title: 'Chỉnh sửa hồ sơ',
    wide: true,
    content: `
      <div class="row mb" style="gap:14px">
        <div class="center"><div id="avatar-preview">${avatar(user, 72)}</div><button class="btn btn-sm btn-ghost mt" id="upload-avatar">Đổi ảnh đại diện</button></div>
        <div class="center"><div id="cover-preview" style="width:220px;height:70px;border-radius:10px;overflow:hidden;background:var(--gradient)">${user.cover_url ? `<img src="${esc(user.cover_url)}" style="width:100%;height:100%;object-fit:cover">` : ''}</div><button class="btn btn-sm btn-ghost mt" id="upload-cover">Đổi ảnh bìa</button></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Tên hiển thị</label><input class="input" id="pf-name" value="${esc(user.display_name)}" maxlength="80"></div>
        <div class="field"><label>Username</label><input class="input" id="pf-username" value="${esc(user.username)}" maxlength="32"></div>
        <div class="field"><label>Ngày sinh</label><input class="input" type="date" id="pf-birthday" value="${esc(user.birthday || '')}"></div>
        <div class="field"><label>Giới tính</label><select class="select" id="pf-gender">${['', 'Nam', 'Nữ', 'Khác'].map((g) => `<option value="${g}" ${user.gender === g ? 'selected' : ''}>${g || 'Không tiết lộ'}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Tiểu sử</label><textarea class="textarea" id="pf-bio" maxlength="500">${esc(user.bio || '')}</textarea></div>
      <div class="field"><label>Ngôn ngữ</label><select class="select" id="pf-locale">${[['vi', 'Tiếng Việt'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['ja', '日本語'], ['zh', '中文']].map(([v, l]) => `<option value="${v}" ${user.locale === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <input type="file" id="pf-file" accept="image/*" hidden>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu</button>`,
  });
  let target = 'avatar';
  const values = { avatar_url: user.avatar_url, cover_url: user.cover_url };
  const file = m.overlay.querySelector('#pf-file');
  m.overlay.querySelector('#upload-avatar').onclick = () => { target = 'avatar'; file.click(); };
  m.overlay.querySelector('#upload-cover').onclick = () => { target = 'cover'; file.click(); };
  file.onchange = async () => {
    if (!file.files[0]) return;
    try {
      const media = await api.upload(file.files[0]);
      if (target === 'avatar') {
        values.avatar_url = media.url;
        m.overlay.querySelector('#avatar-preview').innerHTML = `<img class="avatar" src="${esc(media.url)}" style="width:72px;height:72px">`;
      } else {
        values.cover_url = media.url;
        m.overlay.querySelector('#cover-preview').innerHTML = `<img src="${esc(media.url)}" style="width:100%;height:100%;object-fit:cover">`;
      }
      toast('Đã tải ảnh', 'success');
    } catch (err) { toast(err.message, 'error'); }
    file.value = '';
  };
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-save]').onclick = async () => {
    const btn = m.overlay.querySelector('[data-save]');
    btn.disabled = true;
    try {
      await api.patch('/api/users/me', {
        display_name: m.overlay.querySelector('#pf-name').value.trim(),
        username: m.overlay.querySelector('#pf-username').value.trim(),
        bio: m.overlay.querySelector('#pf-bio').value.trim(),
        birthday: m.overlay.querySelector('#pf-birthday').value || null,
        gender: m.overlay.querySelector('#pf-gender').value || null,
        locale: m.overlay.querySelector('#pf-locale').value,
        avatar_url: values.avatar_url || null,
        cover_url: values.cover_url || null,
      });
      await loadMe();
      m.close();
      toast('Đã cập nhật hồ sơ', 'success');
      onSaved();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}
