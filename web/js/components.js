import { api, auth } from './api.js';
import {
  icon, esc, avatar, timeAgo, modal, confirmDialog, toast, mediaBlock, empty, spinner, navigate,
} from './ui.js';

export const REACTIONS = {
  like: { emoji: '👍', label: 'Thích' },
  love: { emoji: '❤️', label: 'Yêu thích' },
  care: { emoji: '🤗', label: 'Thương thương' },
  haha: { emoji: '😂', label: 'Haha' },
  wow: { emoji: '😮', label: 'Wow' },
  sad: { emoji: '😢', label: 'Buồn' },
  angry: { emoji: '😡', label: 'Phẫn nộ' },
};

export function linkify(text) {
  return esc(text)
    .replace(/(^|[\s(])#([\p{L}\p{N}_]{2,40})/gu, (_, pre, tag) => `${pre}<a class="hashtag" href="#/search?q=${encodeURIComponent(`#${tag}`)}">#${tag}</a>`)
    .replace(/(^|[\s(])@([a-z0-9._]{3,32})/gi, (_, pre, name) => `${pre}<a class="mention" href="#/profile/${encodeURIComponent(name.toLowerCase())}">@${name}</a>`)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function mediaGrid(media) {
  if (!media?.length) return '';
  const cls = media.length === 2 ? 'n2' : media.length >= 3 ? 'n4' : 'n1';
  return `<div class="post-media media-grid ${cls}">${media.map((m) => mediaBlock(m, { controls: m.kind === 'video' })).join('')}</div>`;
}

export function postCard(post) {
  const isMine = auth.user && post.author?.id === auth.user.id;
  const mineReaction = post.reactions?.mine;
  const reactionTotal = post.reactions?.total || 0;
  const context = post.group
    ? `<a class="link" href="#/groups/${esc(post.group.slug || post.group.id)}">${esc(post.group.name)}</a>`
    : post.page
      ? `<a class="link" href="#/pages/${esc(post.page.slug || post.page.id)}">${esc(post.page.name)}</a>`
      : null;
  return `
  <article class="card post fade-up" data-post-id="${esc(post.id)}" data-author-id="${esc(post.author?.id || '')}">
    <div class="post-head">
      <a href="#/profile/${esc(post.author?.username || '')}">${avatar(post.author, 44)}</a>
      <div class="grow">
        <a class="post-author" href="#/profile/${esc(post.author?.username || '')}">${esc(post.author?.display_name || post.author?.username || 'Người dùng')}</a>
        <div class="post-meta">
          <span>${timeAgo(post.created_at)}</span>
          ${context ? `<span>· trong ${context}</span>` : ''}
          <span>· ${post.visibility === 'private' ? icon('lock', 12) : post.visibility === 'friends' ? icon('users', 12) : icon('globe', 12)}</span>
        </div>
      </div>
      <button class="icon-btn js-post-menu" aria-label="Tùy chọn">${icon('more', 20)}</button>
    </div>
    ${post.body ? `<div class="post-body">${linkify(post.body)}</div>` : ''}
    ${post.shared_post ? `
      <div style="margin:0 17px 14px;border:1px solid var(--border);border-radius:14px;overflow:hidden">
        <div class="post-head" style="padding:11px 13px 7px">
          <a href="#/profile/${esc(post.shared_post.author?.username || '')}">${avatar(post.shared_post.author, 34)}</a>
          <div class="grow"><div class="post-author">${esc(post.shared_post.author?.display_name || '')}</div><div class="post-meta">${timeAgo(post.shared_post.created_at)}</div></div>
        </div>
        ${post.shared_post.body ? `<div class="post-body" style="padding:4px 13px 10px">${linkify(post.shared_post.body)}</div>` : ''}
        ${mediaGrid(post.shared_post.media)}
      </div>` : ''}
    ${mediaGrid(post.media)}
    <div class="post-stats">
      <span class="reaction-sum">${reactionTotal ? `${Object.keys(post.reactions.counts || {}).map((k) => REACTIONS[k]?.emoji || '👍').slice(0, 3).join('')} <b class="js-reaction-count">${reactionTotal}</b>` : `<b class="js-reaction-count">0</b> cảm xúc`}</span>
      <span class="js-comment-count">${post.comments_count || 0} bình luận</span>
      <span>${post.shares_count || 0} chia sẻ</span>
    </div>
    <div class="post-actions">
      <button class="post-action js-react ${mineReaction ? 'liked' : ''}" data-kind="${esc(mineReaction || 'like')}" title="Bày tỏ cảm xúc">
        ${icon('heart', 18)}<span>${mineReaction ? REACTIONS[mineReaction]?.label : 'Thích'}</span>
      </button>
      <button class="post-action js-comment-toggle">${icon('comment', 18)}<span>Bình luận</span></button>
      <button class="post-action js-share">${icon('share', 18)}<span>Chia sẻ</span></button>
      <button class="post-action js-bookmark ${post.bookmarked ? 'liked' : ''}" title="Lưu bài viết">${icon('bookmark', 18)}<span>${post.bookmarked ? 'Đã lưu' : 'Lưu'}</span></button>
    </div>
    <section class="comments hide" data-loaded="0">
      <div class="comment-list"></div>
      <form class="comment-form js-comment-form">
        ${avatar(auth.user, 30)}
        <input class="input" name="body" placeholder="Viết bình luận…" maxlength="5000" autocomplete="off">
        <button class="icon-btn" type="submit" aria-label="Gửi">${icon('send', 18)}</button>
      </form>
    </section>
  </article>`;
}

export function commentHtml(comment, { depth = 0 } = {}) {
  const mine = auth.user && comment.author?.id === auth.user.id;
  const staff = auth.user && ['admin', 'moderator'].includes(auth.user.role);
  const liked = !!comment.reactions?.mine;
  return `
  <div class="comment" data-comment-id="${esc(comment.id)}">
    ${avatar(comment.author, 30)}
    <div class="grow">
      <div class="comment-bubble">
        <a class="author" href="#/profile/${esc(comment.author?.username || '')}">${esc(comment.author?.display_name || '')}</a>
        <span>${linkify(comment.body)}</span>
      </div>
      <div class="row small" style="gap:12px;padding:3px 6px 0">
        <span class="faint">${timeAgo(comment.created_at)}</span>
        <button class="link js-comment-like" style="border:0;background:none;color:${liked ? 'var(--danger)' : 'var(--muted)'}">${liked ? REACTIONS[comment.reactions.mine]?.emoji : 'Thích'} ${comment.reactions?.total || ''}</button>
        <button class="link js-comment-reply" style="border:0;background:none">Trả lời</button>
        ${comment.replies_count ? `<button class="link js-comment-replies" style="border:0;background:none">${comment.replies_count} phản hồi</button>` : ''}
        ${mine || staff ? `<button class="link js-comment-delete" style="border:0;background:none;color:var(--faint)">Xóa</button>` : ''}
      </div>
      <div class="comment-replies" data-parent="${esc(comment.id)}"></div>
      <div class="reply-box hide" data-parent="${esc(comment.id)}"></div>
    </div>
  </div>`;
}

async function loadComments(post, container) {
  const list = container.querySelector('.comment-list');
  list.innerHTML = spinner('Đang tải bình luận…');
  const data = await api.get(`/api/posts/${post.id}/comments?limit=40`);
  list.innerHTML = data.items.length ? data.items.map((c) => commentHtml(c)).join('') : `<p class="muted small">Chưa có bình luận. Hãy là người đầu tiên.</p>`;
  container.dataset.loaded = '1';
}

function reactionPicker(anchor, post, card) {
  document.querySelectorAll('.reaction-pop').forEach((el) => el.remove());
  const pop = document.createElement('div');
  pop.className = 'reaction-pop';
  pop.style.position = 'fixed';
  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`;
  pop.style.top = `${rect.top - 52}px`;
  pop.innerHTML = Object.entries(REACTIONS).map(([kind, r]) => `<button data-kind="${kind}" title="${r.label}">${r.emoji}</button>`).join('');
  document.body.appendChild(pop);
  pop.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    pop.remove();
    await react(post, card, btn.dataset.kind);
  });
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } };
    document.addEventListener('click', off);
  }, 0);
}

async function react(post, card, kind) {
  try {
    const data = await api.post(`/api/posts/${post.id}/react`, { kind });
    const btn = card.querySelector('.js-react');
    const countEl = card.querySelector('.js-reaction-count');
    let total = post.reactions?.total || 0;
    if (data.reaction === null) {
      total = Math.max(0, total - 1);
      btn.classList.remove('liked');
      btn.querySelector('span').textContent = 'Thích';
      btn.dataset.kind = 'like';
      post.reactions.mine = null;
    } else {
      if (!post.reactions.mine) total += 1;
      post.reactions.mine = data.reaction;
      btn.classList.add('liked');
      btn.querySelector('span').textContent = REACTIONS[data.reaction]?.label || 'Thích';
      btn.dataset.kind = data.reaction;
    }
    post.reactions.total = total;
    countEl.textContent = total;
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function bindPostInteractions(root, { onChanged, onDeleted } = {}) {
  root.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.js-react');
    if (!btn) return;
    const card = btn.closest('.post');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => reactionPicker(btn, card._post, card), 420);
  });
  root.addEventListener('mouseout', (e) => {
    const btn = e.target.closest('.js-react');
    if (btn) clearTimeout(btn._t);
  });
  root.addEventListener('click', async (e) => {
    const card = e.target.closest('.post');
    if (!card) return;
    if (!card._post) {
      card._post = root._postIndex?.get(card.dataset.postId);
      if (!card._post) return;
    }
    const post = card._post;

    const reactBtn = e.target.closest('.js-react');
    if (reactBtn) {
      if (!auth.user) return navigate('/auth');
      const current = post.reactions?.mine;
      const kind = current ? current : 'like';
      await react(post, card, current ? current : kind);
      if (onChanged) onChanged(post, 'react');
      return;
    }

    const commentToggle = e.target.closest('.js-comment-toggle');
    if (commentToggle) {
      const section = card.querySelector('.comments');
      section.classList.toggle('hide');
      if (!section.classList.contains('hide') && section.dataset.loaded !== '1') {
        try { await loadComments(post, section); } catch (err) { toast(err.message, 'error'); }
      }
      return;
    }

    const bookmark = e.target.closest('.js-bookmark');
    if (bookmark) {
      if (!auth.user) return navigate('/auth');
      try {
        if (post.bookmarked) {
          await api.del(`/api/bookmarks/post/${post.id}`);
          post.bookmarked = false;
          bookmark.classList.remove('liked');
          bookmark.querySelector('span').textContent = 'Lưu';
        } else {
          await api.post('/api/bookmarks', { target_type: 'post', target_id: post.id });
          post.bookmarked = true;
          bookmark.classList.add('liked');
          bookmark.querySelector('span').textContent = 'Đã lưu';
        }
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (e.target.closest('.js-share')) {
      if (!auth.user) return navigate('/auth');
      shareModal(post, onChanged);
      return;
    }

    if (e.target.closest('.js-post-menu')) {
      postMenu(post, card, { onChanged, onDeleted });
      return;
    }

    const commentForm = e.target.closest('.js-comment-form');
    if (commentForm) {
      e.preventDefault();
      if (!auth.user) return navigate('/auth');
      const input = commentForm.querySelector('input[name=body]');
      const body = input.value.trim();
      if (!body) return;
      input.disabled = true;
      try {
        const data = await api.post(`/api/posts/${post.id}/comments`, { body, parent_id: commentForm.dataset.parentId || undefined });
        input.value = '';
        if (commentForm.dataset.parentId) {
          const box = card.querySelector(`.reply-box[data-parent="${commentForm.dataset.parentId}"]`);
          if (box) { box.innerHTML = ''; box.classList.add('hide'); }
          const replies = card.querySelector(`.comment-replies[data-parent="${commentForm.dataset.parentId}"]`);
          if (replies) replies.insertAdjacentHTML('beforeend', commentHtml(data.comment, { depth: 1 }));
        } else {
          const list = commentForm.closest('.comments').querySelector('.comment-list');
          const placeholder = list.querySelector('p.muted');
          if (placeholder) placeholder.remove();
          list.insertAdjacentHTML('beforeend', commentHtml(data.comment));
        }
        post.comments_count = (post.comments_count || 0) + 1;
        card.querySelector('.js-comment-count').textContent = `${post.comments_count} bình luận`;
        if (onChanged) onChanged(post, 'comment');
      } catch (err) { toast(err.message, 'error'); }
      finally { input.disabled = false; input.focus(); }
      return;
    }

    const likeComment = e.target.closest('.js-comment-like');
    if (likeComment) {
      if (!auth.user) return navigate('/auth');
      const cEl = likeComment.closest('[data-comment-id]');
      try {
        const data = await api.post('/api/reactions', { target_type: 'comment', target_id: cEl.dataset.commentId, kind: 'like' });
        likeComment.style.color = data.reaction ? 'var(--danger)' : 'var(--muted)';
        const current = Number((likeComment.textContent.match(/\d+/) || [0])[0]);
        const next = Math.max(0, current + (data.reaction ? 1 : -1));
        likeComment.textContent = `${data.reaction ? REACTIONS[data.reaction]?.emoji : 'Thích'}${next ? ` ${next}` : ''}`;
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    const replyBtn = e.target.closest('.js-comment-reply');
    if (replyBtn) {
      if (!auth.user) return navigate('/auth');
      const id = replyBtn.closest('[data-comment-id]').dataset.commentId;
      const box = card.querySelector(`.reply-box[data-parent="${id}"]`);
      if (!box) return;
      box.classList.toggle('hide');
      if (!box.dataset.ready) {
        box.dataset.ready = '1';
        box.innerHTML = `<form class="comment-form js-comment-form" data-parent-id="${esc(id)}" style="margin:8px 0">${avatar(auth.user, 26)}<input class="input" name="body" placeholder="Trả lời…" maxlength="5000"><button class="icon-btn" type="submit">${icon('send', 16)}</button></form>`;
        box.querySelector('input').focus();
      }
      return;
    }

    const repliesBtn = e.target.closest('.js-comment-replies');
    if (repliesBtn) {
      const id = repliesBtn.closest('[data-comment-id]').dataset.commentId;
      const box = card.querySelector(`.comment-replies[data-parent="${id}"]`);
      if (!box) return;
      if (box.dataset.loaded) { box.classList.toggle('hide'); return; }
      box.innerHTML = spinner('Đang tải…');
      try {
        const data = await api.get(`/api/posts/${post.id}/comments?parent_id=${id}&limit=50`);
        box.innerHTML = data.items.map((c) => commentHtml(c, { depth: 1 })).join('') || `<p class="muted small">Không có phản hồi</p>`;
        box.dataset.loaded = '1';
        box.style.paddingLeft = '38px';
      } catch (err) { box.innerHTML = `<p class="error-text">${esc(err.message)}</p>`; }
      return;
    }

    const delComment = e.target.closest('.js-comment-delete');
    if (delComment) {
      const id = delComment.closest('[data-comment-id]').dataset.commentId;
      if (!await confirmDialog('Xóa bình luận này?', { danger: true, confirmText: 'Xóa' })) return;
      try {
        await api.del(`/api/comments/${id}`);
        delComment.closest('[data-comment-id]').remove();
        post.comments_count = Math.max(0, (post.comments_count || 1) - 1);
        card.querySelector('.js-comment-count').textContent = `${post.comments_count} bình luận`;
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

function shareModal(post, onChanged) {
  const m = modal({
    title: 'Chia sẻ bài viết',
    content: `
      <div class="field"><label>Nội dung của bạn</label><textarea class="textarea" id="share-body" maxlength="20000" placeholder="Bạn nghĩ gì về bài viết này?"></textarea></div>
      <div class="field"><label>Ai có thể xem</label><select class="select" id="share-visibility"><option value="public">Mọi người</option><option value="friends">Bạn bè</option><option value="private">Chỉ mình tôi</option></select></div>
      <div class="row" style="gap:10px">${avatar(post.author, 34)}<span class="small muted">Bài viết của ${esc(post.author?.display_name || '')}</span></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-send>Chia sẻ ngay</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-send]').onclick = async () => {
    const btn = m.overlay.querySelector('[data-send]');
    btn.disabled = true;
    try {
      const data = await api.post(`/api/posts/${post.id}/share`, {
        body: m.overlay.querySelector('#share-body').value.trim(),
        visibility: m.overlay.querySelector('#share-visibility').value,
      });
      m.close();
      toast('Đã chia sẻ bài viết', 'success');
      if (onChanged) onChanged(data.post, 'share');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  };
}

function postMenu(post, card, { onChanged, onDeleted } = {}) {
  const mine = auth.user && post.author?.id === auth.user.id;
  const staff = auth.user && ['admin', 'moderator'].includes(auth.user.role);
  const url = `${location.origin}${location.pathname}#/post/${post.id}`;
  const m = modal({
    title: 'Tùy chọn bài viết',
    content: `<div class="col">
      <button class="btn btn-ghost btn-block" data-copy>${icon('link', 17)} Sao chép liên kết</button>
      ${mine ? `<button class="btn btn-ghost btn-block" data-edit>${icon('edit', 17)} Chỉnh sửa bài viết</button>` : ''}
      ${!mine ? `<button class="btn btn-ghost btn-block" data-report>${icon('flag', 17)} Báo cáo bài viết</button>` : ''}
      ${mine || staff ? `<button class="btn btn-ghost btn-block" style="color:var(--danger)" data-delete>${icon('trash', 17)} Xóa bài viết</button>` : ''}
    </div>`,
  });
  m.overlay.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('Đã sao chép liên kết', 'success'); }
    catch { toast(url, 'info'); }
    m.close();
  };
  const editBtn = m.overlay.querySelector('[data-edit]');
  if (editBtn) editBtn.onclick = () => { m.close(); editPost(post, card, onChanged); };
  const reportBtn = m.overlay.querySelector('[data-report]');
  if (reportBtn) reportBtn.onclick = () => { m.close(); openReport('post', post.id); };
  const deleteBtn = m.overlay.querySelector('[data-delete]');
  if (deleteBtn) deleteBtn.onclick = async () => {
    m.close();
    if (!await confirmDialog('Bài viết sẽ bị xóa. Bạn chắc chắn?', { danger: true, confirmText: 'Xóa bài viết' })) return;
    try {
      await api.del(`/api/posts/${post.id}`);
      card.remove();
      toast('Đã xóa bài viết', 'success');
      if (onDeleted) onDeleted(post);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function editPost(post, card, onChanged) {
  const m = modal({
    title: 'Chỉnh sửa bài viết',
    content: `<div class="field"><textarea class="textarea" id="edit-body" maxlength="20000">${esc(post.body || '')}</textarea></div>
      <div class="field"><label>Ai có thể xem</label><select class="select" id="edit-visibility">
        <option value="public" ${post.visibility === 'public' ? 'selected' : ''}>Mọi người</option>
        <option value="friends" ${post.visibility === 'friends' ? 'selected' : ''}>Bạn bè</option>
        <option value="private" ${post.visibility === 'private' ? 'selected' : ''}>Chỉ mình tôi</option>
      </select></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu thay đổi</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-save]').onclick = async () => {
    try {
      const data = await api.patch(`/api/posts/${post.id}`, {
        body: m.overlay.querySelector('#edit-body').value.trim(),
        visibility: m.overlay.querySelector('#edit-visibility').value,
      });
      post.body = data.post?.body ?? m.overlay.querySelector('#edit-body').value.trim();
      post.visibility = data.post?.visibility ?? m.overlay.querySelector('#edit-visibility').value;
      const bodyEl = card.querySelector('.post-body');
      if (bodyEl) bodyEl.innerHTML = linkify(post.body);
      m.close();
      toast('Đã cập nhật bài viết', 'success');
      if (onChanged) onChanged(post, 'edit');
    } catch (err) { toast(err.message, 'error'); }
  };
}

export function openReport(targetType, targetId) {
  const reasons = [
    ['spam', 'Spam hoặc quảng cáo'], ['harassment', 'Quấy rối / bắt nạt'], ['hate', 'Ngôn từ thù địch'],
    ['violence', 'Bạo lực'], ['nudity', 'Nội dung nhạy cảm'], ['misinformation', 'Thông tin sai lệch'], ['other', 'Khác'],
  ];
  const m = modal({
    title: 'Báo cáo nội dung',
    content: `<div class="field"><label>Lý do</label><select class="select" id="report-reason">${reasons.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label>Chi tiết (không bắt buộc)</label><textarea class="textarea" id="report-details" maxlength="2000" placeholder="Mô tả thêm để đội ngũ kiểm duyệt xử lý nhanh hơn"></textarea></div>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-send>Gửi báo cáo</button>`,
  });
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  m.overlay.querySelector('[data-send]').onclick = async () => {
    const btn = m.overlay.querySelector('[data-send]');
    btn.disabled = true;
    try {
      await api.post('/api/reports', {
        target_type: targetType, target_id: targetId,
        reason: m.overlay.querySelector('#report-reason').value,
        details: m.overlay.querySelector('#report-details').value.trim() || undefined,
      });
      m.close();
      toast('Đã gửi báo cáo. Cảm ơn bạn.', 'success');
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

export function openComposer({ groupId = null, pageId = null, onCreated } = {}) {
  const state = { media: [], uploading: 0 };
  const m = modal({
    title: groupId ? 'Đăng bài trong nhóm' : pageId ? 'Đăng bài trên trang' : 'Tạo bài viết',
    wide: true,
    content: `
      <div class="row" style="align-items:flex-start;gap:12px">
        ${avatar(auth.user, 44)}
        <div class="grow">
          <textarea class="textarea" id="composer-body" maxlength="20000" placeholder="Bạn đang nghĩ gì?" style="min-height:130px;border:0;background:transparent;padding:6px 0;font-size:16px"></textarea>
          <div id="composer-media" class="media-grid n4" style="margin-bottom:8px"></div>
          <div id="composer-progress"></div>
        </div>
      </div>
      <div class="row-between" style="border-top:1px solid var(--border);padding-top:12px;margin-top:10px;flex-wrap:wrap">
        <div class="row" style="gap:2px">
          <button class="icon-btn" type="button" id="pick-media" title="Ảnh / video">${icon('image', 20)}</button>
          <label class="icon-btn" title="Ảnh bìa" style="cursor:pointer">${icon('camera', 20)}<input type="file" id="pick-camera" accept="image/*,video/*" hidden></label>
        </div>
        <select class="select" id="composer-visibility" style="width:auto;padding:8px 12px">
          <option value="public">Mọi người</option><option value="friends">Bạn bè</option><option value="private">Chỉ mình tôi</option>
        </select>
      </div>
      <input type="file" id="composer-file" accept="image/*,video/*,audio/*" multiple hidden>`,
    actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-post disabled>Đăng bài</button>`,
  });
  const bodyEl = m.overlay.querySelector('#composer-body');
  const fileEl = m.overlay.querySelector('#composer-file');
  const postBtn = m.overlay.querySelector('[data-post]');
  const mediaBox = m.overlay.querySelector('#composer-media');
  const progressBox = m.overlay.querySelector('#composer-progress');
  const refresh = () => {
    postBtn.disabled = state.uploading > 0 || (!bodyEl.value.trim() && state.media.length === 0);
    mediaBox.innerHTML = state.media.map((item, i) => `
      <div style="position:relative">${mediaBlock(item, { controls: false, cls: '' })}
        <button type="button" class="icon-btn" data-remove="${i}" style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,.6)">${icon('close', 15)}</button>
      </div>`).join('');
  };
  bodyEl.addEventListener('input', refresh);
  m.overlay.querySelector('#pick-media').onclick = () => fileEl.click();
  m.overlay.querySelector('#pick-camera').onchange = (e) => uploadFiles(e.target.files);
  fileEl.onchange = (e) => { uploadFiles(e.target.files); fileEl.value = ''; };
  mediaBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    state.media.splice(Number(btn.dataset.remove), 1);
    refresh();
  });
  async function uploadFiles(files) {
    for (const file of [...(files || [])]) {
      if (state.media.length >= 10) { toast('Tối đa 10 tệp', 'error'); break; }
      state.uploading += 1;
      refresh();
      progressBox.innerHTML = `<div class="progress"><span style="width:2%"></span></div><small class="muted">Đang tải ${esc(file.name)}…</small>`;
      const bar = progressBox.querySelector('.progress span');
      try {
        const media = await api.upload(file, (p) => { bar.style.width = `${p}%`; });
        state.media.push({ url: media.url, kind: media.kind, thumb_url: media.thumb_url, width: media.width, height: media.height });
      } catch (err) { toast(err.message, 'error'); }
      state.uploading -= 1;
      progressBox.innerHTML = '';
      refresh();
    }
  }
  m.overlay.querySelector('[data-cancel]').onclick = m.close;
  postBtn.onclick = async () => {
    postBtn.disabled = true;
    try {
      const data = await api.post('/api/posts', {
        body: bodyEl.value.trim(), visibility: m.overlay.querySelector('#composer-visibility').value,
        media: state.media, group_id: groupId || undefined, page_id: pageId || undefined,
      });
      m.close();
      toast('Đã đăng bài viết', 'success');
      if (onCreated) onCreated(data.post);
    } catch (err) { toast(err.message, 'error'); postBtn.disabled = false; }
  };
  setTimeout(() => bodyEl.focus(), 60);
  return m;
}

export function userRow(user, actions = '') {
  return `<div class="person-row" data-user-id="${esc(user.id)}">
    <a href="#/profile/${esc(user.username)}">${avatar(user, 44)}</a>
    <div class="grow"><a class="person-name" href="#/profile/${esc(user.username)}">${esc(user.display_name)}</a>
      <div class="person-meta">@${esc(user.username)}${user.mutual ? ` · ${user.mutual} bạn chung` : user.online ? ' · Đang hoạt động' : ''}</div></div>
    ${actions}
  </div>`;
}

export function followButton(user) {
  const following = user.relationship === 'following' || user.relationship === 'friends';
  if (user.relationship === 'self') return '';
  return `<button class="btn btn-sm ${following ? 'btn-ghost' : 'btn-soft'} js-follow" data-id="${esc(user.id)}" data-following="${following}">${following ? 'Đang theo dõi' : 'Theo dõi'}</button>`;
}

export function bindFollowButtons(root, onChange) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-follow');
    if (!btn) return;
    const id = btn.dataset.id;
    const following = btn.dataset.following === 'true';
    btn.disabled = true;
    try {
      if (following) await api.del(`/api/follows/${id}`);
      else await api.post(`/api/follows/${id}`);
      btn.dataset.following = String(!following);
      btn.textContent = following ? 'Theo dõi' : 'Đang theo dõi';
      btn.classList.toggle('btn-ghost', !following);
      btn.classList.toggle('btn-soft', following);
      if (onChange) onChange(id, !following);
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

export function addFriendButton(user) {
  if (!user.relationship || user.relationship === 'self') return '';
  if (user.relationship === 'friends') return `<span class="badge badge-success">${icon('check', 13)} Bạn bè</span>`;
  if (user.relationship === 'request_sent') return `<button class="btn btn-sm btn-ghost" disabled>Đã gửi lời mời</button>`;
  if (user.relationship === 'request_received') return `<button class="btn btn-sm btn-primary js-accept-friend" data-id="${esc(user.id)}">Chấp nhận</button>`;
  if (user.relationship === 'blocked') return `<span class="badge badge-danger">Đã chặn</span>`;
  return `<button class="btn btn-sm btn-soft js-add-friend" data-id="${esc(user.id)}">${icon('plus', 14)} Kết bạn</button>`;
}

export function bindFriendButtons(root, onChanged) {
  root.addEventListener('click', async (e) => {
    const add = e.target.closest('.js-add-friend');
    const accept = e.target.closest('.js-accept-friend');
    if (!add && !accept) return;
    const btn = add || accept;
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      if (add) {
        await api.post(`/api/friends/requests/${id}`);
        btn.outerHTML = `<button class="btn btn-sm btn-ghost" disabled>Đã gửi lời mời</button>`;
        toast('Đã gửi lời mời kết bạn', 'success');
      } else {
        await api.post(`/api/friends/requests/${id}/accept`);
        btn.outerHTML = `<span class="badge badge-success">${icon('check', 13)} Bạn bè</span>`;
        toast('Đã trở thành bạn bè', 'success');
      }
      if (onChanged) onChanged(id);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
}

export function storyRing(story, isOwn = false) {
  return `<button class="story-item js-story-open" data-user-id="${esc(story.author.id)}">
    <span class="avatar-ring">${avatar(story.author, 62)}</span>
    <span>${esc(isOwn ? 'Tin của bạn' : story.author.display_name)}</span>
  </button>`;
}
