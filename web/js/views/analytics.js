import { api, auth } from '../api.js';
import { icon, esc, money, compact, spinner, empty, timeAgo, navigate } from '../ui.js';

export async function renderAnalytics(container) {
  container.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Thống kê</h1><p class="page-sub">Hiệu suất nội dung và tăng trưởng của bạn.</p></div>
      <div class="row">
        <select class="select" id="an-days" style="width:auto">
          <option value="7">7 ngày</option><option value="30" selected>30 ngày</option><option value="90">90 ngày</option><option value="365">1 năm</option>
        </select>
        <button class="btn btn-ghost" id="an-refresh">${icon('refresh', 16)}</button>
      </div>
    </div>
    <div id="an-body">${spinner()}</div>`;
  const body = container.querySelector('#an-body');
  const daysEl = container.querySelector('#an-days');
  daysEl.onchange = () => load();
  container.querySelector('#an-refresh').onclick = () => load();

  async function load() {
    body.innerHTML = spinner();
    try {
      const d = await api.get(`/api/analytics/me?days=${daysEl.value}`);
      const maxDaily = Math.max(1, ...d.daily_activity.map((x) => x.c));
      body.innerHTML = `
        <div class="stat-grid">
          ${stat('Người theo dõi', compact(d.followers), 'users', '#/friends')}
          ${stat('Đang theo dõi', compact(d.following), 'userPlus', '#/friends')}
          ${stat('Bạn bè', compact(d.friends), 'users', '#/friends')}
          ${stat('Bài viết', compact(d.posts), 'file', `#/profile/${esc(auth.user.username)}`)}
          ${stat('Cảm xúc nhận được', compact(d.reactions_received), 'heart')}
          ${stat('Bình luận', compact(d.comments_received), 'comment')}
          ${stat('Lượt xem bài viết', compact(d.post_views), 'eye')}
          ${stat('Lượt xem reel', compact(d.reels_views), 'play', '#/reels')}
          ${stat('Lượt xem video', compact(d.video_views), 'video', '#/videos')}
          ${stat('Thu nhập', money(d.earnings), 'wallet', '#/monetization')}
        </div>
        <div class="card card-pad mt">
          <div class="row-between"><h2 style="margin:0;font-size:17px">Hoạt động theo ngày</h2><span class="tiny muted">${d.days} ngày gần nhất</span></div>
          <div class="chart-bars tall mt">
            ${d.daily_activity.length ? d.daily_activity.map((x) => `<div class="chart-bar" style="height:${Math.max(4, Math.round((x.c / maxDaily) * 150))}px" title="${esc(x.day)}: ${x.c}"><span>${esc(x.day.slice(5))}</span></div>`).join('') : '<p class="muted small center" style="width:100%">Chưa có hoạt động trong khoảng thời gian này</p>'}
          </div>
        </div>
        <div class="section-head mt"><h2>Bài viết nổi bật</h2></div>
        <div class="card list-card">
          ${d.top_posts.length ? d.top_posts.map((p) => `<a class="person-row" href="#/post/${esc(p.id)}" style="text-decoration:none;color:inherit">
            <span class="notif-icon">${icon('file', 17)}</span>
            <div class="grow"><div class="small clamp-2">${esc(p.body || '(Không có nội dung)')}</div>
              <div class="person-meta">${timeAgo(p.created_at)} · ${p.reactions} cảm xúc · ${p.comments} bình luận</div></div>
            <span class="badge">${p.reactions + p.comments}</span></a>`).join('') : '<p class="muted small" style="padding:16px">Chưa có bài viết nào</p>'}
        </div>
        <div class="grid-2 mt">
          <div class="card card-pad"><h3 style="margin-top:0">Tăng trưởng</h3>
            <p class="muted small">Theo dõi thêm nhiều người và tương tác đều đặn để tăng lượt tiếp cận. Reels và video thường có lượt xem cao hơn bài viết văn bản.</p>
            <div class="row mt"><button class="btn btn-primary btn-sm" id="go-reels">${icon('video', 15)} Tạo reel</button><button class="btn btn-ghost btn-sm" id="go-monetization">${icon('wallet', 15)} Kiếm tiền</button></div></div>
          <div class="card card-pad"><h3 style="margin-top:0">Mẹo</h3>
            <ul class="small muted" style="margin:0;padding-left:18px">
              <li>Đăng vào khung giờ bạn bè thường hoạt động.</li>
              <li>Thêm ảnh hoặc video để tăng tương tác.</li>
              <li>Trả lời bình luận để giữ hội thoại sôi nổi.</li>
            </ul></div>
        </div>`;
      body.querySelector('#go-reels')?.addEventListener('click', () => navigate('/reels'));
      body.querySelector('#go-monetization')?.addEventListener('click', () => navigate('/monetization'));
    } catch (err) { body.innerHTML = empty(err.message, 'alert'); }
  }

  function stat(label, value, iconName, href) {
    const inner = `<div class="tiny muted row" style="gap:6px">${icon(iconName, 14)} ${label}</div><div class="stat-value">${value}</div>`;
    return href ? `<a class="card card-hover card-pad" href="${href}">${inner}</a>` : `<div class="card card-pad">${inner}</div>`;
  }

  load();
}
