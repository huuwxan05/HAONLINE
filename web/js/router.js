const routes = [];
let cleanup = null;

export function register(pattern, loader) {
  const keys = [];
  const regex = new RegExp(`^${pattern
    .replace(/\/$/, '')
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([a-zA-Z_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}/?$`);
  routes.push({ regex, keys, loader });
}

export function parse() {
  const raw = (window.location.hash || '#/').slice(1);
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart || '/';
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  for (const route of routes) {
    const match = path.match(route.regex);
    if (!match) continue;
    const params = {};
    route.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]); });
    return { path, query, params, loader: route.loader };
  }
  return { path, query, params: {}, loader: null };
}

export function currentPath() {
  return (window.location.hash || '#/').slice(1).split('?')[0] || '/';
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function startRouter(container) {
  const animate = () => {
    container.classList.remove('view-enter');
    void container.offsetWidth;
    container.classList.add('view-enter');
  };
  const run = async () => {
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch { /* view cleanup must not block navigation */ }
    }
    cleanup = null;
    const route = parse();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!route.loader) {
      container.innerHTML = `<div class="empty-state">${'<p>Không tìm thấy trang</p>'}</div>`;
      animate();
      return;
    }
    container.innerHTML = '';
    try {
      cleanup = await route.loader(container, route.params, route.query);
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="empty-state error-state"><p>${escapeText(err.message || 'Không tải được trang')}</p><button class="btn btn-ghost" data-retry>Tải lại</button></div>`;
      container.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    }
    animate();
  };
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

function escapeText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
