import { api, auth } from '../api.js';
import {
  icon, esc, avatar, timeAgo, money, toast, spinner, empty, modal, confirmDialog, navigate,
} from '../ui.js';
import { openReport } from '../components.js';

const CATS = [
  ['general', 'Chung'], ['electronics', 'Điện tử'], ['fashion', 'Thời trang'], ['home', 'Nhà cửa'],
  ['vehicles', 'Xe cộ'], ['books', 'Sách'], ['sports', 'Thể thao'], ['toys', 'Đồ chơi'], ['services', 'Dịch vụ'],
];
const CONDITIONS = [['new', 'Mới'], ['like_new', 'Như mới'], ['used', 'Đã qua sử dụng'], ['refurbished', 'Đã tân trang']];
const catName = (v) => CATS.find(([k]) => k === v)?.[1] || v;
const conditionName = (v) => CONDITIONS.find(([k]) => k === v)?.[1] || v;
const image = (p) => p.media?.[0]?.url || p.image_url;

export async function renderMarketplace(container, query = {}) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Chợ</h1><p class="page-sub">Mua bán đồ cũ và mới trong cộng đồng.</p></div>
      <button class="btn btn-primary" id="new-product">${icon('plus', 17)} Đăng bán</button>
    </div>
    <form class="search-bar mb" id="mk-search">${icon('search', 20)}<input type="search" placeholder="Tìm sản phẩm…" value="${esc(query.q || '')}"><button class="btn btn-primary" type="submit">Tìm</button></form>
    <div class="row mb wrap" id="mk-filters">
      <select class="select" id="mk-category" style="width:auto"><option value="">Tất cả danh mục</option>${CATS.map(([v, l]) => `<option value="${v}" ${query.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="select" id="mk-sort" style="width:auto"><option value="">Mới nhất</option><option value="price_asc">Giá thấp → cao</option><option value="price_desc">Giá cao → thấp</option></select>
      <select class="select" id="mk-status" style="width:auto"><option value="active">Đang bán</option><option value="sold">Đã bán</option><option value="all">Tất cả</option></select>
      <span class="grow"></span>
      <span class="tiny muted" id="mk-count"></span>
    </div>
    <div id="mk-body">${spinner()}</div>`;
  let category = query.category || '';
  let sort = '';
  let status = 'active';
  let q = query.q || '';
  const body = container.querySelector('#mk-body');

  container.querySelector('#new-product').onclick = () => openProductForm(null, () => load());
  container.querySelector('#mk-search').onsubmit = (e) => { e.preventDefault(); q = e.target.querySelector('input').value.trim(); load(); };
  container.querySelector('#mk-category').onchange = (e) => { category = e.target.value; load(); };
  container.querySelector('#mk-sort').onchange = (e) => { sort = e.target.value; load(); };
  container.querySelector('#mk-status').onchange = (e) => { status = e.target.value; load(); };

  async function load() {
    body.innerHTML = spinner();
    try {
      const params = new URLSearchParams({ limit: '40', status });
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (sort) params.set('sort', sort);
      const d = await api.get(`/api/marketplace/products?${params}`);
      container.querySelector('#mk-count').textContent = `${d.total} sản phẩm`;
      if (!d.items.length) { body.innerHTML = empty('Không có sản phẩm nào', 'shopping'); return; }
      body.innerHTML = `<div class="product-grid">${d.items.map(productCard).join('')}</div>`;
      body.querySelectorAll('.js-product').forEach((el) => {
        el.onclick = () => openProduct(el.dataset.id, () => load());
      });
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function productCard(p) {
    return `<div class="card card-hover product-card js-product" data-id="${esc(p.id)}">
      <div class="product-thumb">${image(p) ? `<img src="${esc(image(p))}" alt="${esc(p.title)}" loading="lazy">` : `<span class="muted">${icon('shopping', 28)}</span>`}
        ${p.status !== 'active' ? `<span class="badge" style="position:absolute;top:8px;left:8px">${p.status === 'sold' ? 'Đã bán' : p.status}</span>` : ''}
      </div>
      <div class="product-meta">
        <div class="strong clamp-2">${esc(p.title)}</div>
        <div class="price">${money(p.price_cents, p.currency)}</div>
        <div class="row-between tiny muted mt"><span>${esc(p.location || catName(p.category))}</span><span>${timeAgo(p.created_at)}</span></div>
      </div>
    </div>`;
  }

  async function openProduct(id, refresh) {
    const m = modal({ title: 'Sản phẩm', wide: true, content: spinner() });
    try {
      const { product: p } = await api.get(`/api/marketplace/products/${id}`);
      const first = image(p);
      const mine = p.seller_id === auth.user.id;
      m.setTitle?.(p.title);
      m.overlay.querySelector('.modal-title').textContent = p.title;
      m.overlay.querySelector('.modal-body').innerHTML = `
        <div class="product-detail">
          <div class="product-gallery">
            <div class="product-hero">${first ? `<img id="gallery-main" src="${esc(first)}" alt="${esc(p.title)}">` : icon('shopping', 40)}</div>
            ${p.media?.length > 1 ? `<div class="gallery-thumbs">${p.media.map((im, i) => `<button data-img="${esc(im.url)}" class="${i === 0 ? 'active' : ''}"><img src="${esc(im.url)}" alt=""></button>`).join('')}</div>` : ''}
          </div>
          <div>
            <div class="price lg">${money(p.price_cents, p.currency)}</div>
            <div class="row small muted mt"><span>${esc(catName(p.category))}</span><span>·</span><span>${esc(conditionName(p.condition))}</span>${p.location ? `<span>·</span><span>${icon('pin', 12)} ${esc(p.location)}</span>` : ''}</div>
            <p class="mt" style="white-space:pre-wrap">${esc(p.description || 'Người bán chưa thêm mô tả.')}</p>
            <div class="row-between mt"><a class="row" href="#/profile/${esc(p.seller.username)}" style="gap:8px">${avatar(p.seller, 38)}<div><div class="strong small">${esc(p.seller.display_name)}</div><div class="tiny muted">@${esc(p.seller.username)}</div></div></a>
              ${p.status !== 'active' ? `<span class="badge">${p.status === 'sold' ? 'Đã bán' : p.status}</span>` : ''}</div>
            <div class="row wrap mt" style="gap:8px">
              ${!mine ? `<button class="btn btn-primary" id="p-message">${icon('message', 16)} Nhắn người bán</button>
                <button class="btn btn-ghost" id="p-save">${icon('bookmark', 16)} ${p.bookmarked ? 'Đã lưu' : 'Lưu'}</button>
                <button class="btn btn-ghost" id="p-report">${icon('flag', 16)} Báo cáo</button>` : ''}
              ${mine ? `<button class="btn btn-primary" id="p-edit">${icon('edit', 16)} Sửa</button>
                ${p.status === 'active' ? `<button class="btn btn-ghost" id="p-sold">${icon('check', 16)} Đã bán</button>` : ''}
                <button class="btn btn-ghost" id="p-delete" style="color:var(--danger)">${icon('trash', 16)} Xóa</button>` : ''}
            </div>
          </div>
        </div>`;
      m.overlay.querySelectorAll('[data-img]').forEach((b) => {
        b.onclick = () => {
          m.overlay.querySelector('#gallery-main').src = b.dataset.img;
          m.overlay.querySelectorAll('[data-img]').forEach((x) => x.classList.toggle('active', x === b));
        };
      });
      const msg = m.overlay.querySelector('#p-message');
      if (msg) msg.onclick = async () => {
        try {
          const d = await api.post('/api/conversations', { kind: 'dm', user_id: p.seller_id });
          m.close();
          navigate(`/messages/${d.conversation.id}`);
        } catch (err) { toast(err.message, 'error'); }
      };
      const save = m.overlay.querySelector('#p-save');
      if (save) save.onclick = async () => {
        try {
          if (p.bookmarked) { await api.del(`/api/bookmarks/product/${p.id}`); p.bookmarked = false; }
          else { await api.post('/api/bookmarks', { target_type: 'product', target_id: p.id }); p.bookmarked = true; }
          save.innerHTML = `${icon('bookmark', 16)} ${p.bookmarked ? 'Đã lưu' : 'Lưu'}`;
          save.classList.toggle('btn-soft', p.bookmarked);
        } catch (err) { toast(err.message, 'error'); }
      };
      const report = m.overlay.querySelector('#p-report');
      if (report) report.onclick = () => openReport('product', p.id);
      const edit = m.overlay.querySelector('#p-edit');
      if (edit) edit.onclick = () => { m.close(); openProductForm(p, refresh); };
      const sold = m.overlay.querySelector('#p-sold');
      if (sold) sold.onclick = async () => {
        if (!await confirmDialog('Đánh dấu sản phẩm đã bán?', { confirmText: 'Đã bán' })) return;
        try { await api.post(`/api/marketplace/products/${p.id}/sold`); toast('Đã đánh dấu đã bán', 'success'); m.close(); refresh(); }
        catch (err) { toast(err.message, 'error'); }
      };
      const del = m.overlay.querySelector('#p-delete');
      if (del) del.onclick = async () => {
        if (!await confirmDialog('Xóa sản phẩm này?', { danger: true, confirmText: 'Xóa' })) return;
        try { await api.del(`/api/marketplace/products/${p.id}`); toast('Đã xóa sản phẩm', 'success'); m.close(); refresh(); }
        catch (err) { toast(err.message, 'error'); }
      };
    } catch (err) {
      m.overlay.querySelector('.modal-body').innerHTML = empty(err.message, 'alert');
    }
  }

  function openProductForm(product, onDone) {
    const m = modal({
      title: product ? 'Sửa sản phẩm' : 'Đăng bán sản phẩm',
      wide: true,
      content: `
        <div class="form-grid">
          <div class="field"><label>Tên sản phẩm</label><input class="input" id="pr-title" maxlength="200" value="${esc(product?.title || '')}"></div>
          <div class="field"><label>Giá</label><input class="input" id="pr-price" type="number" min="0" step="0.01" value="${product ? (product.price_cents / 100).toFixed(2) : ''}" placeholder="0.00"></div>
          <div class="field"><label>Tiền tệ</label><select class="select" id="pr-currency"><option value="USD" ${product?.currency === 'USD' ? 'selected' : ''}>USD</option><option value="VND" ${product?.currency === 'VND' ? 'selected' : ''}>VND</option><option value="EUR" ${product?.currency === 'EUR' ? 'selected' : ''}>EUR</option></select></div>
          <div class="field"><label>Danh mục</label><select class="select" id="pr-category">${CATS.map(([v, l]) => `<option value="${v}" ${product?.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Tình trạng</label><select class="select" id="pr-condition">${CONDITIONS.map(([v, l]) => `<option value="${v}" ${product?.condition === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Địa điểm</label><input class="input" id="pr-location" maxlength="200" value="${esc(product?.location || '')}"></div>
        </div>
        <div class="field"><label>Mô tả</label><textarea class="textarea" id="pr-desc" maxlength="10000">${esc(product?.description || '')}</textarea></div>
        <div class="field"><label>Ảnh sản phẩm (tối đa 10)</label><input type="file" accept="image/*" multiple id="pr-files" class="input">
          <div id="pr-previews" class="media-grid n4 mt">${(product?.media || []).map((im) => `<div class="media-tile"><img src="${esc(im.url)}" alt=""></div>`).join('')}</div>
        </div>`,
      actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>${product ? 'Lưu' : 'Đăng bán'}</button>`,
    });
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    let media = (product?.media || []).map((im) => im.url);
    m.overlay.querySelector('#pr-files').onchange = async (e) => {
      const files = [...e.target.files].slice(0, Math.max(0, 10 - media.length));
      const box = m.overlay.querySelector('#pr-previews');
      for (const file of files) {
        const tile = document.createElement('div');
        tile.className = 'media-tile';
        tile.innerHTML = '<span class="muted small">Đang tải…</span>';
        box.appendChild(tile);
        try {
          const d = await api.upload(file);
          media.push(d.url);
          tile.innerHTML = `<img src="${esc(d.url)}" alt="">`;
        } catch (err) { tile.remove(); toast(err.message, 'error'); }
      }
      e.target.value = '';
    };
    m.overlay.querySelector('[data-save]').onclick = async () => {
      const title = m.overlay.querySelector('#pr-title').value.trim();
      const price = Number(m.overlay.querySelector('#pr-price').value);
      if (title.length < 2) return toast('Tên sản phẩm quá ngắn', 'error');
      if (!Number.isFinite(price) || price < 0) return toast('Giá không hợp lệ', 'error');
      const btn = m.overlay.querySelector('[data-save]');
      btn.disabled = true;
      try {
        const payload = {
          title, price_cents: Math.round(price * 100),
          currency: m.overlay.querySelector('#pr-currency').value,
          category: m.overlay.querySelector('#pr-category').value,
          condition: m.overlay.querySelector('#pr-condition').value,
          location: m.overlay.querySelector('#pr-location').value.trim(),
          description: m.overlay.querySelector('#pr-desc').value.trim(),
          media,
        };
        if (product) await api.patch(`/api/marketplace/products/${product.id}`, payload);
        else await api.post('/api/marketplace/products', payload);
        m.close();
        toast(product ? 'Đã cập nhật sản phẩm' : 'Đã đăng bán', 'success');
        onDone();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  }

  load();
  if (query.product) openProduct(query.product, () => load());
}
