import { api, auth } from '../api.js';
import {
  icon, esc, avatar, toast, spinner, empty, modal, confirmDialog, timeAgo, fullDate,
} from '../ui.js';

const TABS = {
  account: 'Tài khoản',
  preferences: 'Tùy chọn',
  privacy: 'Quyền riêng tư',
  security: 'Bảo mật',
  data: 'Dữ liệu',
};

export async function renderSettings(container, query = {}) {
  const initial = TABS[query.tab] ? query.tab : 'account';
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Cài đặt</h1><p class="page-sub">Quản lý tài khoản, trải nghiệm và quyền riêng tư.</p></div></div>
    <div class="tabs mb" id="set-tabs">${Object.entries(TABS).map(([k, label]) => `<button class="tab ${k === initial ? 'active' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>
    <div id="set-body">${spinner()}</div>`;
  const body = container.querySelector('#set-body');
  container.querySelector('#set-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#set-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    history.replaceState(null, '', `#/settings?tab=${tab.dataset.tab}`);
    show(tab.dataset.tab);
  };
  function show(tab) {
    if (tab === 'preferences') return loadPreferences();
    if (tab === 'privacy') return loadPrivacy();
    if (tab === 'security') return loadSecurity();
    if (tab === 'data') return loadData();
    return loadAccount();
  }

  function loadAccount() {
    const u = auth.user;
    body.innerHTML = `
      <div class="card card-pad">
        <div class="row mb" style="gap:14px">${avatar(u, 64)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)} · ${esc(u.email || '')}</div></div></div>
        <div class="form-grid">
          <div class="field"><label>Tên hiển thị</label><input class="input" id="acc-name" maxlength="80" value="${esc(u.display_name)}"></div>
          <div class="field"><label>Tên người dùng</label><input class="input" id="acc-username" maxlength="30" value="${esc(u.username)}"></div>
        </div>
        <div class="field"><label>Tiểu sử</label><textarea class="textarea" id="acc-bio" maxlength="500">${esc(u.bio || '')}</textarea></div>
        <button class="btn btn-primary" id="acc-save">Lưu thay đổi</button>
      </div>
      <div class="card card-pad mt">
        <h3 style="margin-top:0">Liên kết nhanh</h3>
        <div class="row wrap">
          <a class="btn btn-ghost" href="#/profile/${esc(u.username)}">${icon('user', 16)} Xem hồ sơ</a>
          <a class="btn btn-ghost" href="#/friends">${icon('users', 16)} Bạn bè & chặn</a>
          <a class="btn btn-ghost" href="#/analytics">${icon('chart', 16)} Thống kê</a>
          ${/HAONLINEAndroid/i.test(navigator.userAgent) ? `<a class="btn btn-ghost" href="/__server">${icon('globe', 16)} Máy chủ ứng dụng</a>` : ''}
        </div>
      </div>`;
    body.querySelector('#acc-save').onclick = async () => {
      const payload = {
        display_name: body.querySelector('#acc-name').value.trim(),
        username: body.querySelector('#acc-username').value.trim(),
        bio: body.querySelector('#acc-bio').value.trim(),
      };
      if (!payload.display_name) return toast('Tên hiển thị không được để trống', 'error');
      try {
        const d = await api.patch('/api/users/me', payload);
        auth.user = { ...auth.user, ...d.user };
        document.querySelector('#sidebar-user .user-chip-name')?.replaceChildren(document.createTextNode(auth.user.display_name));
        toast('Đã lưu thay đổi', 'success');
        loadAccount();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function loadPreferences() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/settings');
      const s = d.settings || {};
      const theme = s.theme ?? document.documentElement.dataset.theme ?? 'dark';
      body.innerHTML = `
        <div class="card card-pad">
          <div class="form-grid">
            <div class="field"><label>Giao diện</label><select class="select" id="pref-theme">
              ${opt('dark', 'Tối', theme)}${opt('light', 'Sáng', theme)}${opt('system', 'Theo hệ thống', theme)}</select></div>
            <div class="field"><label>Ngôn ngữ</label><select class="select" id="pref-language">
              ${opt('vi', 'Tiếng Việt', s.language)}${opt('en', 'English', s.language)}${opt('es', 'Español', s.language)}${opt('fr', 'Français', s.language)}${opt('ja', '日本語', s.language)}${opt('zh', '中文', s.language)}</select></div>
            <div class="field"><label>Cỡ chữ</label><select class="select" id="pref-font">
              ${opt('small', 'Nhỏ', s.font_size)}${opt('medium', 'Vừa', s.font_size)}${opt('large', 'Lớn', s.font_size)}</select></div>
          </div>
          ${toggle('notifications_email', 'Thông báo qua email', s.notifications_email !== false, 'Nhận email khi có hoạt động quan trọng.')}
          ${toggle('notifications_push', 'Thông báo đẩy', s.notifications_push !== false, 'Nhận thông báo trên thiết bị.')}
          ${toggle('autoplay_reels', 'Tự phát reels', s.autoplay_reels !== false, 'Tự động phát khi cuộn tới.')}
          ${toggle('reduce_motion', 'Giảm chuyển động', !!s.reduce_motion, 'Hạn chế hiệu ứng động.')}
          ${toggle('show_online_status', 'Hiển thị trạng thái online', s.show_online_status !== false, 'Cho người khác thấy bạn đang hoạt động.')}
          <div class="card card-pad mt" id="push-card"><div class="row-between"><div><div class="person-name">Thông báo đẩy trên thiết bị</div><div class="person-meta" id="push-state">Đang kiểm tra…</div></div><button class="btn btn-sm btn-ghost" id="push-toggle">Bật</button></div></div>
          <button class="btn btn-primary mt" id="pref-save">Lưu tùy chọn</button>
        </div>`;
      setupPush();
      body.querySelector('#pref-save').onclick = async () => {
        const payload = {
          theme: body.querySelector('#pref-theme').value,
          language: body.querySelector('#pref-language').value,
          font_size: body.querySelector('#pref-font').value,
          notifications_email: body.querySelector('#tg-notifications_email').checked,
          notifications_push: body.querySelector('#tg-notifications_push').checked,
          autoplay_reels: body.querySelector('#tg-autoplay_reels').checked,
          reduce_motion: body.querySelector('#tg-reduce_motion').checked,
          show_online_status: body.querySelector('#tg-show_online_status').checked,
        };
        try {
          await api.patch('/api/settings', { settings: payload });
          auth.settings = { ...auth.settings, ...payload };
          if (payload.theme !== 'system') document.documentElement.dataset.theme = payload.theme;
          localStorage.setItem('haonline.theme', payload.theme);
          document.documentElement.classList.toggle('reduce-motion', payload.reduce_motion);
          document.documentElement.dataset.fontSize = payload.font_size;
          toast('Đã lưu tùy chọn', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function setupPush() {
    const state = body.querySelector('#push-state');
    const btn = body.querySelector('#push-toggle');
    if (!state || !btn) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      state.textContent = 'Trình duyệt này không hỗ trợ thông báo đẩy.';
      btn.disabled = true;
      return;
    }
    try {
      const status = await api.get('/api/notifications/push/status');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const supported = status.configured;
      state.textContent = !supported
        ? 'Máy chủ chưa cấu hình VAPID cho thông báo đẩy.'
        : sub ? `Đang bật · ${status.subscriptions || 1} thiết bị` : 'Chưa bật trên thiết bị này.';
      btn.disabled = !supported;
      btn.textContent = sub ? 'Tắt' : 'Bật';
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          if (sub) {
            await sub.unsubscribe();
            await api.del('/api/notifications/push/subscribe');
            toast('Đã tắt thông báo đẩy', 'success');
          } else {
            if (Notification.permission === 'denied') throw new Error('Quyền thông báo đã bị chặn trong trình duyệt');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') throw new Error('Bạn chưa cho phép thông báo');
            const fresh = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(status.public_key),
            });
            await api.post('/api/notifications/push/subscribe', fresh.toJSON());
            toast('Đã bật thông báo đẩy', 'success');
          }
          setupPush();
        } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
      };
    } catch (err) {
      state.textContent = err.message;
      btn.disabled = true;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function loadPrivacy() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/privacy');
      const p = d.privacy || {};
      body.innerHTML = `
        <div class="card card-pad">
          <div class="form-grid">
            <div class="field"><label>Ai có thể xem hồ sơ</label><select class="select" id="pr-profile">${opt('public', 'Mọi người', p.profile_visibility)}${opt('friends', 'Bạn bè', p.profile_visibility)}${opt('private', 'Chỉ mình tôi', p.profile_visibility)}</select></div>
            <div class="field"><label>Quyền xem bài đăng mặc định</label><select class="select" id="pr-post">${opt('public', 'Công khai', p.post_default_visibility)}${opt('friends', 'Bạn bè', p.post_default_visibility)}${opt('private', 'Riêng tư', p.post_default_visibility)}</select></div>
            <div class="field"><label>Lời mời kết bạn</label><select class="select" id="pr-friend">${opt('everyone', 'Mọi người', p.friend_request_policy)}${opt('friends_of_friends', 'Bạn của bạn bè', p.friend_request_policy)}${opt('nobody', 'Không ai', p.friend_request_policy)}</select></div>
            <div class="field"><label>Ai có thể nhắn tin</label><select class="select" id="pr-msg">${opt('everyone', 'Mọi người', p.who_can_message)}${opt('friends', 'Bạn bè', p.who_can_message)}${opt('none', 'Không ai', p.who_can_message)}</select></div>
            <div class="field"><label>Ai có thể gắn thẻ</label><select class="select" id="pr-tag">${opt('everyone', 'Mọi người', p.who_can_tag)}${opt('friends', 'Bạn bè', p.who_can_tag)}${opt('nobody', 'Không ai', p.who_can_tag)}</select></div>
          </div>
          ${toggle('searchable', 'Cho phép tìm thấy tôi', p.searchable !== 0, 'Hiện hồ sơ trong kết quả tìm kiếm.')}
          ${toggle('show_activity', 'Hiển thị hoạt động', p.show_activity !== 0, 'Cho người khác thấy hoạt động gần đây.')}
          ${toggle('allow_data_export', 'Cho phép xuất dữ liệu', p.allow_data_export !== 0, 'Bật tải bản sao dữ liệu cá nhân.')}
          <button class="btn btn-primary mt" id="pr-save">Lưu quyền riêng tư</button>
        </div>
        <div class="card card-pad mt">
          <h3 style="margin-top:0">Người đã chặn</h3>
          ${d.blocked?.length ? d.blocked.map((b) => `<div class="person-row"><span class="person-meta">${esc(b.blocked_id)}</span><span class="tiny muted">${timeAgo(b.created_at)}</span></div>`).join('') : '<p class="small muted">Bạn chưa chặn ai.</p>'}
          <a class="btn btn-ghost btn-sm mt" href="#/friends?tab=blocked">Quản lý danh sách chặn</a>
        </div>`;
      body.querySelector('#pr-save').onclick = async () => {
        const payload = {
          profile_visibility: body.querySelector('#pr-profile').value,
          post_default_visibility: body.querySelector('#pr-post').value,
          friend_request_policy: body.querySelector('#pr-friend').value,
          who_can_message: body.querySelector('#pr-msg').value,
          who_can_tag: body.querySelector('#pr-tag').value,
          searchable: body.querySelector('#tg-searchable').checked,
          show_activity: body.querySelector('#tg-show_activity').checked,
          allow_data_export: body.querySelector('#tg-allow_data_export').checked,
        };
        try { await api.patch('/api/privacy', payload); toast('Đã lưu quyền riêng tư', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      };
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadSecurity() {
    body.innerHTML = spinner();
    try {
      const [sessions, tfa, history] = await Promise.all([
        api.get('/api/security/sessions').catch(() => ({ items: [] })),
        api.get('/api/security/2fa').catch(() => ({ enabled: false })),
        api.get('/api/security/login-history?limit=20').catch(() => ({ items: [] })),
      ]);
      body.innerHTML = `
        <div class="card card-pad">
          <div class="row-between"><h3 style="margin:0">Xác thực hai lớp</h3><span class="badge ${tfa.enabled ? 'badge-primary' : ''}">${tfa.enabled ? 'Đang bật' : 'Đang tắt'}</span></div>
          <p class="small muted">Dùng ứng dụng xác thực (TOTP) để bảo vệ tài khoản.</p>
          <div class="row">${tfa.enabled ? '<button class="btn btn-danger btn-sm" id="tfa-disable">Tắt 2FA</button>' : '<button class="btn btn-primary btn-sm" id="tfa-setup">Thiết lập 2FA</button>'}</div>
        </div>
        <div class="card card-pad mt">
          <div class="row-between"><h3 style="margin:0">Đổi mật khẩu</h3></div>
          <div class="field"><label>Mật khẩu hiện tại</label><input class="input" type="password" id="pw-current" autocomplete="current-password"></div>
          <div class="field"><label>Mật khẩu mới</label><input class="input" type="password" id="pw-new" autocomplete="new-password"></div>
          <button class="btn btn-primary" id="pw-save">Cập nhật mật khẩu</button>
        </div>
        <div class="card list-card mt">
          <div class="card-pad row-between"><h3 style="margin:0">Phiên đăng nhập</h3><button class="btn btn-ghost btn-sm" id="revoke-all">Đăng xuất các thiết bị khác</button></div>
          ${sessions.items.length ? sessions.items.map((s) => `<div class="person-row"><span class="notif-icon">${icon('monitor', 17)}</span>
            <div class="grow"><div class="person-name">${esc(s.device || 'Thiết bị không xác định')} ${s.current ? '<span class="badge badge-primary">Hiện tại</span>' : ''}</div>
            <div class="person-meta">${esc(s.ip || '')} · hoạt động ${timeAgo(s.last_seen_at)}</div></div>
            ${!s.current ? `<button class="btn btn-sm btn-ghost" data-session="${esc(s.id)}">Thu hồi</button>` : ''}</div>`).join('') : '<p class="muted small" style="padding:16px">Không có phiên hoạt động</p>'}
          <div class="card-pad" style="border-top:1px solid var(--border)">
            <button class="btn btn-danger btn-block" id="logout-current">${icon('logout', 16)} Đăng xuất khỏi thiết bị này</button>
          </div>
        </div>
        <div class="card list-card mt">
          <div class="card-pad"><h3 style="margin:0">Lịch sử đăng nhập</h3></div>
          ${history.items.length ? history.items.map((h) => `<div class="person-row"><span class="notif-icon">${icon('clock', 17)}</span><div class="grow"><div class="small">${esc(h.device || h.ip || 'Đăng nhập')}</div><div class="person-meta">${fullDate(h.created_at)}${h.success === 0 ? ' · thất bại' : ''}</div></div></div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có dữ liệu</p>'}
        </div>`;
      body.querySelector('#pw-save').onclick = async () => {
        const current = body.querySelector('#pw-current').value;
        const next = body.querySelector('#pw-new').value;
        if (next.length < 8) return toast('Mật khẩu mới cần ít nhất 8 ký tự', 'error');
        try {
          await api.post('/api/security/password', { current_password: current, new_password: next });
          body.querySelector('#pw-current').value = '';
          body.querySelector('#pw-new').value = '';
          toast('Đã đổi mật khẩu. Các phiên khác đã bị đăng xuất.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
      body.querySelector('#tfa-setup')?.addEventListener('click', open2faSetup);
      body.querySelector('#tfa-disable')?.addEventListener('click', async () => {
        const password = prompt('Nhập mật khẩu để tắt 2FA');
        if (!password) return;
        try { await api.post('/api/security/2fa/disable', { password }); toast('Đã tắt 2FA', 'success'); loadSecurity(); }
        catch (err) { toast(err.message, 'error'); }
      });
      body.querySelector('#revoke-all').onclick = async () => {
        if (!(await confirmDialog('Đăng xuất khỏi tất cả thiết bị khác?', { danger: true, confirmText: 'Đăng xuất' }))) return;
        try { await api.post('/api/security/sessions/revoke-all'); toast('Đã thu hồi các phiên khác', 'success'); loadSecurity(); }
        catch (err) { toast(err.message, 'error'); }
      };
      body.querySelector('#logout-current').onclick = async () => {
        if (!(await confirmDialog('Đăng xuất khỏi thiết bị này?', { danger: true, confirmText: 'Đăng xuất' }))) return;
        window.dispatchEvent(new Event('haonline:logout'));
      };
      body.querySelectorAll('[data-session]').forEach((b) => {
        b.onclick = async () => {
          try { await api.del(`/api/security/sessions/${b.dataset.session}`); toast('Đã thu hồi phiên', 'success'); loadSecurity(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function open2faSetup() {
    let data;
    try { data = await api.post('/api/security/2fa/setup'); }
    catch (err) { return toast(err.message, 'error'); }
    const m = modal({
      title: 'Thiết lập 2FA',
      content: `<p class="small muted">Thêm khóa sau vào ứng dụng xác thực, rồi nhập mã 6 số để hoàn tất.</p>
        <div class="card card-pad"><code style="word-break:break-all;user-select:all">${esc(data.secret)}</code></div>
        <p class="tiny muted mt" style="word-break:break-all">${esc(data.otpauth_uri)}</p>
        <div class="field"><label>Mã xác thực</label><input class="input" id="tfa-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>`,
      actions: '<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-enable>Bật 2FA</button>',
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-enable]').onclick = async () => {
      try {
        await api.post('/api/security/2fa/enable', { code: m.overlay.querySelector('#tfa-code').value.trim() });
        m.close();
        toast('Đã bật 2FA', 'success');
        loadSecurity();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function loadData() {
    body.innerHTML = `
      <div class="card card-pad">
        <h3 style="margin-top:0">Xuất dữ liệu</h3>
        <p class="small muted">Tải bản sao dữ liệu HAONLINE của bạn dưới dạng JSON, gồm bài viết, bạn bè, tin nhắn và cài đặt.</p>
        <button class="btn btn-primary" id="data-export">${icon('download', 16)} Tạo bản sao</button>
        <div id="export-result" class="mt"></div>
      </div>
      <div class="card card-pad mt" style="border-color:rgba(239,68,68,.35)">
        <h3 style="margin-top:0">Xóa tài khoản</h3>
        <p class="small muted">Tài khoản sẽ bị vô hiệu hóa ngay lập tức và xóa vĩnh viễn sau 30 ngày. Hành động này không thể hoàn tác.</p>
        <button class="btn btn-danger" id="data-delete">Xóa tài khoản</button>
      </div>`;
    body.querySelector('#data-export').onclick = async () => {
      const out = body.querySelector('#export-result');
      out.innerHTML = spinner('Đang tạo bản sao…');
      try {
        const d = await api.post('/api/privacy/export');
        out.innerHTML = d.job?.status === 'completed'
          ? `<a class="btn btn-ghost" href="${esc(d.job.result_url)}" download>${icon('download', 16)} Tải xuống bản sao</a>`
          : `<p class="small muted">Yêu cầu đang xử lý. Quay lại sau.</p>`;
      } catch (err) { out.innerHTML = `<p class="small" style="color:var(--danger)">${esc(err.message)}</p>`; }
    };
    body.querySelector('#data-delete').onclick = () => {
      const m = modal({
        title: 'Xóa tài khoản',
        content: `<p class="small" style="color:var(--danger)">Thao tác này không thể hoàn tác. Nhập <b>${esc(auth.user.username)}</b> hoặc <b>DELETE</b> để xác nhận.</p>
          <div class="field"><label>Xác nhận</label><input class="input" id="del-confirm" autocomplete="off"></div>
          <div class="field"><label>Mật khẩu</label><input class="input" type="password" id="del-password" autocomplete="current-password"></div>`,
        actions: '<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-danger" data-delete>Xóa vĩnh viễn</button>',
      });
      m.overlay.querySelector('[data-cancel]').onclick = m.close;
      m.overlay.querySelector('[data-delete]').onclick = async () => {
        try {
          await api.post('/api/privacy/delete-account', {
            confirm: m.overlay.querySelector('#del-confirm').value.trim(),
            password: m.overlay.querySelector('#del-password').value,
          });
          m.close();
          toast('Tài khoản đã được vô hiệu hóa', 'success');
          setTimeout(() => { localStorage.removeItem('haonline.token'); location.reload(); }, 1200);
        } catch (err) { toast(err.message, 'error'); }
      };
    };
  }

  function opt(value, label, current) {
    return `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${label}</option>`;
  }

  function toggle(key, label, checked, hint = '') {
    return `<label class="person-row" style="cursor:pointer">
      <div class="grow"><div class="person-name">${label}</div>${hint ? `<div class="person-meta">${hint}</div>` : ''}</div>
      <input type="checkbox" class="switch" id="tg-${key}" ${checked ? 'checked' : ''}>
    </label>`;
  }

  show(initial);
}
