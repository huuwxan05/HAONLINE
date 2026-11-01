import { api, auth, isAdmin } from '../api.js';
import {
  icon, esc, avatar, money, compact, timeAgo, fullDate, toast, spinner, empty, modal, confirmDialog, navigate,
} from '../ui.js';

export async function renderAdmin(container) {
  const admin = isAdmin();
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Quản trị</h1><p class="page-sub">Điều hành hệ thống HAONLINE.</p></div>
      <button class="btn btn-ghost" id="admin-refresh">${icon('refresh', 16)} Làm mới</button></div>
    <div class="tabs mb" id="admin-tabs">
      <button class="tab active" data-tab="dashboard">Tổng quan</button>
      <button class="tab" data-tab="users">Người dùng</button>
      <button class="tab" data-tab="analytics">Phân tích</button>
      <button class="tab" data-tab="system">Hệ thống</button>
      ${admin ? '<button class="tab" data-tab="settings">Cấu hình</button><button class="tab" data-tab="backups">Sao lưu</button><button class="tab" data-tab="email">Email</button>' : ''}
    </div>
    <div id="admin-body">${spinner()}</div>`;
  const body = container.querySelector('#admin-body');
  container.querySelector('#admin-refresh').onclick = () => {
    const active = container.querySelector('#admin-tabs .tab.active')?.dataset.tab || 'dashboard';
    show(active);
  };
  container.querySelector('#admin-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#admin-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    show(tab.dataset.tab);
  };

  function show(tab) {
    if (tab === 'users') return loadUsers();
    if (tab === 'analytics') return loadAnalytics();
    if (tab === 'system') return loadSystem();
    if (tab === 'settings') return loadSettings();
    if (tab === 'backups') return loadBackups();
    if (tab === 'email') return loadEmail();
    return loadDashboard();
  }

  async function loadDashboard() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/admin/dashboard');
      const u = d.users; const c = d.content; const m = d.monetization;
      body.innerHTML = `
        <div class="stat-grid">
          ${stat('Người dùng', compact(u.total), 'users')}${stat('Đang hoạt động', compact(u.active), 'user')}${stat('Online', compact(u.online), 'radio')}${stat('Mới 24 giờ', compact(u.new_24h), 'userPlus')}
          ${stat('Bài viết', compact(c.posts), 'file')}${stat('Bình luận', compact(c.comments), 'comment')}${stat('Reels', compact(c.reels), 'video')}${stat('Đang live', compact(c.live_now), 'radio')}
          ${stat('Nhóm', compact(d.communities.groups), 'users')}${stat('Trang', compact(d.communities.pages), 'flag')}${stat('Sự kiện', compact(d.communities.events), 'calendar')}${stat('Sản phẩm', compact(d.communities.products), 'shopping')}
        </div>
        <div class="grid-2 mt">
          <div class="card card-pad"><h3 style="margin-top:0">Kiểm duyệt</h3>
            <div class="row-between"><span class="muted small">Báo cáo đang mở</span><b>${d.moderation.open_reports}</b></div>
            <div class="row-between mt"><span class="muted small">Báo cáo 24 giờ</span><b>${d.moderation.reports_24h}</b></div>
            <a class="btn btn-ghost btn-sm mt" href="#/moderation">${icon('shield', 15)} Mở hàng đợi</a></div>
          <div class="card card-pad"><h3 style="margin-top:0">Doanh thu</h3>
            <div class="row-between"><span class="muted small">Đã ghi nhận</span><b>${money(m.revenue_cents)}</b></div>
            <div class="row-between mt"><span class="muted small">Thu nhập chờ duyệt</span><b>${money(m.earnings_pending_cents)}</b></div>
            <div class="row-between mt"><span class="muted small">Chi trả chờ xử lý</span><b>${money(m.payouts_pending_cents)}</b></div></div>
        </div>
        <div class="card card-pad mt">
          <h3 style="margin-top:0">Hệ thống</h3>
          <div class="grid-2 small">
            <div class="row-between"><span class="muted">Phiên bản</span><span>${esc(d.system.version)} · ${esc(d.system.env)}</span></div>
            <div class="row-between"><span class="muted">Uptime</span><span>${Math.floor(d.system.uptime_seconds / 3600)} giờ</span></div>
            <div class="row-between"><span class="muted">Cơ sở dữ liệu</span><span>${(d.system.database_bytes / 1048576).toFixed(1)} MB</span></div>
            <div class="row-between"><span class="muted">Thanh toán</span><span>${d.system.payments_configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</span></div>
          </div>
        </div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadUsers(q = '') {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/admin/users?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      body.innerHTML = `
        <div class="row mb"><input class="input" id="user-search" placeholder="Tìm theo tên, username, email…" value="${esc(q)}" style="max-width:340px"><button class="btn btn-primary" id="user-search-btn">${icon('search', 16)} Tìm</button></div>
        <div class="card list-card">${d.items.length ? d.items.map((u) => `<div class="person-row">
          ${avatar(u, 40)}<div class="grow"><div class="person-name">${esc(u.display_name)} <span class="badge">${esc(u.role)}</span> ${u.status !== 'active' ? `<span class="badge" style="color:var(--danger)">${esc(u.status)}</span>` : ''}</div>
          <div class="person-meta">@${esc(u.username)} · ${esc(u.email || '')} · ${u.posted} bài · ${u.reports} báo cáo</div></div>
          <div class="row" style="gap:6px"><span class="tiny muted">${timeAgo(u.created_at)}</span>${admin ? `<button class="btn btn-sm btn-ghost" data-user="${esc(u.id)}">Quản lý</button>` : ''}</div>
        </div>`).join('') : empty('Không tìm thấy người dùng', 'users')}</div>
        <p class="tiny muted mt">${d.total} người dùng</p>`;
      body.querySelector('#user-search-btn').onclick = () => loadUsers(body.querySelector('#user-search').value.trim());
      body.querySelector('#user-search').onkeydown = (e) => { if (e.key === 'Enter') loadUsers(e.target.value.trim()); };
      body.querySelectorAll('[data-user]').forEach((b) => {
        b.onclick = () => manageUser(d.items.find((u) => u.id === b.dataset.user), () => loadUsers(q));
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function manageUser(u, refresh) {
    const m = modal({
      title: `Quản lý @${u.username}`,
      content: `<div class="row mb">${avatar(u, 48)}<div><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">${esc(u.email || '')} · ${esc(u.id)}</div></div></div>
        <div class="form-grid">
          <div class="field"><label>Vai trò</label><select class="select" id="mu-role">${['user', 'moderator', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
          <div class="field"><label>Trạng thái</label><select class="select" id="mu-status">${['active', 'suspended'].map((s) => `<option value="${s}" ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        </div>
        <label class="row small"><input type="checkbox" id="mu-verified" ${u.email_verified ? 'checked' : ''}> Email đã xác minh</label>
        <div class="row wrap mt" style="gap:8px">
          <a class="btn btn-ghost btn-sm" href="#/profile/${esc(u.username)}">Xem hồ sơ</a>
          <button class="btn btn-ghost btn-sm" id="mu-credit">Cộng thu nhập</button>
        </div>`,
      actions: '<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu</button>',
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-save]').onclick = async () => {
      try {
        await api.patch(`/api/admin/users/${u.id}`, {
          role: m.overlay.querySelector('#mu-role').value,
          status: m.overlay.querySelector('#mu-status').value,
          email_verified: m.overlay.querySelector('#mu-verified').checked,
        });
        m.close(); toast('Đã cập nhật người dùng', 'success'); refresh();
      } catch (err) { toast(err.message, 'error'); }
    };
    m.overlay.querySelector('#mu-credit').onclick = () => {
      const amount = prompt('Số tiền cộng (cent):', '1000');
      if (!amount) return;
      api.post('/api/admin/monetization/credit', { user_id: u.id, amount_cents: Number(amount), source: 'admin_credit' })
        .then(() => toast('Đã cộng thu nhập', 'success'))
        .catch((err) => toast(err.message, 'error'));
    };
  }

  async function loadAnalytics() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/admin/analytics?days=30');
      const series = [
        ['Người dùng mới', d.users, 'chart'],
        ['Bài viết', d.posts, 'file'],
        ['Tin nhắn', d.messages, 'message'],
        ['Người dùng hoạt động', d.active_users, 'users'],
      ];
      body.innerHTML = `
        <div class="grid-2">
          ${series.map(([label, rows, iconName]) => `<div class="card card-pad"><h3 style="margin-top:0">${icon(iconName, 17)} ${label}</h3>${bars(rows)}</div>`).join('')}
        </div>
        <div class="grid-2 mt">
          <div class="card card-pad"><h3 style="margin-top:0">Bài viết nổi bật</h3>
            ${d.top_posts.length ? d.top_posts.map((p) => `<a class="person-row" href="#/post/${esc(p.id)}" style="text-decoration:none;color:inherit"><div class="grow"><div class="small clamp-2">${esc(p.body || '(Không có nội dung)')}</div><div class="person-meta">@${esc(p.username)} · ${p.reactions} cảm xúc · ${p.comments} bình luận</div></div></a>`).join('') : '<p class="small muted">Chưa có</p>'}
          </div>
          <div class="card card-pad"><h3 style="margin-top:0">Loại sự kiện</h3>
            ${d.event_types.length ? d.event_types.map((e) => `<div class="row-between small mt"><span class="muted">${esc(e.type)}</span><b>${e.c}</b></div>`).join('') : '<p class="small muted">Chưa có</p>'}
          </div>
        </div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function bars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.c));
    return `<div class="chart-bars">${rows.length ? rows.map((r) => `<div class="chart-bar" style="height:${Math.max(3, Math.round((r.c / max) * 110))}px" title="${esc(r.day)}: ${r.c}"><span>${esc(String(r.day).slice(5))}</span></div>`).join('') : '<p class="muted small">Chưa có dữ liệu</p>'}</div>`;
  }

  async function loadSystem() {
    body.innerHTML = spinner();
    try {
      const [health, jobs, errors, audit] = await Promise.all([
        api.get('/api/admin/health'),
        api.get('/api/admin/jobs?limit=20'),
        api.get('/api/admin/errors?limit=20'),
        api.get('/api/admin/audit?limit=20'),
      ]);
      body.innerHTML = `
        <div class="grid-2">
          <div class="card card-pad"><div class="row-between"><h3 style="margin:0">Sức khỏe</h3><span class="badge ${health.status === 'healthy' ? 'badge-primary' : ''}">${esc(health.status)}</span></div>
            ${kv('Phiên bản', health.version)}${kv('Node', health.node)}${kv('Nền tảng', health.platform)}${kv('Uptime', `${Math.floor(health.uptime_seconds / 3600)} giờ`)}
            ${kv('Bộ nhớ RSS', `${(health.memory.rss / 1048576).toFixed(1)} MB`)}${kv('CSDL', `${(health.database.bytes / 1048576).toFixed(2)} MB`)}${kv('Toàn vẹn', health.database.integrity)}${kv('Online', health.online_users)}
            ${kv('Job chờ / lỗi', `${health.pending_jobs} / ${health.failed_jobs}`)}${kv('Email chờ', health.email_queued)}</div>
          <div class="card list-card"><div class="card-pad row-between"><h3 style="margin:0">Lỗi gần đây</h3>${admin && errors.items.length ? '<button class="btn btn-sm btn-ghost" id="clear-errors">Xóa</button>' : ''}</div>
            ${errors.items.length ? errors.items.map((e) => `<div class="person-row"><span class="notif-icon">${icon('alert', 16)}</span><div class="grow"><div class="small">${esc(e.message)}</div><div class="person-meta">${timeAgo(e.created_at)} · ${esc(e.route || '')}</div></div></div>`).join('') : '<p class="muted small" style="padding:16px">Không có lỗi</p>'}</div>
        </div>
        <div class="grid-2 mt">
          <div class="card list-card"><div class="card-pad"><h3 style="margin:0">Job</h3></div>${jobs.items.length ? jobs.items.map((j) => `<div class="person-row"><div class="grow"><div class="small">${esc(j.kind)}</div><div class="person-meta">${timeAgo(j.created_at)}</div></div><span class="badge">${esc(j.status)}</span></div>`).join('') : '<p class="muted small" style="padding:16px">Không có job</p>'}</div>
          <div class="card list-card"><div class="card-pad"><h3 style="margin:0">Nhật ký quản trị</h3></div>${audit.items.length ? audit.items.map((a) => `<div class="person-row"><div class="grow"><div class="small">${esc(a.action)} ${esc(a.target_type || '')}</div><div class="person-meta">${esc(a.actor?.username || a.actor_id || 'system')} · ${timeAgo(a.created_at)}</div></div></div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có</p>'}</div>
        </div>`;
      body.querySelector('#clear-errors')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Xóa toàn bộ nhật ký lỗi?', { danger: true, confirmText: 'Xóa' }))) return;
        try { await api.del('/api/admin/errors'); toast('Đã xóa', 'success'); loadSystem(); } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadSettings() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/admin/settings');
      const s = d.settings || {};
      body.innerHTML = `<div class="card card-pad">
        <div class="form-grid">
          <div class="field"><label>Tên site</label><input class="input" id="as-name" value="${esc(s.site_name || 'HAONLINE')}"></div>
          <div class="field"><label>Giới hạn upload (MB)</label><input class="input" type="number" min="1" id="as-upload" value="${Number(s.max_upload_mb || 200)}"></div>
        </div>
        <div class="field"><label>Thông báo kiểm duyệt</label><textarea class="textarea" id="as-notice">${esc(s.moderation_notice || '')}</textarea></div>
        ${adminToggle('registration_open', 'Mở đăng ký', s.registration_open !== false)}
        ${adminToggle('maintenance_mode', 'Chế độ bảo trì', !!s.maintenance_mode)}
        ${adminToggle('feature_live', 'Bật livestream', s.feature_live !== false)}
        ${adminToggle('feature_calls', 'Bật gọi điện', s.feature_calls !== false)}
        ${adminToggle('feature_marketplace', 'Bật chợ', s.feature_marketplace !== false)}
        <button class="btn btn-primary mt" id="as-save">Lưu cấu hình</button>
      </div>`;
      body.querySelector('#as-save').onclick = async () => {
        const payload = {
          site_name: body.querySelector('#as-name').value.trim(),
          max_upload_mb: Number(body.querySelector('#as-upload').value),
          moderation_notice: body.querySelector('#as-notice').value.trim(),
          registration_open: body.querySelector('#at-registration_open').checked,
          maintenance_mode: body.querySelector('#at-maintenance_mode').checked,
          feature_live: body.querySelector('#at-feature_live').checked,
          feature_calls: body.querySelector('#at-feature_calls').checked,
          feature_marketplace: body.querySelector('#at-feature_marketplace').checked,
        };
        try { await api.patch('/api/admin/settings', { settings: payload }); toast('Đã lưu cấu hình', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      };
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadBackups() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/admin/backups');
      body.innerHTML = `<div class="row-between mb"><h2 style="margin:0;font-size:18px">Sao lưu cơ sở dữ liệu</h2><button class="btn btn-primary" id="make-backup">${icon('download', 16)} Tạo bản sao</button></div>
        <div class="card list-card">${d.items.length ? d.items.map((b) => `<div class="person-row"><span class="notif-icon">${icon('database', 17)}</span>
          <div class="grow"><div class="small">${esc(b.path || b.id)}</div><div class="person-meta">${fullDate(b.created_at)} · ${(b.size / 1048576).toFixed(2)} MB</div></div>
          <span class="badge ${b.status === 'completed' ? 'badge-primary' : ''}">${esc(b.status)}</span></div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có bản sao lưu</p>'}</div>`;
      body.querySelector('#make-backup').onclick = async (e) => {
        e.target.disabled = true;
        try { await api.post('/api/admin/backups'); toast('Đã tạo bản sao lưu', 'success'); loadBackups(); }
        catch (err) { e.target.disabled = false; toast(err.message, 'error'); }
      };
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadEmail() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/admin/email-outbox?limit=50');
      body.innerHTML = `<div class="card list-card"><div class="card-pad"><h3 style="margin:0">Hộp thư gửi</h3></div>
        ${d.items.length ? d.items.map((e) => `<div class="person-row"><span class="notif-icon">${icon('mail', 17)}</span>
          <div class="grow"><div class="small">${esc(e.subject || '(Không tiêu đề)')}</div><div class="person-meta">${esc(e.to_email)} · ${timeAgo(e.created_at)}${e.error ? ` · ${esc(e.error)}` : ''}</div></div>
          <span class="badge ${e.status === 'sent' ? 'badge-primary' : ''}">${esc(e.status)}</span></div>`).join('') : '<p class="muted small" style="padding:16px">Không có email</p>'}</div>`;
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function stat(label, value, iconName) {
    return `<div class="card card-pad"><div class="tiny muted row" style="gap:6px">${icon(iconName, 14)} ${label}</div><div class="stat-value">${value}</div></div>`;
  }
  function kv(k, v) {
    return `<div class="row-between small mt"><span class="muted">${esc(k)}</span><span class="strong">${esc(String(v))}</span></div>`;
  }
  function adminToggle(key, label, checked) {
    return `<label class="person-row" style="cursor:pointer"><div class="grow"><div class="person-name">${label}</div></div><input class="switch" type="checkbox" id="at-${key}" ${checked ? 'checked' : ''}></label>`;
  }

  loadDashboard();
}

export async function renderModeration(container) {
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Kiểm duyệt</h1><p class="page-sub">Xử lý báo cáo và giữ cộng đồng an toàn.</p></div>
      <button class="btn btn-ghost" id="mod-refresh">${icon('refresh', 16)} Làm mới</button></div>
    <div id="mod-overview" class="stat-grid mb">${spinner()}</div>
    <div class="tabs mb" id="mod-tabs"><button class="tab active" data-tab="reports">Báo cáo</button><button class="tab" data-tab="actions">Lịch sử xử lý</button></div>
    <div class="row mb" id="mod-filters">
      <select class="select" id="mod-status" style="width:auto"><option value="">Tất cả trạng thái</option><option value="open">Mở</option><option value="reviewing">Đang xem</option><option value="resolved">Đã xử lý</option><option value="rejected">Từ chối</option></select>
      <select class="select" id="mod-type" style="width:auto"><option value="">Tất cả loại</option><option value="post">Bài viết</option><option value="comment">Bình luận</option><option value="user">Người dùng</option><option value="product">Sản phẩm</option><option value="reel">Reel</option><option value="video">Video</option><option value="message">Tin nhắn</option><option value="live">Livestream</option></select>
    </div>
    <div id="mod-body">${spinner()}</div>`;
  const overview = container.querySelector('#mod-overview');
  const body = container.querySelector('#mod-body');
  const filters = container.querySelector('#mod-filters');
  container.querySelector('#mod-refresh').onclick = () => refresh();
  container.querySelector('#mod-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#mod-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    if (tab.dataset.tab === 'actions') { filters.classList.add('hide'); loadActions(); }
    else { filters.classList.remove('hide'); loadReports(); }
  };
  container.querySelector('#mod-status').onchange = () => loadReports();
  container.querySelector('#mod-type').onchange = () => loadReports();

  async function refresh() {
    overview.innerHTML = spinner();
    try {
      const o = await api.get('/api/moderation/overview');
      overview.innerHTML = `
        ${stat('Đang mở', o.open_reports, 'alert')}${stat('Tổng báo cáo', o.total_reports, 'flag')}
        ${stat('Hôm nay', o.reports_today, 'clock')}${stat('Đã xử lý hôm nay', o.actions_today, 'shield')}`;
    } catch (err) { overview.innerHTML = `<div class="card card-pad">${esc(err.message)}</div>`; }
    loadReports();
  }

  function stat(label, value, iconName) {
    return `<div class="card card-pad"><div class="tiny muted row" style="gap:6px">${icon(iconName, 14)} ${label}</div><div class="stat-value">${value}</div></div>`;
  }

  async function loadReports() {
    body.innerHTML = spinner();
    const params = new URLSearchParams();
    const status = container.querySelector('#mod-status').value;
    const type = container.querySelector('#mod-type').value;
    if (status) params.set('status', status);
    if (type) params.set('target_type', type);
    try {
      const d = await api.get(`/api/moderation/reports?limit=50&${params}`);
      body.innerHTML = d.items.length ? `<div class="card list-card">${d.items.map((r) => `<div class="person-row">
        <span class="notif-icon">${icon(r.target_type === 'user' ? 'user' : r.target_type === 'message' ? 'message' : 'flag', 17)}</span>
        <div class="grow"><div class="person-name">${esc(r.reason)} <span class="badge">${esc(r.target_type)}</span> <span class="badge ${r.status === 'open' ? 'badge-primary' : ''}">${esc(r.status)}</span></div>
        <div class="person-meta">bởi @${esc(r.reporter?.username || r.reporter_id)} · ${timeAgo(r.created_at)} · ID ${esc(r.target_id)}</div>
        ${r.details ? `<div class="small muted clamp-2">${esc(r.details)}</div>` : ''}</div>
        <button class="btn btn-sm ${['open', 'reviewing'].includes(r.status) ? 'btn-primary' : 'btn-ghost'}" data-report="${esc(r.id)}">${['open', 'reviewing'].includes(r.status) ? 'Xử lý' : 'Xem'}</button>
      </div>`).join('')}</div>` : empty('Không có báo cáo phù hợp', 'shield');
      body.querySelectorAll('[data-report]').forEach((b) => {
        b.onclick = () => openReport(b.dataset.report);
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function openReport(id) {
    let d;
    try { d = await api.get(`/api/moderation/reports/${id}`); }
    catch (err) { return toast(err.message, 'error'); }
    const r = d.report;
    const pending = ['open', 'reviewing'].includes(r.status);
    const targetText = d.target
      ? esc(d.target.body || d.target.title || d.target.display_name || d.target.caption || d.target.name || d.target.content || JSON.stringify(d.target).slice(0, 300))
      : '(Nội dung không còn tồn tại)';
    const m = modal({
      title: 'Chi tiết báo cáo',
      wide: true,
      content: `
        <div class="row-between mb"><span class="badge">${esc(r.target_type)}</span><span class="badge ${r.status === 'open' ? 'badge-primary' : ''}">${esc(r.status)}</span></div>
        <p><b>Lý do:</b> ${esc(r.reason)}</p>
        ${r.details ? `<p class="small muted">${esc(r.details)}</p>` : ''}
        <div class="card card-pad mt"><div class="tiny muted mb">Nội dung bị báo cáo</div><div class="small">${targetText}</div></div>
        <div class="row-between small mt"><span class="muted">Người báo cáo</span><span>@${esc(r.reporter?.username || r.reporter_id)}</span></div>
        <div class="row-between small mt"><span class="muted">Thời gian</span><span>${fullDate(r.created_at)}</span></div>
        ${r.action && r.action !== 'none' ? `<div class="row-between small mt"><span class="muted">Hành động</span><span>${esc(r.action)}</span></div>` : ''}
        ${pending ? `
          <div class="form-grid mt">
            <div class="field"><label>Trạng thái</label><select class="select" id="rp-status"><option value="reviewing">Đang xem</option><option value="resolved">Đã xử lý</option><option value="rejected">Từ chối</option></select></div>
            <div class="field"><label>Hành động</label><select class="select" id="rp-action">
              <option value="none">Không</option><option value="warn">Cảnh cáo</option><option value="remove">Xóa nội dung</option><option value="suspend_user">Đình chỉ tài khoản</option>
            </select></div>
          </div>
          <div class="field"><label>Ghi chú</label><textarea class="textarea" id="rp-notes" maxlength="2000"></textarea></div>` : ''}`,
      actions: pending ? '<button class="btn btn-ghost" data-cancel>Đóng</button><button class="btn btn-primary" data-decide>Áp dụng</button>' : '<button class="btn btn-ghost" data-cancel>Đóng</button>',
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-decide]')?.addEventListener('click', async () => {
      try {
        await api.patch(`/api/moderation/reports/${r.id}`, {
          status: m.overlay.querySelector('#rp-status').value,
          action: m.overlay.querySelector('#rp-action').value,
          notes: m.overlay.querySelector('#rp-notes').value.trim(),
        });
        m.close(); toast('Đã cập nhật báo cáo', 'success'); refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function loadActions() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/moderation/actions?limit=50');
      body.innerHTML = d.items.length ? `<div class="card list-card">${d.items.map((a) => `<div class="person-row"><span class="notif-icon">${icon('shield', 17)}</span>
        <div class="grow"><div class="small">${esc(a.action)} · ${esc(a.target_type)}</div><div class="person-meta">@${esc(a.moderator?.username || a.moderator_id)} · ${timeAgo(a.created_at)}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></div></div>`).join('')}</div>` : empty('Chưa có lịch sử xử lý', 'shield');
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  refresh();
}
