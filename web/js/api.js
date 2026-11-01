const TOKEN_KEY = 'haonline.token';

export const auth = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  settings: {},
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function setToken(token) {
  auth.token = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearToken() {
  setToken(null);
  auth.user = null;
  auth.settings = {};
}

async function request(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (auth.token) opts.headers.Authorization = `Bearer ${auth.token}`;
  if (body !== undefined && !raw) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body !== undefined) {
    opts.body = body;
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    throw new ApiError(0, 'network_error', 'Không có kết nối máy chủ');
  }
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && auth.token) emit('haonline:unauthorized');
    throw new ApiError(res.status, data?.error?.code || 'http_error', data?.error?.message || `Lỗi ${res.status}`, data?.error?.details);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),
  async upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media');
      xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'upload'));
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { data = {}; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.media);
        else {
          if (xhr.status === 401) emit('haonline:unauthorized');
          reject(new ApiError(xhr.status, data?.error?.code || 'upload_failed', data?.error?.message || 'Tải tệp thất bại'));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Tải tệp thất bại'));
      xhr.send(file);
    });
  },
};

let stream = null;
export function connectStream(handlers) {
  if (stream) stream.close();
  if (!auth.token) return null;
  stream = new EventSource(`/api/stream?token=${encodeURIComponent(auth.token)}`);
  stream.addEventListener('ready', () => emit('haonline:stream-ready'));
  for (const [event, handler] of Object.entries(handlers || {})) {
    stream.addEventListener(event, (e) => {
      try { handler(JSON.parse(e.data)); } catch (err) { console.error('stream handler', event, err); }
    });
  }
  stream.onerror = () => {
    if (stream && stream.readyState === EventSource.CLOSED) emit('haonline:stream-closed');
  };
  return stream;
}

export function disconnectStream() {
  if (stream) stream.close();
  stream = null;
}

export async function loadMe() {
  const data = await api.get('/api/auth/me');
  auth.user = data.user;
  auth.settings = data.settings || {};
  return data;
}

export function isStaff() {
  return auth.user && ['admin', 'moderator'].includes(auth.user.role);
}

export function isAdmin() {
  return auth.user && auth.user.role === 'admin';
}
