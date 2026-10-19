// Screenshot Organizer — application entry point.
import '../styles/main.css';
import { downloadBlob, h, isTypingTarget } from './lib/dom.js';
import { detectInitialLanguage, getLanguage, onLanguageChange, setLanguage as applyLanguage, t } from './i18n/index.js';
import { back, navigate, onAfterEach, onBeforeEach, route, setNotFound, startRouter } from './router.js';
import { clearSelection, listen, setState, state } from './state.js';
import { hasRepo, openLibrary } from './services/database.service.js';
import { applyTheme, getSettings, getStoredTheme } from './services/settings.service.js';
import { resumePendingOcr } from './services/ocr.service.js';
import { addRecentSearch } from './services/search.service.js';
import { backupFilename, exportBackup } from './services/backup.service.js';
import { mountShell } from './components/shell.js';
import { closeViewer, openViewer, viewerOpenFor } from './components/image-viewer.js';
import { openImport } from './components/import-dialog.js';
import { isPaletteOpen, openCommandPalette } from './components/command-palette.js';
import { hasOpenDialog } from './components/dialog.js';
import { closeMenus } from './components/menu.js';
import { toast, toastError } from './components/toast.js';
import { emptyState } from './components/ui.js';
import * as galleryPage from './pages/gallery.js';
import * as homePage from './pages/home.js';
import * as collectionsPage from './pages/collections.js';
import * as categoriesPage from './pages/categories.js';
import * as duplicatesPage from './pages/duplicates.js';
import * as statsPage from './pages/statistics.js';
import * as settingsPage from './pages/settings.js';
import * as backupPage from './pages/backup.js';
import * as helpPage from './pages/help.js';
import * as landingPage from './pages/landing.js';
import * as welcomePage from './pages/welcome.js';

const STARTED_KEY = 'so.started';
const app = document.getElementById('app');
let shell = null;
let page = null;
let pageRoute = null;
let booted = false;
let mountedOnce = false;

// --- Routes -----------------------------------------------------------------------
const L = { library: true };
route('/', 'landing', { public: true });
route('/welcome', 'welcome', L);
route('/home', 'home', L);
route('/library', 'library', L);
route('/recent', 'recent', L);
route('/favorites', 'favorites', L);
route('/uncollected', 'uncollected', L);
route('/ocr', 'ocr', L);
route('/large', 'large', L);
route('/search', 'search', L);
route('/trash', 'trash', L);
route('/collections', 'collections', L);
route('/collections/:id', 'collection', L);
route('/tags/:id', 'tag', L);
route('/categories', 'categories', L);
route('/categories/:key', 'category', L);
route('/duplicates', 'duplicates', L);
route('/stats', 'stats', L);
route('/settings', 'settings', L);
route('/backup', 'backup', L);
route('/help', 'help', { public: true });
route('/s/:id', 'screenshot', L);
setNotFound('notfound');

const GALLERY_ROUTES = ['library', 'recent', 'favorites', 'uncollected', 'ocr', 'large', 'search', 'trash', 'collection', 'tag', 'category'];
const PAGES = {
  landing: landingPage.render,
  welcome: welcomePage.render,
  home: homePage.render,
  collections: collectionsPage.render,
  categories: categoriesPage.render,
  duplicates: duplicatesPage.render,
  stats: statsPage.render,
  settings: settingsPage.render,
  backup: backupPage.render,
  help: helpPage.render,
  notfound: (ctx) => {
    ctx.setTitle(t('errors.notFoundTitle'));
    return {
      el: h('div', { class: 'page' }, emptyState({ iconName: 'search', title: t('errors.notFoundTitle'), text: t('errors.notFoundText'), headingLevel: 1,
        actions: [h('a', { class: 'btn btn--primary', href: hasRepo() ? '#/home' : '#/' }, t('common.goHome'))] })),
      bare: !hasRepo(),
    };
  },
};
for (const name of GALLERY_ROUTES) PAGES[name] = galleryPage.render;

function setTitle(title) {
  document.title = title ? `${title} — ${t('app.name')}` : `${t('app.name')} — ${t('app.tagline')}`;
}

function context(target) {
  return {
    route: target,
    params: target.params,
    query: target.query,
    // A getter: the shell is created after the page is rendered on the first library visit.
    get shell() { return shell; },
    navigate: (path, query) => navigate(path, { query }),
    setTitle,
    openViewer: (item, ids) => openScreenshot(item, ids),
    setLanguage,
    setTheme,
    start,
    rerender: () => mount(pageRoute, { force: true }),
  };
}

function ensureShell() {
  if (shell) return shell;
  shell = mountShell(app, {
    openPalette,
    openImport: () => openImport(),
    onSearch: (q, { commit } = {}) => {
      const query = q.trim();
      if (commit && query) addRecentSearch(query);
      if (!query) {
        if (state.route.name === 'search') navigate('/search', { replace: true });
        return;
      }
      navigate('/search', { query: { q: query }, replace: state.route.name === 'search' });
    },
    navigate: (path) => navigate(path),
    setTheme,
    setLanguage,
  });
  return shell;
}

function destroyShell() {
  shell?.destroy();
  shell = null;
}

function mount(target, { force = false } = {}) {
  if (!target) return;
  const same = pageRoute && pageRoute.path === target.path && JSON.stringify(pageRoute.query) === JSON.stringify(target.query);
  if (same && !force && page) return;
  page?.destroy?.();
  closeMenus();
  clearSelection();
  setState({ route: target });
  const result = PAGES[target.name](context(target));
  page = result;
  pageRoute = target;
  if (result.bare) {
    destroyShell();
    app.className = 'app app--bare';
    app.replaceChildren(result.el);
  } else {
    ensureShell();
    shell.hideInspector();
    shell.main.replaceChildren(result.el);
    shell.setActive(target.name);
    shell.setSearchValue(target.name === 'search' ? (target.query.q ?? '') : '');
    window.scrollTo(0, 0);
  }
  // Move focus to the new page's heading on in-app navigation, for keyboard
  // and screen-reader users. Not on first load, so the skip link stays first.
  const moveFocus = booted && mountedOnce;
  mountedOnce = true;
  if (moveFocus) focusPageHeading(target);
}

/**
 * Focuses the new page's heading. Pages that load data first render their
 * heading a moment later, so wait for it briefly, unless the user has
 * already moved focus somewhere else in the meantime.
 */
function focusPageHeading(target) {
  const startFocus = document.activeElement;
  const SELECTOR = '.page-title, .hero__title, h1.empty__title';
  const tryFocus = () => {
    if (pageRoute !== target) return true; // navigated away
    if (document.activeElement !== startFocus && document.activeElement !== document.body) return true;
    if (target.name === 'search' && document.activeElement === shell?.searchInput) return true;
    if (isPaletteOpen() || hasOpenDialog() || document.querySelector('.menu-backdrop, .viewer')) return true;
    const heading = app.querySelector(SELECTOR);
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    return true;
  };
  requestAnimationFrame(() => {
    if (tryFocus()) return;
    const observer = new MutationObserver(() => { if (tryFocus()) stop(); });
    const timer = setTimeout(() => stop(), 2000);
    const stop = () => { observer.disconnect(); clearTimeout(timer); };
    observer.observe(app, { childList: true, subtree: true });
  });
}

// --- Navigation guards -----------------------------------------------------------------
onBeforeEach(async (target) => {
  if (target.meta.library && !hasRepo()) {
    // A deep link opens the library directly; if the browser can't store data, explain on the landing page.
    if (!(await tryOpenLibrary())) return { path: '/' };
  }
  if (target.name === 'landing' && hasRepo()) return { path: '/home' };
  return null;
});

onAfterEach((target) => {
  if (target.name === 'screenshot') {
    if (!pageRoute || pageRoute.name === 'screenshot') mount({ ...target, name: 'library', path: '/library', query: {}, meta: L });
    if (viewerOpenFor() !== target.params.id) {
      const ids = state.viewerContext?.includes(target.params.id) ? state.viewerContext : [target.params.id];
      openViewer(target.params.id, {
        ids: [...ids],
        onClose: () => back(pageRoute?.path ?? '/library'),
        onNavigate: (id) => {
          if (location.hash !== `#/s/${id}`) history.replaceState(history.state, '', `${location.pathname}${location.search}#/s/${id}`);
        },
      });
    }
    return;
  }
  if (viewerOpenFor()) closeViewer();
  mount(target);
});

function openScreenshot(item, ids) {
  setState({ viewerContext: ids?.length ? ids : [item.id] });
  navigate(`/s/${item.id}`);
}

// --- Library lifecycle --------------------------------------------------------------
async function tryOpenLibrary() {
  try {
    await openLibrary();
    try { localStorage.setItem(STARTED_KEY, '1'); } catch { /* ignore */ }
    setTimeout(() => resumePendingOcr().catch(() => {}), 4000);
    return true;
  } catch (error) {
    console.error(error);
    toast(t('errors.localUnavailable'), { kind: 'error', duration: 0 });
    return false;
  }
}

async function start() {
  if (!(await tryOpenLibrary())) return;
  navigate(welcomePage.isOnboarded() ? '/home' : '/welcome');
}

// --- Preferences ---------------------------------------------------------------------
function setLanguage(lang) {
  applyLanguage(lang);
  setState({ lang });
}

function setTheme(theme) {
  applyTheme(theme);
  setState({ theme });
}

onLanguageChange(() => {
  // Re-render everything so every visible string switches at once.
  destroyShell();
  const r = pageRoute;
  page?.destroy?.();
  page = null;
  pageRoute = null;
  if (r) mount(r, { force: true });
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'system') applyTheme('system');
});

// --- Command palette ----------------------------------------------------------------------
function paletteCommands() {
  const go = (path) => () => navigate(path);
  const lib = hasRepo();
  return [
    lib && { id: 'import', label: t('palette.cmd.import'), icon: 'upload', hint: 'I', run: () => openImport() },
    lib && { id: 'newCollection', label: t('palette.cmd.newCollection'), icon: 'folder-plus', run: () => galleryPage.editCollectionDialog(null, { onSaved: (c) => navigate(`/collections/${c.id}`) }) },
    lib && { id: 'home', label: t('nav.home'), icon: 'home', hint: 'G H', run: go('/home') },
    lib && { id: 'all', label: t('nav.allScreenshots'), icon: 'images', hint: 'G A', run: go('/library') },
    lib && { id: 'recent', label: t('nav.recent'), icon: 'clock', hint: 'G R', run: go('/recent') },
    lib && { id: 'favorites', label: t('nav.favorites'), icon: 'star', hint: 'G F', run: go('/favorites') },
    lib && { id: 'collections', label: t('nav.collections'), icon: 'folder', hint: 'G C', run: go('/collections') },
    lib && { id: 'categories', label: t('nav.categories'), icon: 'sparkles', run: go('/categories') },
    lib && { id: 'duplicates', label: t('nav.duplicates'), icon: 'layers', run: go('/duplicates') },
    lib && { id: 'trash', label: t('nav.trash'), icon: 'trash', hint: 'G T', run: go('/trash') },
    lib && { id: 'stats', label: t('nav.statistics'), icon: 'bar-chart', run: go('/stats') },
    lib && { id: 'backup', label: t('palette.cmd.exportBackup'), icon: 'archive', run: async () => {
      toast(t('backup.preparing'), { kind: 'info' });
      try {
        const { blob, manifest } = await exportBackup();
        downloadBlob(blob, backupFilename());
        toast(t('backup.exportDone', { count: manifest.counts.screenshots }), { kind: 'success' });
      } catch (error) { toastError(error, 'backup.errors.exportFailed'); }
    } },
    lib && { id: 'settings', label: t('nav.settings'), icon: 'settings', hint: 'G S', run: go('/settings') },
    { id: 'theme', label: t('palette.cmd.toggleTheme'), icon: 'moon', keywords: 'dark light tema e errët e çelët', run: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
    { id: 'lang', label: t('palette.cmd.switchLanguage'), icon: 'globe', keywords: 'language gjuha english shqip', run: () => setLanguage(getLanguage() === 'sq' ? 'en' : 'sq') },
    { id: 'help', label: t('nav.help'), icon: 'help', run: go('/help') },
  ].filter(Boolean);
}

function openPalette() {
  openCommandPalette({
    commands: paletteCommands,
    openScreenshot: (item, ids) => openScreenshot(item, ids),
    search: (q) => { addRecentSearch(q); navigate('/search', { query: { q } }); },
  });
}

// --- Keyboard shortcuts ----------------------------------------------------------------
let gPending = false;
let gTimer = null;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!isPaletteOpen()) openPalette();
    return;
  }
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (isTypingTarget(e.target) || hasOpenDialog() || isPaletteOpen() || viewerOpenFor() || document.querySelector('.menu-backdrop')) return;
  if (!hasRepo() || !getSettings().shortcutsEnabled) return;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape' && state.selection.size) { clearSelection(); return; }
  if (gPending) {
    gPending = false;
    clearTimeout(gTimer);
    const target = { h: '/home', a: '/library', f: '/favorites', c: '/collections', t: '/trash', s: '/settings', r: '/recent' }[key];
    if (target) { e.preventDefault(); navigate(target); }
    return;
  }
  if (e.key === '/') { e.preventDefault(); shell?.focusSearch(); }
  else if (key === 'i') { e.preventDefault(); openImport(); }
  else if (key === 'g') { gPending = true; gTimer = setTimeout(() => { gPending = false; }, 1200); }
});

// --- Paste and drag-and-drop import ---------------------------------------------------------
document.addEventListener('paste', (e) => {
  if (!hasRepo() || isTypingTarget(e.target)) return;
  const files = [];
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = blob.name && blob.name !== 'image.png'
      ? blob.name
      : `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.${ext}`;
    files.push(new File([blob], name, { type: blob.type, lastModified: Date.now() }));
  }
  if (files.length) {
    e.preventDefault();
    openImport(files);
  }
});

let dragDepth = 0;
const dropOverlay = h('div', { class: 'drop-overlay', hidden: true, aria: { hidden: 'true' } }, h('div', { class: 'drop-overlay__inner' }, h('p')));
document.body.append(dropOverlay);
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasRepo() || !hasFiles(e) || hasOpenDialog()) return;
  dragDepth++;
  dropOverlay.querySelector('p').textContent = t('import.dropOverlay');
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (!hasRepo() || hasOpenDialog()) return;
  const files = [...e.dataTransfer.files];
  if (files.length) openImport(files);
});

// --- Online / offline and background events ---------------------------------------------------
window.addEventListener('online', () => setState({ online: true }));
window.addEventListener('offline', () => setState({ online: false }));
listen('ocr:fatal', () => toast(t('ocr.modelFailed'), { kind: 'error' }));

// --- Service worker -------------------------------------------------------------------------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  // Reload only when the user accepted an update. The first install also
  // fires controllerchange (clients.claim), which must not reload the page.
  let updateAccepted = false;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateAccepted || refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => toast(t('status.updateReady'), {
      kind: 'info', duration: 0,
      action: { label: t('status.reload'), onClick: () => { updateAccepted = true; worker.postMessage({ type: 'SKIP_WAITING' }); } },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((error) => console.warn('[sw] registration failed', error));
}

// --- Boot -----------------------------------------------------------------------------------
async function boot() {
  const theme = getStoredTheme();
  setState({ theme });
  applyTheme(theme);
  const lang = detectInitialLanguage();
  applyLanguage(lang, { persist: false });
  setState({ lang });

  let started = false;
  try { started = localStorage.getItem(STARTED_KEY) === '1'; } catch { /* ignore */ }
  if (started) await tryOpenLibrary();

  booted = true;
  await startRouter();
  registerServiceWorker();
  document.documentElement.classList.add('is-ready');
}

boot();
