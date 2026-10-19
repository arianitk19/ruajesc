// Hash router for a static-hosted SPA: works on any host without rewrites,
// and browser back/forward map directly onto hashchange.

const routes = [];
let notFound = null;
let beforeEach = null;
let afterEach = null;

/** Registers a route like '/collections/:id'. */
export function route(pattern, name, meta = {}) {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/\/:(\w+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; }) + '/?$',
  );
  routes.push({ pattern, name, regex, keys, meta });
}

export function setNotFound(name) {
  notFound = name;
}

export function onBeforeEach(fn) {
  beforeEach = fn;
}

export function onAfterEach(fn) {
  afterEach = fn;
}

export function parseHash(hash) {
  const raw = (hash ?? '').replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, query };
}

export function match(path) {
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
      return { name: r.name, params, meta: r.meta, pattern: r.pattern };
    }
  }
  return notFound ? { name: notFound, params: {}, meta: {}, pattern: null } : null;
}

export function buildHash(path, query) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path, { query, replace = false } = {}) {
  const hash = buildHash(path, query);
  if (location.hash === hash) {
    resolve();
    return;
  }
  if (replace) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
    resolve();
  } else {
    location.hash = hash;
  }
}

/** Updates the query string of the current route without adding history. */
export function updateQuery(patch) {
  const { path, query } = parseHash(location.hash);
  const next = { ...query, ...patch };
  history.replaceState(history.state, '', `${location.pathname}${location.search}${buildHash(path, next)}`);
}

export async function resolve() {
  const { path, query } = parseHash(location.hash);
  let target = match(path);
  if (!target) return;
  target = { ...target, query, path };
  if (beforeEach) {
    const redirect = await beforeEach(target);
    if (redirect) {
      navigate(redirect.path, { query: redirect.query, replace: true });
      return;
    }
  }
  afterEach?.(target);
}

let internalNavigations = 0;

export function startRouter() {
  window.addEventListener('hashchange', () => {
    internalNavigations++;
    resolve();
  });
  return resolve();
}

/** Goes back inside the app; falls back to a route when opened from outside. */
export function back(fallback = '/home') {
  if (internalNavigations > 0) {
    internalNavigations = Math.max(0, internalNavigations - 2); // the back navigation itself fires hashchange
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}
