import { api, isAdmin } from '../api.js';
import {
  icon, esc, money, timeAgo, toast, spinner, empty, modal, formatDateTimeLocal,
} from '../ui.js';

export async function renderMonetization(container) {
  container.innerHTML = `
    <div class="page-head"><div><h1 class="page-title">Kiếm tiền</h1><p class="page-sub">Quảng cáo, thu nhập và chi trả cho người sáng tạo.</p></div></div>
    <div class="tabs mb" id="mon-tabs">
      <button class="tab active" data-tab="overview">Tổng quan</button>
      <button class="tab" data-tab="ads">Quảng cáo</button>
      <button class="tab" data-tab="earnings">Thu nhập</button>
      <button class="tab" data-tab="transactions">Giao dịch</button>
    </div>
    <div id="mon-body">${spinner()}</div>`;
  const body = container.querySelector('#mon-body');
  container.querySelector('#mon-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    container.querySelectorAll('#mon-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    show(tab.dataset.tab);
  };

  function show(tab) {
    if (tab === 'overview') return loadOverview();
    if (tab === 'ads') return loadAds();
    if (tab === 'earnings') return loadEarnings();
    return loadTransactions();
  }

  async function loadOverview() {
    body.innerHTML = spinner();
    try {
      const s = await api.get('/api/monetization/status');
      const earn = await api.get('/api/monetization/earnings?limit=10');
      body.innerHTML = `
        ${!s.payments_configured ? `<div class="card card-pad mb row" style="gap:10px;border-color:rgba(245,158,11,.35)">${icon('alert', 20)}<div class="grow"><b>Chưa cấu hình cổng thanh toán</b><div class="small muted">Quảng cáo và ủng hộ cần STRIPE_SECRET_KEY trên máy chủ. Bạn vẫn có thể tạo chiến dịch ở trạng thái nháp.</div></div></div>` : ''}
        <div class="stat-grid">
          <div class="card card-pad"><div class="tiny muted">Đang chờ</div><div class="stat-value">${money(s.balance.pending_cents, s.balance.currency)}</div></div>
          <div class="card card-pad"><div class="tiny muted">Khả dụng</div><div class="stat-value">${money(s.balance.available_cents, s.balance.currency)}</div></div>
          <div class="card card-pad"><div class="tiny muted">Đã chi trả</div><div class="stat-value">${money(s.balance.paid_cents, s.balance.currency)}</div></div>
          <div class="card card-pad"><div class="tiny muted">Chiến dịch đang chạy</div><div class="stat-value">${s.active_campaigns}</div></div>
        </div>
        <div class="grid-2 mt">
          <div class="card card-pad"><h3 style="margin-top:0">Rút tiền</h3>
            <p class="small muted">Số dư khả dụng: <b>${money(s.balance.available_cents, s.balance.currency)}</b> · Tối thiểu ${money(s.minimum_payout_cents, s.balance.currency)}</p>
            <button class="btn btn-primary" id="request-payout" ${s.balance.available_cents < s.minimum_payout_cents ? 'disabled' : ''}>${icon('wallet', 16)} Yêu cầu chi trả</button>
            ${s.pending_payouts ? `<p class="tiny muted mt">${s.pending_payouts} yêu cầu đang xử lý</p>` : ''}
          </div>
          <div class="card card-pad"><h3 style="margin-top:0">Cách kiếm tiền</h3>
            <ul class="small muted" style="margin:0;padding-left:18px">
              <li>Chạy quảng cáo cho nội dung của bạn.</li>
              <li>Nhận ủng hộ từ người hâm mộ qua hồ sơ.</li>
              <li>Thu nhập từ lượt xem được ghi nhận tự động.</li>
            </ul>
          </div>
        </div>
        <div class="section-head mt"><h2>Thu nhập gần đây</h2></div>
        <div class="card list-card">${earn.items.length ? earn.items.map(earningRow).join('') : '<p class="muted small" style="padding:16px">Chưa có khoản thu nhập nào</p>'}</div>`;
      body.querySelector('#request-payout')?.addEventListener('click', () => openPayout(s.balance, () => loadOverview()));
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  async function loadAds() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/monetization/ads?limit=50');
      body.innerHTML = `
        <div class="row-between mb"><h2 style="margin:0;font-size:18px">Chiến dịch quảng cáo</h2><button class="btn btn-primary" id="new-ad">${icon('plus', 16)} Tạo chiến dịch</button></div>
        ${d.items.length ? `<div class="card list-card">${d.items.map(adRow).join('')}</div>` : empty('Chưa có chiến dịch nào', 'chart')}`;
      body.querySelector('#new-ad').onclick = () => openAdForm(null, () => loadAds());
      body.querySelectorAll('[data-ad]').forEach((el) => {
        el.onclick = (e) => {
          if (e.target.closest('button')) return;
          openAdDetail(d.items.find((a) => a.id === el.dataset.ad), d.payments_configured, () => loadAds());
        };
      });
      body.querySelectorAll('[data-pause]').forEach((b) => {
        b.onclick = async () => {
          try { await api.post(`/api/monetization/ads/${b.dataset.pause}/pause`); toast('Đã tạm dừng', 'success'); loadAds(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
      body.querySelectorAll('[data-activate]').forEach((b) => {
        b.onclick = async () => {
          try { await api.post(`/api/monetization/ads/${b.dataset.activate}/activate`); toast('Đã kích hoạt chiến dịch', 'success'); loadAds(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function adRow(a) {
    const statusText = { draft: 'Nháp', active: 'Đang chạy', paused: 'Tạm dừng', ended: 'Đã kết thúc' }[a.status] || a.status;
    const spend = a.budget_cents ? Math.round((a.spent_cents / a.budget_cents) * 100) : 0;
    return `<div class="person-row" data-ad="${esc(a.id)}" style="cursor:pointer">
      <span class="notif-icon">${icon('chart', 18)}</span>
      <div class="grow"><div class="person-name">${esc(a.name)} <span class="badge ${a.status === 'active' ? 'badge-primary' : ''}">${statusText}</span></div>
        <div class="person-meta">${a.impressions} hiển thị · ${a.clicks} nhấp · ${money(a.spent_cents)} / ${money(a.budget_cents)}</div>
        <div class="progress mt" style="height:5px"><span style="width:${Math.min(100, spend)}%"></span></div></div>
      <div class="row" style="gap:6px">
        ${a.status === 'active' ? `<button class="btn btn-sm btn-ghost" data-pause="${esc(a.id)}">Tạm dừng</button>` : a.status === 'paused' || a.status === 'draft' ? `<button class="btn btn-sm btn-primary" data-activate="${esc(a.id)}">Kích hoạt</button>` : ''}
        ${icon('chevronDown', 16)}
      </div>
    </div>`;
  }

  function openAdDetail(a, payments, refresh) {
    const m = modal({
      title: a.name,
      content: `
        <div class="form-grid">
          <div><div class="tiny muted">Trạng thái</div><div class="strong">${a.status}</div></div>
          <div><div class="tiny muted">Ngân sách</div><div class="strong">${money(a.budget_cents)}</div></div>
          <div><div class="tiny muted">Đã chi</div><div class="strong">${money(a.spent_cents)}</div></div>
          <div><div class="tiny muted">Hiển thị / Nhấp</div><div class="strong">${a.impressions} / ${a.clicks}</div></div>
        </div>
        ${a.creative_text ? `<div class="card card-pad mt"><div class="tiny muted">Nội dung quảng cáo</div><p style="margin:6px 0 0">${esc(a.creative_text)}</p>${a.creative_url ? `<a class="small" href="${esc(a.creative_url)}" target="_blank" rel="noopener">${esc(a.creative_url)}</a>` : ''}</div>` : ''}
        <div class="row mt wrap" style="gap:8px">
          ${a.status === 'active' ? `<button class="btn btn-ghost" id="ad-pause">Tạm dừng</button>` : ''}
          ${a.status === 'paused' || a.status === 'draft' ? `<button class="btn btn-primary" id="ad-activate">Kích hoạt</button>` : ''}
          ${['draft', 'paused'].includes(a.status) ? `<button class="btn btn-ghost" id="ad-edit">Sửa</button>` : ''}
          ${payments ? `<button class="btn btn-ghost" id="ad-checkout">Thanh toán</button>` : ''}
        </div>
        ${!payments ? '<p class="tiny muted mt">Cổng thanh toán chưa cấu hình. Kích hoạt sẽ báo lỗi cho đến khi thanh toán đủ ngân sách hoặc bạn là quản trị viên.</p>' : ''}`,
      wide: true,
    });
    m.overlay.querySelector('#ad-pause')?.addEventListener('click', async () => {
      try { await api.post(`/api/monetization/ads/${a.id}/pause`); toast('Đã tạm dừng', 'success'); m.close(); refresh(); }
      catch (err) { toast(err.message, 'error'); }
    });
    m.overlay.querySelector('#ad-activate')?.addEventListener('click', async () => {
      try { await api.post(`/api/monetization/ads/${a.id}/activate`); toast('Đã kích hoạt', 'success'); m.close(); refresh(); }
      catch (err) { toast(err.message, 'error'); }
    });
    m.overlay.querySelector('#ad-edit')?.addEventListener('click', () => { m.close(); openAdForm(a, refresh); });
    m.overlay.querySelector('#ad-checkout')?.addEventListener('click', async () => {
      try {
        const d = await api.post(`/api/monetization/ads/${a.id}/checkout`);
        if (d.checkout_url) window.location.href = d.checkout_url;
      } catch (err) { toast(err.message, 'error', 5000); }
    });
  }

  function openAdForm(ad, onDone) {
    const m = modal({
      title: ad ? 'Sửa chiến dịch' : 'Tạo chiến dịch quảng cáo',
      wide: true,
      content: `
        <div class="field"><label>Tên chiến dịch</label><input class="input" id="ad-name" maxlength="120" value="${esc(ad?.name || '')}"></div>
        <div class="form-grid">
          <div class="field"><label>Ngân sách (USD)</label><input class="input" type="number" min="1" step="0.01" id="ad-budget" value="${ad ? (ad.budget_cents / 100).toFixed(2) : '10.00'}"></div>
          <div class="field"><label>Bắt đầu</label><input class="input" type="datetime-local" id="ad-start" value="${formatDateTimeLocal(ad?.starts_at)}"></div>
          <div class="field"><label>Kết thúc</label><input class="input" type="datetime-local" id="ad-end" value="${ad?.ends_at ? formatDateTimeLocal(ad.ends_at) : ''}"></div>
        </div>
        <div class="field"><label>Nội dung quảng cáo</label><textarea class="textarea" id="ad-text" maxlength="500" placeholder="Mô tả ngắn gọn…">${esc(ad?.creative_text || '')}</textarea></div>
        <div class="field"><label>Liên kết</label><input class="input" id="ad-url" maxlength="1000" placeholder="https://" value="${esc(ad?.creative_url || '')}"></div>`,
      actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>${ad ? 'Lưu' : 'Tạo'}</button>`,
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-save]').onclick = async () => {
      const name = m.overlay.querySelector('#ad-name').value.trim();
      const budget = Number(m.overlay.querySelector('#ad-budget').value);
      if (name.length < 2) return toast('Tên chiến dịch quá ngắn', 'error');
      if (!(budget >= 1)) return toast('Ngân sách tối thiểu 1 USD', 'error');
      const payload = {
        name, budget_cents: Math.round(budget * 100),
        creative_text: m.overlay.querySelector('#ad-text').value.trim(),
        creative_url: m.overlay.querySelector('#ad-url').value.trim(),
        starts_at: m.overlay.querySelector('#ad-start').value ? new Date(m.overlay.querySelector('#ad-start').value).toISOString() : undefined,
        ends_at: m.overlay.querySelector('#ad-end').value ? new Date(m.overlay.querySelector('#ad-end').value).toISOString() : undefined,
      };
      try {
        if (ad) await api.patch(`/api/monetization/ads/${ad.id}`, payload);
        else await api.post('/api/monetization/ads', payload);
        m.close();
        toast(ad ? 'Đã cập nhật chiến dịch' : 'Đã tạo chiến dịch', 'success');
        onDone();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function loadEarnings() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/monetization/earnings?limit=50');
      body.innerHTML = `
        <div class="stat-grid">
          <div class="card card-pad"><div class="tiny muted">Đang chờ</div><div class="stat-value">${money(d.balance.pending_cents, d.balance.currency)}</div></div>
          <div class="card card-pad"><div class="tiny muted">Khả dụng</div><div class="stat-value">${money(d.balance.available_cents, d.balance.currency)}</div></div>
          <div class="card card-pad"><div class="tiny muted">Đã chi trả</div><div class="stat-value">${money(d.balance.paid_cents, d.balance.currency)}</div></div>
        </div>
        <div class="row-between mt mb"><h2 style="margin:0;font-size:18px">Lịch sử thu nhập</h2><button class="btn btn-primary" id="payout-btn" ${d.balance.available_cents < 500 ? 'disabled' : ''}>${icon('wallet', 16)} Rút tiền</button></div>
        <div class="card list-card">${d.items.length ? d.items.map(earningRow).join('') : '<p class="muted small" style="padding:16px">Chưa có khoản thu nhập nào</p>'}</div>
        <div class="section-head mt"><h2>Yêu cầu chi trả</h2></div>
        <div class="card list-card">${d.payouts.length ? d.payouts.map((p) => `<div class="person-row"><span class="notif-icon">${icon('wallet', 17)}</span>
          <div class="grow"><div class="person-name">${money(p.amount_cents, p.currency)}</div><div class="person-meta">${timeAgo(p.created_at)}</div></div>
          <span class="badge ${p.status === 'paid' ? 'badge-primary' : ''}">${p.status}</span></div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có yêu cầu chi trả</p>'}</div>`;
      body.querySelector('#payout-btn')?.addEventListener('click', () => openPayout(d.balance, () => loadEarnings()));
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function earningRow(e) {
    return `<div class="person-row"><span class="notif-icon">${icon('dollar', 17)}</span>
      <div class="grow"><div class="person-name">${money(e.amount_cents, e.currency)}</div>
      <div class="person-meta">${esc(e.kind || 'Thu nhập')} · ${timeAgo(e.created_at)}</div></div>
      <span class="badge ${e.status === 'paid' ? 'badge-primary' : ''}">${e.status}</span></div>`;
  }

  function openPayout(balance, onDone) {
    const m = modal({
      title: 'Yêu cầu chi trả',
      content: `<p class="small muted">Số dư khả dụng: <b>${money(balance.available_cents, balance.currency)}</b></p>
        <div class="field"><label>Số tiền (USD)</label><input class="input" type="number" min="5" step="0.01" id="payout-amount" value="${(balance.available_cents / 100).toFixed(2)}"></div>`,
      actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-send>Gửi yêu cầu</button>`,
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-send]').onclick = async () => {
      const amount = Math.round(Number(m.overlay.querySelector('#payout-amount').value) * 100);
      if (!(amount >= 500)) return toast('Số tiền tối thiểu là 5 USD', 'error');
      try {
        await api.post('/api/monetization/earnings/request-payout', { amount_cents: amount });
        m.close();
        toast('Đã gửi yêu cầu chi trả', 'success');
        onDone();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function loadTransactions() {
    body.innerHTML = spinner();
    try {
      const d = await api.get('/api/monetization/transactions?limit=50');
      const payouts = await api.get('/api/monetization/payouts');
      body.innerHTML = `
        <div class="section-head"><h2>Giao dịch</h2></div>
        <div class="card list-card mb">${d.items.length ? d.items.map((t) => `<div class="person-row"><span class="notif-icon">${icon('dollar', 17)}</span>
          <div class="grow"><div class="person-name">${money(t.amount_cents, t.currency)} <span class="badge">${esc(t.kind)}</span></div>
          <div class="person-meta">${esc(t.provider || 'internal')} · ${timeAgo(t.created_at)}${t.username ? ` · ${esc(t.username)}` : ''}</div></div>
          <span class="badge ${t.status === 'completed' ? 'badge-primary' : ''}">${esc(t.status)}</span></div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có giao dịch</p>'}</div>
        <div class="section-head"><h2>Chi trả</h2></div>
        <div class="card list-card">${payouts.items.length ? payouts.items.map((p) => `<div class="person-row"><span class="notif-icon">${icon('wallet', 17)}</span>
          <div class="grow"><div class="person-name">${money(p.amount_cents, p.currency)} ${p.username ? `<span class="tiny muted">@${esc(p.username)}</span>` : ''}</div>
          <div class="person-meta">${timeAgo(p.created_at)}${p.processed_at ? ` · xử lý ${timeAgo(p.processed_at)}` : ''}</div></div>
          <span class="badge">${esc(p.status)}</span>
          ${isAdmin() && ['requested', 'processing'].includes(p.status) ? `<div class="row" style="gap:4px"><button class="btn btn-sm btn-ghost" data-payout="${esc(p.id)}" data-status="paid">Duyệt</button><button class="btn btn-sm btn-ghost" data-payout="${esc(p.id)}" data-status="rejected">Từ chối</button></div>` : ''}</div>`).join('') : '<p class="muted small" style="padding:16px">Chưa có yêu cầu chi trả</p>'}</div>`;
      body.querySelectorAll('[data-payout]').forEach((b) => {
        b.onclick = async () => {
          try { await api.patch(`/api/monetization/payouts/${b.dataset.payout}`, { status: b.dataset.status }); toast('Đã cập nhật', 'success'); loadTransactions(); }
          catch (err) { toast(err.message, 'error'); }
        };
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  loadOverview();
}
