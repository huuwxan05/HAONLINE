import { api, auth } from './api.js';
import { icon, esc, avatar, toast } from './ui.js';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let active = null;
let incoming = null;
let overlay = null;

function ensureOverlay() {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'call-overlay hide';
  overlay.innerHTML = `
    <div class="call-card" id="call-card">
      <div class="call-remote-wrap">
        <video id="call-remote" class="call-remote" autoplay playsinline></video>
        <div class="call-avatar" id="call-avatar"></div>
        <video id="call-local" class="call-local" autoplay playsinline muted></video>
        <div class="call-badge" id="call-status">Đang kết nối…</div>
        <div class="call-timer" id="call-timer"></div>
      </div>
      <div class="call-name" id="call-name"></div>
      <div class="call-sub" id="call-sub"></div>
      <div class="call-controls" id="call-controls">
        <button class="call-btn" id="btn-mute" title="Tắt tiếng">${icon('mic', 22)}</button>
        <button class="call-btn" id="btn-cam" title="Tắt camera">${icon('video', 22)}</button>
        <button class="call-btn danger" id="btn-hangup" title="Kết thúc">${icon('phoneOff', 22)}</button>
      </div>
      <div class="call-ring" id="call-ring">
        <button class="call-btn danger" id="btn-decline" title="Từ chối">${icon('phoneOff', 22)}</button>
        <button class="call-btn accept" id="btn-accept" title="Nghe">${icon('phone', 22)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function showOverlay() {
  ensureOverlay().classList.remove('hide');
  document.body.classList.add('in-call');
}

function hideOverlay() {
  if (overlay) overlay.classList.add('hide');
  document.body.classList.remove('in-call');
}

function setStatus(text) {
  const el = overlay?.querySelector('#call-status');
  if (el) el.textContent = text;
}

function setPeerUI(peer, kind) {
  if (!overlay) return;
  const nameEl = overlay.querySelector('#call-name');
  const subEl = overlay.querySelector('#call-sub');
  const av = overlay.querySelector('#call-avatar');
  if (nameEl) nameEl.textContent = peer?.display_name || 'Cuộc gọi';
  if (subEl) subEl.textContent = kind === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
  if (av) av.innerHTML = peer ? avatar(peer, 104) : icon('user', 48);
  const camBtn = overlay.querySelector('#btn-cam');
  if (camBtn) camBtn.classList.toggle('hide', kind !== 'video');
}

function startTimer(startedAt) {
  stopTimer();
  if (!overlay) return;
  const el = overlay.querySelector('#call-timer');
  const tick = () => {
    if (!active) return;
    const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  active.timerEl = setInterval(tick, 1000);
}

function stopTimer() {
  if (active?.timerEl) clearInterval(active.timerEl);
}

function stopSignalPoll() {
  if (active?.poll) clearInterval(active.poll);
  if (active) active.poll = null;
}

function cleanup() {
  if (!active) {
    incoming = null;
    hideOverlay();
    return;
  }
  stopTimer();
  stopSignalPoll();
  clearTimeout(callTimeout);
  try { active.pc?.close(); } catch { /* ignore */ }
  if (active.localStream) active.localStream.getTracks().forEach((t) => t.stop());
  const remote = overlay?.querySelector('#call-remote');
  if (remote) remote.srcObject = null;
  const local = overlay?.querySelector('#call-local');
  if (local) local.srcObject = null;
  active = null;
  incoming = null;
  hideOverlay();
}

function resetUi() {
  if (!overlay) return;
  overlay.querySelector('#call-local').srcObject = null;
  overlay.querySelector('#call-remote').srcObject = null;
  overlay.querySelector('#call-timer').textContent = '';
  overlay.querySelector('#call-remote').classList.add('hide');
  overlay.querySelector('#call-avatar').classList.remove('fade');
  overlay.querySelector('#btn-mute').classList.remove('off');
  overlay.querySelector('#btn-cam').classList.remove('off');
  overlay.querySelector('#call-ring').classList.add('hide');
  overlay.querySelector('#call-controls').classList.remove('hide');
}

export async function startCall({ conversationId, calleeId, kind = 'video', peer = null }) {
  if (active) {
    toast('Bạn đang trong một cuộc gọi khác', 'error');
    return;
  }
  try {
    const d = await api.post('/api/calls', { conversation_id: conversationId, callee_id: calleeId, kind });
    const call = d.call;
    active = {
      id: call.id, kind, conversationId, peer, role: 'caller',
      pc: null, localStream: null, remoteStream: null,
      pendingIce: [], handled: new Set(), cursor: new Date(Date.now() - 2000).toISOString(),
      timerEl: null, poll: null, muted: false, camOff: false,
    };
    resetUi();
    overlay.querySelector('#call-ring').classList.add('hide');
    overlay.querySelector('#call-controls').classList.remove('hide');
    setPeerUI(peer, kind);
    setStatus('Đang gọi…');
    bindControls();
    showOverlay();
    startSignalPoll();
    startCallTimeout();
  } catch (err) {
    toast(err.message, 'error');
  }
}

let callTimeout = null;
function startCallTimeout() {
  clearTimeout(callTimeout);
  callTimeout = setTimeout(() => {
    if (active?.role === 'caller' && !active.pc) {
      toast('Không có phản hồi', 'info');
      hangupActive();
    }
  }, 45000);
}

function bindControls() {
  if (!overlay || overlay.dataset.bound === '1') return;
  overlay.dataset.bound = '1';
  overlay.querySelector('#btn-hangup').onclick = () => hangupActive();
  overlay.querySelector('#btn-mute').onclick = () => {
    const track = active?.localStream?.getAudioTracks()[0];
    if (!track) return;
    active.muted = !active.muted;
    track.enabled = !active.muted;
    overlay.querySelector('#btn-mute').classList.toggle('off', active.muted);
  };
  overlay.querySelector('#btn-cam').onclick = () => {
    const track = active?.localStream?.getVideoTracks()[0];
    if (!track) return;
    active.camOff = !active.camOff;
    track.enabled = !active.camOff;
    overlay.querySelector('#btn-cam').classList.toggle('off', active.camOff);
  };
  overlay.querySelector('#btn-accept').onclick = acceptIncoming;
  overlay.querySelector('#btn-decline').onclick = declineIncoming;
}

async function acceptIncoming() {
  if (!incoming) return;
  const call = incoming;
  incoming = null;
  if (!overlay) return;
  overlay.querySelector('#call-ring').classList.add('hide');
  overlay.querySelector('#call-controls').classList.remove('hide');
  try {
    await api.post(`/api/calls/${call.id}/answer`, { accept: true });
    active = {
      id: call.id, kind: call.kind, conversationId: call.conversation_id, peer: call.caller,
      role: 'callee', pc: null, localStream: null, remoteStream: null,
      pendingIce: [], handled: new Set(), cursor: new Date(Date.now() - 2000).toISOString(),
      timerEl: null, poll: null, muted: false, camOff: false,
    };
    setPeerUI(call.caller, call.kind);
    setStatus('Đang kết nối…');
    showOverlay();
    if (!active) return;
    active.mediaPromise = setupLocalMedia();
    await active.mediaPromise;
    if (!active) return;
    if (!active.pc) active.pc = createPeer(false);
    startSignalPoll();
  } catch (err) {
    toast(err.message, 'error');
    cleanup();
  }
}

async function declineIncoming() {
  if (!incoming) return;
  const call = incoming;
  incoming = null;
  try { await api.post(`/api/calls/${call.id}/answer`, { accept: false }); } catch { /* ignore */ }
  hideOverlay();
}

async function setupLocalMedia() {
  if (!active) return;
  try {
    const constraints = active.kind === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true };
    active.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    const local = overlay.querySelector('#call-local');
    local.srcObject = active.localStream;
    local.classList.toggle('hide', active.kind !== 'video');
  } catch (err) {
    toast('Không truy cập được micro/camera', 'error', 5000);
    try {
      active.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error('Thiết bị không có micro hoặc quyền bị từ chối');
    }
  }
}

function createPeer(isCaller) {
  const pc = new RTCPeerConnection(ICE);
  if (active.localStream) {
    for (const track of active.localStream.getTracks()) pc.addTrack(track, active.localStream);
  }
  pc.onicecandidate = (e) => {
    if (e.candidate && active) postSignal('ice', e.candidate.toJSON());
  };
  pc.ontrack = (e) => {
    active.remoteStream = e.streams[0];
    const remote = overlay.querySelector('#call-remote');
    remote.srcObject = e.streams[0];
    remote.classList.remove('hide');
    overlay.querySelector('#call-avatar').classList.add('fade');
    setStatus('Đang trong cuộc gọi');
    startTimer(new Date().toISOString());
  };
  pc.onconnectionstatechange = () => {
    if (!active) return;
    if (pc.connectionState === 'connected') {
      setStatus('Đang trong cuộc gọi');
    }
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      setStatus('Mất kết nối…');
      setTimeout(() => { if (active && ['failed', 'disconnected'].includes(pc.connectionState)) hangupActive(); }, 5000);
    }
  };
  if (isCaller) {
    pc.onnegotiationneeded = async () => {
      if (!active || active.offerSent) return;
      try {
        active.offerSent = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postSignal('offer', { type: offer.type, sdp: offer.sdp });
      } catch (err) { console.warn('offer', err); }
    };
  }
  return pc;
}

async function postSignal(kind, payload) {
  if (!active) return;
  try { await api.post(`/api/calls/${active.id}/signal`, { kind, payload }); }
  catch (err) { console.warn('call signal', err.message); }
}

async function handleSignal(kind, payload) {
  if (!active) return;
  if (kind === 'offer') {
    if (active.mediaPromise) await active.mediaPromise;
    if (!active) return;
    if (!active.pc) active.pc = createPeer(false);
    await active.pc.setRemoteDescription(payload);
    while (active.pendingIce.length) {
      const c = active.pendingIce.shift();
      try { await active.pc.addIceCandidate(c); } catch { /* ignore */ }
    }
    const answer = await active.pc.createAnswer();
    await active.pc.setLocalDescription(answer);
    await postSignal('answer', { type: answer.type, sdp: answer.sdp });
    return;
  }
  if (kind === 'answer') {
    if (!active.pc) return;
    await active.pc.setRemoteDescription(payload);
    while (active.pendingIce.length) {
      const c = active.pendingIce.shift();
      try { await active.pc.addIceCandidate(c); } catch { /* ignore */ }
    }
    return;
  }
  if (kind === 'ice') {
    if (!active.pc || !active.pc.remoteDescription) { active.pendingIce.push(payload); return; }
    try { await active.pc.addIceCandidate(payload); } catch { /* ignore */ }
  }
}

function startSignalPoll() {
  if (!active) return;
  active.poll = setInterval(async () => {
    if (!active) return;
    try {
      const d = await api.get(`/api/calls/${active.id}/signals?after=${encodeURIComponent(active.cursor)}`);
      for (const sig of d.items) {
        if (active.handled.has(sig.id)) continue;
        active.handled.add(sig.id);
        active.cursor = sig.created_at;
        handleSignal(sig.kind, sig.payload);
      }
    } catch { /* realtime fallback */ }
  }, 4000);
}

export async function hangupActive() {
  if (!active) { hideOverlay(); return; }
  const id = active.id;
  stopTimer();
  stopSignalPoll();
  try { await api.post(`/api/calls/${id}/end`); } catch { /* ignore */ }
  cleanup();
  toast('Đã kết thúc cuộc gọi', 'info', 2000);
}

export function handleCallEvent(type, payload) {
  if (type === 'incoming') {
    const call = payload?.call;
    if (!call || !call.id) return;
    if (active) {
      api.post(`/api/calls/${call.id}/answer`, { accept: false }).catch(() => {});
      toast('Bạn đang bận, đã từ chối cuộc gọi mới', 'info');
      return;
    }
    incoming = call;
    const ov = ensureOverlay();
    resetUi();
    ov.querySelector('#call-ring').classList.remove('hide');
    ov.querySelector('#call-controls').classList.add('hide');
    ov.querySelector('#call-timer').textContent = '';
    setPeerUI(call.caller, call.kind);
    setStatus(call.kind === 'video' ? 'Cuộc gọi video đến' : 'Cuộc gọi thoại đến');
    ov.querySelector('#call-remote').classList.add('hide');
    ov.querySelector('#call-avatar').classList.remove('fade');
    bindControls();
    showOverlay();
    return;
  }
  if (type === 'answered') {
    if (!active || active.role !== 'caller') return;
    clearTimeout(callTimeout);
    if (!payload?.accepted) { toast('Cuộc gọi bị từ chối', 'info'); cleanup(); return; }
    setStatus('Đang kết nối…');
    active.mediaPromise = setupLocalMedia();
    active.mediaPromise.then(() => {
      if (!active) return;
      active.pc = createPeer(true);
      startSignalPoll();
    }).catch((err) => { toast(err.message, 'error'); hangupActive(); });
    return;
  }
  if (type === 'signal') {
    if (!active || payload?.call_id !== active.id) return;
    if (active.handled.has(payload.signal_id)) return;
    handleSignal(payload.kind, payload.payload);
    return;
  }
  if (type === 'ended') {
    if (!active || payload?.call?.id !== active.id) {
      if (incoming && payload?.call?.id === incoming.id) { incoming = null; hideOverlay(); }
      return;
    }
    cleanup();
    toast('Cuộc gọi đã kết thúc', 'info', 2500);
  }
}
