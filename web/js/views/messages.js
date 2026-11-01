import { api, auth } from '../api.js';
import {
  icon, esc, avatar, timeAgo, toast, spinner, empty, modal, confirmDialog, mediaBlock, navigate,
  uploadProgress,
} from '../ui.js';
import { startCall } from '../calls.js';

const EMOJIS = ['😀', '😂', '😍', '😎', '🤔', '😭', '😡', '👍', '🙏', '🔥', '❤️', '🎉', '👏', '💯', '✨', '🥳'];

function online(user) {
  if (!user?.last_seen_at) return false;
  return Date.now() - new Date(user.last_seen_at).getTime() < 120000;
}

function preview(c) {
  if (!c.last_message) return 'Bắt đầu trò chuyện';
  const m = c.last_message;
  const who = m.sender?.id === auth.user.id ? 'Bạn: ' : '';
  if (m.kind === 'image') return `${who}[Ảnh] ${m.body || ''}`.trim();
  if (m.kind === 'video') return `${who}[Video] ${m.body || ''}`.trim();
  if (m.kind === 'audio') return `${who}[Tin nhắn thoại]`;
  if (m.kind === 'file') return `${who}[Tệp] ${m.body || ''}`.trim();
  return `${who}${m.body || ''}`;
}

export async function renderMessages(container, params) {
  const activeId = params.id || null;
  container.innerHTML = `
    <div class="messenger ${activeId ? 'has-active' : ''}" id="messenger">
      <aside class="msg-side">
        <div class="msg-side-head">
          <h1 style="margin:0;font-size:22px">Tin nhắn</h1>
          <button class="btn btn-primary btn-sm" id="new-chat">${icon('plus', 16)} Mới</button>
        </div>
        <form class="search-pill mb" id="conv-search">${icon('search', 16)}<input type="search" placeholder="Tìm cuộc trò chuyện…"></form>
        <div class="msg-list" id="conv-list">${spinner()}</div>
      </aside>
      <section class="msg-main" id="msg-main">
        ${activeId ? spinner() : `<div class="msg-empty">${icon('message', 40)}<h2>Chọn một cuộc trò chuyện</h2><p class="muted">Hoặc bắt đầu trò chuyện mới với bạn bè.</p><button class="btn btn-primary" id="empty-new">${icon('plus', 16)} Tin nhắn mới</button></div>`}
      </section>
    </div>`;

  let conversations = [];
  let current = null;
  let messages = [];
  let seen = new Set();
  let typingTimer = null;
  let lastTypingSent = 0;
  let loadingOlder = false;
  let hasOlder = true;
  let poll = null;

  const listEl = container.querySelector('#conv-list');

  container.querySelector('#new-chat').onclick = openNewChat;
  container.querySelector('#empty-new')?.addEventListener('click', openNewChat);
  container.querySelector('#conv-search').onsubmit = (e) => e.preventDefault();
  container.querySelector('#conv-search input').oninput = (e) => drawConversations(e.target.value.trim().toLowerCase());

  function drawConversations(filter = '') {
    if (!conversations.length) {
      listEl.innerHTML = `<p class="muted small center" style="padding:24px">Chưa có cuộc trò chuyện nào</p>`;
      return;
    }
    const items = conversations.filter((c) => !filter || c.title?.toLowerCase().includes(filter));
    listEl.innerHTML = items.map((c) => {
      const other = c.kind === 'dm' ? c.members.find((m) => m.id !== auth.user.id) : null;
      const onlineDot = other && online(other) ? '<span class="online-dot"></span>' : '';
      return `<a class="conv ${c.id === activeId ? 'active' : ''}" href="#/messages/${esc(c.id)}" data-id="${esc(c.id)}">
        <span class="conv-av">${c.avatar_url ? `<img class="avatar" src="${esc(c.avatar_url)}" alt="" width="46" height="46">` : c.kind === 'group' ? `<span class="avatar avatar-fallback">${icon('users', 20)}</span>` : avatar(other, 46)}${onlineDot}</span>
        <span class="conv-body">
          <span class="conv-top"><b class="truncate">${esc(c.title || 'Cuộc trò chuyện')}</b><span class="tiny muted">${c.last_message ? timeAgo(c.last_message.created_at) : ''}</span></span>
          <span class="conv-bottom"><span class="truncate small ${c.unread ? 'strong' : 'muted'}">${esc(preview(c))}</span>${c.unread ? `<span class="badge badge-primary">${c.unread > 99 ? '99+' : c.unread}</span>` : c.muted ? icon('bellOff', 13) : ''}</span>
        </span>
      </a>`;
    }).join('') || '<p class="muted small center" style="padding:24px">Không tìm thấy cuộc trò chuyện</p>';
  }

  async function loadConversations() {
    try {
      const data = await api.get('/api/conversations?limit=50');
      conversations = data.items;
      drawConversations(container.querySelector('#conv-search input').value.trim().toLowerCase());
      return data.items;
    } catch (err) {
      listEl.innerHTML = empty(err.message, 'alert');
      return [];
    }
  }

  function messageHtml(m) {
    const mine = m.sender?.id === auth.user.id;
    return `<div class="msg-row ${mine ? 'mine' : ''}" data-msg="${esc(m.id)}">
      ${!mine ? `<a href="#/profile/${esc(m.sender?.username || '')}">${avatar(m.sender, 32)}</a>` : ''}
      <div class="msg-col">
        ${!mine && current?.kind === 'group' ? `<div class="tiny muted">${esc(m.sender?.display_name || '')}</div>` : ''}
        <div class="bubble ${m.kind !== 'text' ? 'bubble-media' : ''}">
          ${m.kind === 'image' || m.kind === 'video' ? mediaBlock({ kind: m.kind, url: m.media_url }) : ''}
          ${m.kind === 'audio' ? `<audio controls src="${esc(m.media_url)}" style="max-width:240px"></audio>` : ''}
          ${m.kind === 'file' ? `<a class="row" href="${esc(m.media_url)}" target="_blank" rel="noopener" download>${icon('file', 18)} ${esc(m.body || 'Tệp đính kèm')}</a>` : ''}
          ${m.body && m.kind !== 'file' ? `<div class="bubble-text">${esc(m.body)}</div>` : ''}
          <div class="bubble-meta"><span>${timeAgo(m.created_at)}</span>${mine ? `<button class="msg-menu" data-del="${esc(m.id)}" title="Xóa">${icon('trash', 12)}</button>` : ''}</div>
        </div>
      </div>
    </div>`;
  }

  function drawMessage(m, { scroll = true } = {}) {
    const box = container.querySelector('#msg-thread');
    if (!box || seen.has(m.id)) return;
    seen.add(m.id);
    box.insertAdjacentHTML('beforeend', messageHtml(m));
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  function scrollBottom() {
    const box = container.querySelector('#msg-thread');
    if (box) box.scrollTop = box.scrollHeight;
  }

  async function openConversation(id) {
    if (poll) { clearInterval(poll); poll = null; }
    const main = container.querySelector('#msg-main');
    main.innerHTML = spinner();
    try {
      const [detail, list] = await Promise.all([
        api.get(`/api/conversations/${id}?limit=40`),
        conversations.length ? Promise.resolve({ items: conversations }) : api.get('/api/conversations?limit=50'),
      ]);
      if (list.items) conversations = list.items;
      current = detail.conversation;
      messages = detail.messages;
      seen = new Set(messages.map((m) => m.id));
      hasOlder = messages.length >= 40;
      const other = current.kind === 'dm' ? current.members.find((m) => m.id !== auth.user.id) : null;
      const me = current.members.find((m) => m.id === auth.user.id);
      main.innerHTML = `
        <div class="msg-head">
          <button class="icon-btn back-msg" id="back-msg" title="Quay lại">${icon('back', 20)}</button>
          ${current.avatar_url ? `<img class="avatar" style="width:40px;height:40px" src="${esc(current.avatar_url)}" alt="">` : current.kind === 'group' ? `<span class="avatar" style="width:40px;height:40px;display:grid;place-items:center;background:var(--surface-3)">${icon('users', 20)}</span>` : avatar(other, 40)}
          <div class="grow" style="min-width:0">
            <div class="strong truncate">${esc(current.title || 'Cuộc trò chuyện')}</div>
            <div class="tiny muted">${current.kind === 'group' ? `${current.members.length} thành viên` : other && online(other) ? 'Đang hoạt động' : 'Ngoại tuyến'}${current.muted ? ' · Đã tắt thông báo' : ''}</div>
          </div>
          <a class="icon-btn" href="#/profile/${esc(other?.username || '')}" title="Trang cá nhân" ${current.kind === 'group' ? 'hidden' : ''}>${icon('user', 19)}</a>
          ${current.kind === 'dm' ? `<button class="icon-btn" id="voice-call" title="Gọi thoại">${icon('phone', 19)}</button><button class="icon-btn" id="video-call" title="Gọi video">${icon('video', 19)}</button>` : ''}
          <button class="icon-btn" id="conv-menu" title="Tùy chọn">${icon('more', 20)}</button>
        </div>
        <div class="msg-thread" id="msg-thread">${messages.length ? '<button class="btn btn-ghost btn-sm center" id="load-older" style="margin:0 auto 10px">Tải tin cũ hơn</button>' : ''}${messages.map(messageHtml).join('')}</div>
        <div class="typing-indicator" id="typing"></div>
        <form class="composer-msg" id="msg-form">
          <button type="button" class="icon-btn" id="attach" title="Đính kèm">${icon('paperclip', 20)}</button>
          <button type="button" class="icon-btn" id="emoji-btn" title="Biểu tượng cảm xúc">${icon('smile', 20)}</button>
          <input class="input" id="msg-input" placeholder="Nhập tin nhắn…" autocomplete="off" maxlength="10000">
          <button type="submit" class="btn btn-primary btn-icon" id="send-btn" title="Gửi">${icon('send', 18)}</button>
          <input type="file" id="msg-file" hidden>
          <div class="emoji-pop hide" id="emoji-pop">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
        </form>`;
      scrollBottom();
      main.querySelector('#back-msg').onclick = () => { container.querySelector('#messenger').classList.remove('has-active'); navigate('/messages'); };
      main.querySelector('#load-older')?.addEventListener('click', loadOlder);
      main.querySelector('#msg-thread').onscroll = () => {
        if (main.querySelector('#msg-thread').scrollTop < 40) loadOlder();
      };
      const form = main.querySelector('#msg-form');
      const input = main.querySelector('#msg-input');
      input.focus();
      input.oninput = () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(120, input.scrollHeight)}px`;
        if (Date.now() - lastTypingSent > 3000) {
          lastTypingSent = Date.now();
          api.post(`/api/conversations/${current.id}/typing`).catch(() => {});
        }
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        input.style.height = 'auto';
        try {
          const d = await api.post(`/api/conversations/${current.id}/messages`, { kind: 'text', body });
          drawMessage(d.message);
          updateConversationPreview(d.message);
        } catch (err) { toast(err.message, 'error'); input.value = body; }
      };
      main.querySelector('#attach').onclick = () => main.querySelector('#msg-file').click();
      main.querySelector('#msg-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await sendAttachment(file);
        e.target.value = '';
      };
      const pop = main.querySelector('#emoji-pop');
      main.querySelector('#emoji-btn').onclick = () => pop.classList.toggle('hide');
      pop.onclick = (e) => {
        const b = e.target.closest('[data-emoji]');
        if (!b) return;
        input.value += b.dataset.emoji;
        pop.classList.add('hide');
        input.focus();
      };
      main.querySelector('#msg-thread').onclick = async (e) => {
        const del = e.target.closest('[data-del]');
        if (!del) return;
        if (!await confirmDialog('Xóa tin nhắn này?', { danger: true, confirmText: 'Xóa' })) return;
        try {
          await api.del(`/api/messages/${del.dataset.del}`);
          del.closest('.msg-row')?.remove();
          toast('Đã xóa tin nhắn', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
      main.querySelector('#conv-menu').onclick = () => openConversationMenu();
      if (current.kind === 'dm') {
        main.querySelector('#voice-call').onclick = () => startCall({ conversationId: current.id, calleeId: other?.id, kind: 'voice', peer: other });
        main.querySelector('#video-call').onclick = () => startCall({ conversationId: current.id, calleeId: other?.id, kind: 'video', peer: other });
      }
      await api.post(`/api/conversations/${current.id}/read`).catch(() => {});
      const conv = conversations.find((c) => c.id === current.id);
      if (conv) { conv.unread = 0; drawConversations(); }
      container.querySelector('#messenger').classList.add('has-active');
      if (poll) clearInterval(poll);
      poll = setInterval(() => {
        if (document.hidden || !current) return;
        api.get(`/api/conversations/${current.id}?limit=30`).then((d) => {
          for (const m of d.messages) if (!seen.has(m.id)) drawMessage(m);
        }).catch(() => {});
      }, 5000);
    } catch (err) {
      main.innerHTML = empty(err.message, 'alert', '<a class="btn btn-ghost" href="#/messages">Quay lại</a>');
    }
  }

  async function loadOlder() {
    if (loadingOlder || !hasOlder || !messages.length) return;
    loadingOlder = true;
    try {
      const oldest = messages[0].created_at;
      const data = await api.get(`/api/conversations/${current.id}/messages?before=${encodeURIComponent(oldest)}&limit=40`);
      if (!data.items.length) { hasOlder = false; container.querySelector('#load-older')?.remove(); return; }
      const box = container.querySelector('#msg-thread');
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const frag = data.items.map(messageHtml).join('');
      const btn = container.querySelector('#load-older');
      if (btn) btn.insertAdjacentHTML('afterend', frag); else box.insertAdjacentHTML('afterbegin', frag);
      data.items.forEach((m) => seen.add(m.id));
      messages = [...data.items, ...messages];
      if (atBottom) scrollBottom();
      if (data.items.length < 40) { hasOlder = false; container.querySelector('#load-older')?.remove(); }
    } catch (err) { toast(err.message, 'error'); }
    finally { loadingOlder = false; }
  }

  async function sendAttachment(file) {
    try {
      const media = await api.upload(file);
      const kind = ['image', 'video', 'audio'].includes(media.kind) ? media.kind : 'file';
      const d = await api.post(`/api/conversations/${current.id}/messages`, {
        kind, media_url: media.url, body: kind === 'file' ? file.name : '',
      });
      drawMessage(d.message);
      updateConversationPreview(d.message);
    } catch (err) { toast(err.message, 'error'); }
  }

  function updateConversationPreview(message) {
    const conv = conversations.find((c) => c.id === message.conversation_id);
    if (!conv) return;
    conv.last_message = message;
    conv.updated_at = message.created_at;
    if (message.sender?.id !== auth.user.id) conv.unread = (conv.unread || 0) + 1;
    conversations.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    drawConversations(container.querySelector('#conv-search input').value.trim().toLowerCase());
  }

  function openConversationMenu() {
    if (!current) return;
    const m = modal({
      title: current.title || 'Tùy chọn',
      content: `<div class="list-card">
        <button class="list-action" data-mute>${icon(current.muted ? 'bell' : 'bellOff', 18)} ${current.muted ? 'Bật thông báo' : 'Tắt thông báo'}</button>
        ${current.kind === 'group' ? `<button class="list-action" data-rename>${icon('edit', 18)} Đổi tên nhóm</button><button class="list-action" data-add>${icon('userPlus', 18)} Thêm thành viên</button>` : ''}
        <button class="list-action" data-search>${icon('search', 18)} Tìm trong cuộc trò chuyện</button>
        <button class="list-action danger" data-leave>${icon('logout', 18)} ${current.kind === 'group' ? 'Rời nhóm' : 'Xóa cuộc trò chuyện'}</button>
      </div>`,
    });
    m.overlay.querySelector('[data-mute]').onclick = async () => {
      try {
        const d = await api.patch(`/api/conversations/${current.id}`, { muted: !current.muted });
        current = d.conversation;
        m.close();
        toast(current.muted ? 'Đã tắt thông báo' : 'Đã bật thông báo', 'success');
        openConversation(current.id);
      } catch (err) { toast(err.message, 'error'); }
    };
    m.overlay.querySelector('[data-rename]')?.addEventListener('click', () => {
      m.close();
      const rename = modal({
        title: 'Đổi tên nhóm',
        content: `<div class="field"><label>Tên nhóm</label><input class="input" id="group-name" maxlength="120" value="${esc(current.title || '')}"></div>`,
        actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-save>Lưu</button>`,
      });
      rename.overlay.querySelector('[data-cancel]').onclick = rename.close;
      rename.overlay.querySelector('[data-save]').onclick = async () => {
        try {
          const d = await api.patch(`/api/conversations/${current.id}`, { title: rename.overlay.querySelector('#group-name').value.trim() });
          current = d.conversation;
          rename.close();
          toast('Đã đổi tên nhóm', 'success');
          openConversation(current.id);
        } catch (err) { toast(err.message, 'error'); }
      };
    });
    m.overlay.querySelector('[data-add]')?.addEventListener('click', () => { m.close(); openAddMember(); });
    m.overlay.querySelector('[data-search]').onclick = () => { m.close(); searchInConversation(); };
    m.overlay.querySelector('[data-leave]').onclick = async () => {
      m.close();
      if (!await confirmDialog(current.kind === 'group' ? 'Rời khỏi nhóm này?' : 'Xóa cuộc trò chuyện khỏi danh sách?', { danger: true, confirmText: 'Rời' })) return;
      try {
        await api.del(`/api/conversations/${current.id}/members/${auth.user.id}`);
        toast('Đã rời cuộc trò chuyện', 'info');
        navigate('/messages');
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function openAddMember() {
    const m = modal({
      title: 'Thêm thành viên',
      content: `<form class="search-pill" id="add-search">${icon('search', 16)}<input type="search" placeholder="Tìm người…"></form><div id="add-results" class="mt">${spinner()}</div>`,
    });
    const results = m.overlay.querySelector('#add-results');
    const existing = new Set(current.members.map((u) => u.id));
    const search = async (q = '') => {
      try {
        const d = await api.get(`/api/search?q=${encodeURIComponent(q)}&type=users&limit=20`);
        const users = d.users || d.items || [];
        results.innerHTML = users.filter((u) => !existing.has(u.id)).map((u) => userResultRow(u)).join('') || '<p class="muted small">Không tìm thấy ai</p>';
        results.querySelectorAll('[data-add-user]').forEach((btn) => {
          btn.onclick = async () => {
            try {
              await api.post(`/api/conversations/${current.id}/members`, { user_id: btn.dataset.addUser });
              toast('Đã thêm thành viên', 'success');
              m.close();
              openConversation(current.id);
            } catch (err) { toast(err.message, 'error'); }
          };
        });
      } catch (err) { results.innerHTML = empty(err.message, 'alert'); }
    };
    m.overlay.querySelector('#add-search').onsubmit = (e) => { e.preventDefault(); search(e.target.querySelector('input').value.trim()); };
    search();
  }

  function userResultRow(u, extra = '') {
    return `<div class="person-row">${avatar(u, 38)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)}</div></div><button class="btn btn-sm btn-primary" data-add-user="${esc(u.id)}">Thêm</button>${extra}</div>`;
  }

  async function searchInConversation() {
    const m = modal({
      title: 'Tìm trong cuộc trò chuyện',
      content: `<form class="search-pill" id="in-search">${icon('search', 16)}<input type="search" placeholder="Nhập từ khóa…"></form><div id="in-results" class="mt"></div>`,
    });
    const results = m.overlay.querySelector('#in-results');
    m.overlay.querySelector('#in-search').onsubmit = async (e) => {
      e.preventDefault();
      const q = e.target.querySelector('input').value.trim();
      if (!q) return;
      results.innerHTML = spinner();
      try {
        const d = await api.get(`/api/messages/search?q=${encodeURIComponent(q)}&limit=30`);
        const items = d.items.filter((x) => x.conversation_id === current.id);
        results.innerHTML = items.length ? `<div class="list-card">${items.map((x) => `<div class="person-row"><div class="grow"><div class="small">${esc(x.body || `[${x.kind}]`)}</div><div class="person-meta">${esc(x.sender?.display_name || '')} · ${timeAgo(x.created_at)}</div></div></div>`).join('')}</div>` : '<p class="muted small">Không có kết quả</p>';
      } catch (err) { results.innerHTML = empty(err.message, 'alert'); }
    };
  }

  function openNewChat() {
    const m = modal({
      title: 'Tin nhắn mới',
      content: `
        <div class="tabs mb" id="new-tabs"><button class="tab active" data-kind="dm">Cá nhân</button><button class="tab" data-kind="group">Nhóm</button></div>
        <form class="search-pill" id="new-search">${icon('search', 16)}<input type="search" placeholder="Tìm theo tên hoặc @username…"></form>
        <div id="selected-chips" class="chips mt"></div>
        <div id="new-results" class="mt">${spinner()}</div>
        <div class="field mt hide" id="group-title-field"><label>Tên nhóm</label><input class="input" id="group-title" maxlength="120"></div>`,
      actions: `<button class="btn btn-ghost" data-cancel>Hủy</button><button class="btn btn-primary" data-create>Bắt đầu</button>`,
    });
    let kind = 'dm';
    const selected = new Map();
    const results = m.overlay.querySelector('#new-results');
    const chips = m.overlay.querySelector('#selected-chips');
    const drawChips = () => {
      chips.innerHTML = [...selected.values()].map((u) => `<span class="chip">${esc(u.display_name)} <button data-unselect="${esc(u.id)}">${icon('close', 11)}</button></span>`).join('');
      chips.querySelectorAll('[data-unselect]').forEach((b) => {
        b.onclick = () => { selected.delete(b.dataset.unselect); drawChips(); };
      });
    };
    const pick = (u) => {
      if (kind === 'dm') { selected.clear(); doCreate([u.id]); return; }
      if (selected.has(u.id)) selected.delete(u.id); else selected.set(u.id, u);
      drawChips();
      if (kind === 'dm') doCreate([u.id]);
    };
    m.overlay.querySelector('#new-tabs').onclick = (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      kind = tab.dataset.kind;
      m.overlay.querySelectorAll('#new-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
      m.overlay.querySelector('#group-title-field').classList.toggle('hide', kind !== 'group');
      selected.clear();
      drawChips();
    };
    async function doCreate(userIds) {
      const btn = m.overlay.querySelector('[data-create]');
      btn.disabled = true;
      try {
        const payload = kind === 'group'
          ? { kind: 'group', member_ids: [...selected.keys()], title: m.overlay.querySelector('#group-title').value.trim() || undefined }
          : { kind: 'dm', user_id: userIds[0] };
        if (kind === 'group' && selected.size < 1) { toast('Chọn ít nhất một thành viên', 'error'); btn.disabled = false; return; }
        const d = await api.post('/api/conversations', payload);
        m.close();
        await loadConversations();
        navigate(`/messages/${d.conversation.id}`);
        if (activeId !== d.conversation.id) {
          // router re-renders; when already on /messages, refresh manually
          if (window.location.hash === `#/messages/${d.conversation.id}`) openConversation(d.conversation.id);
        }
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    }
    const search = async (q = '') => {
      results.innerHTML = spinner();
      try {
        let users = [];
        if (q) {
          const d = await api.get(`/api/search?q=${encodeURIComponent(q)}&type=users&limit=30`);
          users = d.users || d.items || [];
        } else {
          const d = await api.get('/api/friends?limit=30');
          users = d.items;
        }
        results.innerHTML = users.length ? `<div class="list-card">${users.map((u) => `<div class="person-row">${avatar(u, 38)}<div class="grow"><div class="person-name">${esc(u.display_name)}</div><div class="person-meta">@${esc(u.username)}</div></div><button class="btn btn-sm ${selected.has(u.id) ? 'btn-soft' : 'btn-ghost'}" data-pick="${esc(u.id)}">${selected.has(u.id) ? 'Đã chọn' : 'Chọn'}</button></div>`).join('')}</div>` : '<p class="muted small">Không tìm thấy người dùng</p>';
        results.querySelectorAll('[data-pick]').forEach((btn) => {
          btn.onclick = () => {
            const u = users.find((x) => x.id === btn.dataset.pick);
            if (kind === 'dm') { doCreate([u.id]); return; }
            if (selected.has(u.id)) selected.delete(u.id); else selected.set(u.id, u);
            drawChips();
            search(q);
          };
        });
      } catch (err) { results.innerHTML = empty(err.message, 'alert'); }
    };
    m.overlay.querySelector('#new-search').onsubmit = (e) => { e.preventDefault(); search(e.target.querySelector('input').value.trim()); };
    m.overlay.querySelector('[data-cancel]').onclick = m.close;
    m.overlay.querySelector('[data-create]').onclick = () => doCreate([...selected.keys()]);
    search();
  }

  window.addEventListener('haonline:message', onMessage);
  window.addEventListener('haonline:typing', onTyping);
  window.addEventListener('haonline:conversations', onConversations);
  window.addEventListener('haonline:message-deleted', onMessageDeleted);
  const cleanup = () => {
    if (poll) clearInterval(poll);
    window.removeEventListener('haonline:message', onMessage);
    window.removeEventListener('haonline:typing', onTyping);
    window.removeEventListener('haonline:conversations', onConversations);
    window.removeEventListener('haonline:message-deleted', onMessageDeleted);
  };

  function onMessage(e) {
    const { conversation_id: cid, message } = e.detail || {};
    if (!message) return;
    if (cid === activeId && current?.id === cid) {
      drawMessage(message);
      api.post(`/api/conversations/${cid}/read`).catch(() => {});
    }
    updateConversationPreview(message);
  }
  function onTyping(e) {
    if (!current || e.detail?.conversation_id !== current.id || e.detail?.user_id === auth.user.id) return;
    const el = container.querySelector('#typing');
    if (!el) return;
    el.textContent = `${e.detail.display_name || 'Ai đó'} đang nhập…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { el.textContent = ''; }, 2500);
  }
  function onConversations() { loadConversations(); }
  function onMessageDeleted(e) {
    if (e.detail?.conversation_id !== activeId) return;
    container.querySelector(`[data-msg="${CSS.escape(e.detail.message_id)}"]`)?.remove();
  }

  await loadConversations();
  if (activeId) await openConversation(activeId);
  return cleanup;
}
