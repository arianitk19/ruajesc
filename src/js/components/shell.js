// Application shell: sidebar, top bar, mobile bottom navigation and drawer,
// desktop inspector and the bulk-selection bar.
import { debounce, h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { hasRepo, repo } from '../services/database.service.js';
import { suggest } from '../services/search.service.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import { clearSelection, listen, setState, state, subscribe } from '../state.js';
import { formatBytes, formatNumber } from '../utils/formatting.js';
import * as actions from './actions.js';
import { detailsPanel } from './details-panel.js';
import { openMenu } from './menu.js';
import { thumbImage } from './thumb.js';
import { kbd, modKey } from './ui.js';

export const NAV = [
  { group: 'library', items: [
    { id: 'home', path: '/home', icon: 'home', label: 'nav.home' },
    { id: 'library', path: '/library', icon: 'images', label: 'nav.allScreenshots', count: (s) => s.total },
    { id: 'recent', path: '/recent', icon: 'clock', label: 'nav.recent', count: (s) => s.recent_30d },
    { id: 'favorites', path: '/favorites', icon: 'star', label: 'nav.favorites', count: (s) => s.favorites },
  ] },
  { group: 'organize', items: [
    { id: 'collections', path: '/collections', icon: 'folder', label: 'nav.collections', count: (s) => s.collections },
    { id: 'categories', path: '/categories', icon: 'sparkles', label: 'nav.categories' },
    { id: 'duplicates', path: '/duplicates', icon: 'layers', label: 'nav.duplicates', count: (s) => s.exact_duplicate_groups || null },
    { id: 'trash', path: '/trash', icon: 'trash', label: 'nav.trash', count: (s) => s.trashed || null },
  ] },
  { group: 'insight', items: [
    { id: 'stats', path: '/stats', icon: 'bar-chart', label: 'nav.statistics' },
    { id: 'backup', path: '/backup', icon: 'archive', label: 'nav.backup' },
  ] },
];

const ACTIVE_ALIASES = {
  collection: 'collections', category: 'categories', tag: 'collections', uncollected: 'library', ocr: 'library',
  large: 'library', search: 'library',
};

const themeIcon = () => (state.theme === 'dark' ? 'moon' : state.theme === 'light' ? 'sun' : 'monitor');

/**
 * @param {HTMLElement} root
 * @param {{openPalette: Function, openImport: Function, onSearch: Function, navigate: Function, setTheme: Function, setLanguage: Function}} hooks
 */
export function mountShell(root, hooks) {
  const countEls = new Map();
  const navLinks = new Map();

  // --- Sidebar ---------------------------------------------------------------
  const navGroups = NAV.map((g) => h('div', { class: 'nav-group' },
    h('p', { class: 'nav-group__label' }, t(`nav.groups.${g.group}`)),
    h('ul', { role: 'list' }, g.items.map((it) => {
      const count = h('span', { class: 'nav-item__count' });
      countEls.set(it.id, count);
      const link = h('a', { class: 'nav-item', href: `#${it.path}`, dataset: { nav: it.id } },
        icon(it.icon, { size: 18 }), h('span', { class: 'nav-item__label' }, t(it.label)), count);
      navLinks.set(it.id, link);
      return h('li', null, link);
    }))));

  const storageEl = h('a', { class: 'storage-indicator', href: '#/settings?section=storage' });
  const collapseBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--icon sidebar__collapse', aria: { label: t('nav.collapse') },
    onClick: () => { updateSettings({ sidebarCollapsed: !getSettings().sidebarCollapsed }); applyCollapse(); } }, icon('panel-left-close'));
  const bottomLinks = [['settings', '/settings', 'settings', 'nav.settings'], ['help', '/help', 'help', 'nav.help']].map(([id, path, ic, label]) => {
    const a = h('a', { class: 'nav-item', href: `#${path}`, dataset: { nav: id } }, icon(ic, { size: 18 }), h('span', { class: 'nav-item__label' }, t(label)));
    navLinks.set(id, a);
    return a;
  });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar', aria: { label: t('nav.main') } },
    h('div', { class: 'sidebar__top' },
      h('a', { class: 'brand', href: '#/home', aria: { label: t('app.name') } },
        h('span', { class: 'brand__mark', aria: { hidden: 'true' } }, h('span'), h('span'), h('span')),
        h('span', { class: 'brand__name' }, t('app.name'))),
      collapseBtn),
    h('nav', { class: 'sidebar__nav', aria: { label: t('nav.main') } }, navGroups),
    h('div', { class: 'sidebar__bottom' }, bottomLinks, storageEl));

  const applyCollapse = () => {
    const collapsed = getSettings().sidebarCollapsed;
    root.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-label', collapsed ? t('nav.expand') : t('nav.collapse'));
    replace(collapseBtn, icon(collapsed ? 'panel-left-open' : 'panel-left-close'));
  };

  // --- Top bar ---------------------------------------------------------------
  const searchInput = h('input', {
    class: 'searchbox__input', type: 'search', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    placeholder: t('search.placeholder'), enterkeyhint: 'search',
    aria: { label: t('search.label'), expanded: 'false', controls: 'search-suggestions', autocomplete: 'list' },
  });
  const suggestionsEl = h('ul', { class: 'search-suggestions', id: 'search-suggestions', role: 'listbox', hidden: true });
  const clearBtn = h('button', { type: 'button', class: 'searchbox__clear', aria: { label: t('search.clear') }, hidden: true,
    onClick: () => { searchInput.value = ''; clearBtn.hidden = true; hooks.onSearch(''); searchInput.focus(); } }, icon('x', { size: 16 }));
  const searchBox = h('div', { class: 'searchbox', role: 'search' },
    icon('search', { size: 17, className: 'searchbox__icon' }), searchInput, clearBtn,
    h('span', { class: 'searchbox__kbd' }, kbd(modKey, 'K')), suggestionsEl);

  let suggestionItems = [];
  let activeSuggestion = -1;
  let cachedSources = null;
  const loadSources = async () => {
    if (cachedSources) return cachedSources;
    try {
      const [tags, collections] = await Promise.all([repo().listTags(), repo().listCollections()]);
      cachedSources = { tags, collections };
    } catch { cachedSources = { tags: [], collections: [] }; }
    return cachedSources;
  };
  const hideSuggestions = () => {
    suggestionsEl.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  };
  const chooseSuggestion = (s) => {
    hideSuggestions();
    if (s.kind === 'tag') { searchInput.value = ''; hooks.navigate(`/tags/${s.id}`); }
    else if (s.kind === 'collection') { searchInput.value = ''; hooks.navigate(`/collections/${s.id}`); }
    else { searchInput.value = s.text; hooks.onSearch(s.text, { commit: true }); }
    clearBtn.hidden = !searchInput.value;
  };
  const showSuggestions = async () => {
    suggestionItems = suggest(searchInput.value, await loadSources());
    if (!suggestionItems.length) return hideSuggestions();
    const ICON = { recent: 'history', tag: 'tag', collection: 'folder' };
    replace(suggestionsEl,
      !searchInput.value.trim() ? h('li', { class: 'search-suggestions__head', role: 'presentation' }, t('search.recent')) : null,
      ...suggestionItems.map((s, i) => h('li', { id: `sugg-${i}`, role: 'option', class: 'search-suggestion', aria: { selected: 'false' },
        onMouseDown: (e) => { e.preventDefault(); chooseSuggestion(s); } },
      icon(ICON[s.kind], { size: 15 }), h('span', null, s.text), h('span', { class: 'search-suggestion__kind' }, t(`search.kind.${s.kind}`)))));
    suggestionsEl.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  };
  const debouncedSearch = debounce((q) => hooks.onSearch(q), 250);
  searchInput.addEventListener('input', () => {
    clearBtn.hidden = !searchInput.value;
    debouncedSearch(searchInput.value);
    showSuggestions();
  });
  searchInput.addEventListener('focus', showSuggestions);
  searchInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
  searchInput.addEventListener('keydown', (e) => {
    const opts = [...suggestionsEl.querySelectorAll('[role="option"]')];
    if (e.key === 'ArrowDown' && opts.length) {
      e.preventDefault();
      activeSuggestion = (activeSuggestion + 1) % opts.length;
    } else if (e.key === 'ArrowUp' && opts.length) {
      e.preventDefault();
      activeSuggestion = (activeSuggestion - 1 + opts.length) % opts.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestion >= 0 && suggestionItems[activeSuggestion]) return chooseSuggestion(suggestionItems[activeSuggestion]);
      debouncedSearch.cancel();
      hideSuggestions();
      hooks.onSearch(searchInput.value, { commit: true });
      return;
    } else if (e.key === 'Escape') {
      if (!suggestionsEl.hidden) { e.stopPropagation(); hideSuggestions(); }
      else if (searchInput.value) { searchInput.value = ''; clearBtn.hidden = true; hooks.onSearch(''); }
      else searchInput.blur();
      return;
    } else return;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === activeSuggestion)));
    if (opts[activeSuggestion]) searchInput.setAttribute('aria-activedescendant', opts[activeSuggestion].id);
  });

  const activityDot = h('span', { class: 'activity-btn__dot', hidden: true });
  const activityBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--icon activity-btn', aria: { label: t('activity.title'), haspopup: 'menu' },
    onClick: () => openMenu(activityBtn, activityItems(), { label: t('activity.title') }) }, icon('history'), activityDot);
  const themeBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--icon', aria: { label: t('settings.theme.label'), haspopup: 'menu' },
    onClick: () => openMenu(themeBtn, ['light', 'dark', 'system'].map((v) => ({
      label: t(`settings.theme.${v}`), checked: state.theme === v, onClick: () => hooks.setTheme(v),
    })), { label: t('settings.theme.label') }) }, icon(themeIcon()));
  const langBtn = h('button', { type: 'button', class: 'btn btn--quiet lang-btn', aria: { label: t('settings.language.label'), haspopup: 'menu' },
    onClick: () => openMenu(langBtn, [
      { label: 'Shqip', checked: getLanguage() === 'sq', onClick: () => hooks.setLanguage('sq') },
      { label: 'English', checked: getLanguage() === 'en', onClick: () => hooks.setLanguage('en') },
    ], { label: t('settings.language.label') }) }, icon('globe', { size: 17 }), h('span', null, getLanguage().toUpperCase()));
  const onlineEl = h('span', { class: 'net-status', role: 'status', hidden: true, title: t('status.offlineLong') }, icon('wifi-off', { size: 15 }), h('span', null, t('status.offline')));
  const menuBtn = h('button', { type: 'button', class: 'btn btn--quiet btn--icon topbar__menu', aria: { label: t('nav.openMenu'), controls: 'sidebar', expanded: 'false' },
    onClick: () => toggleDrawer(true) }, icon('list'));

  const topbar = h('header', { class: 'topbar' },
    menuBtn,
    h('a', { class: 'brand brand--compact', href: '#/home', aria: { label: t('app.name') } },
      h('span', { class: 'brand__mark', aria: { hidden: 'true' } }, h('span'), h('span'), h('span'))),
    searchBox,
    h('div', { class: 'topbar__actions' },
      onlineEl,
      h('button', { type: 'button', class: 'btn btn--quiet btn--icon topbar__palette', aria: { label: t('palette.open') }, title: `${t('palette.open')} (${modKey}+K)`, onClick: () => hooks.openPalette() }, icon('command')),
      activityBtn, langBtn, themeBtn,
      h('button', { type: 'button', class: 'btn btn--primary topbar__import', onClick: () => hooks.openImport() }, icon('upload', { size: 17 }), h('span', null, t('import.button')))));

  // --- Main and inspector ---------------------------------------------------------
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const inspector = h('aside', { class: 'inspector', aria: { label: t('inspector.label') }, hidden: true });
  let inspectorPanel = null;

  function showInspector(item, onOpen) {
    inspectorPanel?.destroy();
    inspectorPanel = detailsPanel(item.id);
    replace(inspector,
      h('header', { class: 'inspector__head' },
        h('h2', { class: 'inspector__title' }, actions.displayName(item)),
        h('button', { type: 'button', class: 'btn btn--quiet btn--icon', aria: { label: t('inspector.close') }, onClick: hideInspector }, icon('x'))),
      h('button', { type: 'button', class: 'inspector__preview', aria: { label: t('gallery.openItem', { name: actions.displayName(item) }) }, onClick: onOpen },
        thumbImage(item, { eager: true })),
      h('div', { class: 'inspector__actions' },
        h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: onOpen }, icon('eye', { size: 16 }), h('span', null, t('common.open'))),
        h('button', { type: 'button', class: 'btn btn--quiet btn--sm', onClick: () => actions.downloadOriginal(item) }, icon('download', { size: 16 }), h('span', null, t('actions.download'))),
        item.is_trashed ? null : h('button', { type: 'button', class: 'btn btn--quiet btn--sm', onClick: () => actions.trash([item.id]).then((ok) => ok && hideInspector()) }, icon('trash', { size: 16 }), h('span', null, t('actions.trash')))),
      inspectorPanel.el);
    inspector.hidden = false;
    root.classList.add('has-inspector');
    setState({ inspectorId: item.id });
  }
  function hideInspector() {
    inspectorPanel?.destroy();
    inspectorPanel = null;
    inspector.hidden = true;
    replace(inspector);
    root.classList.remove('has-inspector');
    setState({ inspectorId: null });
  }

  // --- Selection bar -----------------------------------------------------------------
  const selectionCount = h('span', { class: 'selection-bar__count', aria: { live: 'polite' } });
  const selectionActions = h('div', { class: 'selection-bar__actions' });
  const selectionBar = h('div', { class: 'selection-bar', role: 'toolbar', aria: { label: t('selection.toolbar') }, hidden: true },
    h('button', { type: 'button', class: 'btn btn--quiet btn--icon', aria: { label: t('selection.clear') }, onClick: () => clearSelection() }, icon('x')),
    selectionCount, selectionActions);
  const selBtn = (label, iconName, fn, kind = 'quiet') => h('button', { type: 'button', class: `btn btn--${kind} btn--sm`, onClick: () => fn([...state.selection]) },
    icon(iconName, { size: 16 }), h('span', null, label));
  function renderSelectionBar() {
    const n = state.selection.size;
    selectionBar.hidden = n === 0;
    root.classList.toggle('has-selection', n > 0);
    if (!n) return;
    selectionCount.textContent = t('selection.count', { count: n });
    replace(selectionActions, ...(state.route.name === 'trash'
      ? [selBtn(t('actions.restore'), 'rotate-ccw', actions.restore), selBtn(t('actions.deleteForever'), 'trash', actions.deleteForever, 'danger')]
      : [
        selBtn(t('actions.favorite'), 'star', (ids) => actions.setFavorite(ids, true)),
        selBtn(t('actions.addToCollection'), 'folder-plus', (ids) => actions.addToCollection(ids)),
        selBtn(t('tags.add'), 'tag', actions.addTags),
        selBtn(t('ocr.run'), 'scan-text', actions.runOcr),
        selBtn(t('actions.exportZip'), 'archive', actions.exportZip),
        selBtn(t('actions.trash'), 'trash', actions.trash, 'danger'),
      ]));
  }

  // --- Mobile bottom nav and drawer ------------------------------------------------------
  const bottomNav = h('nav', { class: 'bottom-nav', aria: { label: t('nav.mobile') } },
    [['home', '/home', 'home', 'nav.home'], ['library', '/library', 'images', 'nav.gallery'], ['collections', '/collections', 'folder', 'nav.collections']].map(([id, path, ic, label]) =>
      h('a', { class: 'bottom-nav__item', href: `#${path}`, dataset: { nav: id } }, icon(ic, { size: 20 }), h('span', null, t(label)))),
    h('button', { type: 'button', class: 'bottom-nav__item', onClick: () => { hooks.navigate('/search'); setTimeout(() => searchInput.focus(), 50); } }, icon('search', { size: 20 }), h('span', null, t('nav.search'))),
    h('button', { type: 'button', class: 'bottom-nav__item', aria: { controls: 'sidebar' }, onClick: () => toggleDrawer(true) }, icon('more', { size: 20 }), h('span', null, t('nav.more'))));
  const fab = h('button', { type: 'button', class: 'fab', aria: { label: t('import.button') }, onClick: () => hooks.openImport() }, icon('plus', { size: 24 }));
  const scrim = h('div', { class: 'drawer-scrim', hidden: true, onClick: () => toggleDrawer(false) });

  function toggleDrawer(open) {
    root.classList.toggle('drawer-open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      sidebar.querySelector('.nav-item')?.focus();
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
  }
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) toggleDrawer(false); });
  sidebar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('drawer-open')) toggleDrawer(false); });

  const skip = h('a', { class: 'skip-link', href: '#main', onClick: (e) => { e.preventDefault(); main.focus(); } }, t('nav.skipToContent'));
  replace(root, skip, sidebar, scrim, h('div', { class: 'app__column' }, topbar, main), inspector, bottomNav, fab, selectionBar);
  root.className = 'app app--shell';
  applyCollapse();

  // --- Live state ------------------------------------------------------------------
  function activityItems() {
    const items = [];
    if (state.ocrActive) items.push({ label: t('activity.ocr', { percent: Math.round((state.ocrActive.progress ?? 0) * 100), queued: state.ocrActive.queued ?? 0 }), icon: 'scan-text', disabled: true });
    if (!items.length) items.push({ label: t('activity.none'), icon: 'check', disabled: true });
    return items;
  }
  function renderStatus() {
    onlineEl.hidden = state.online;
    activityDot.hidden = !state.ocrActive;
  }

  async function refreshCounts() {
    if (!hasRepo()) return;
    try {
      const stats = await repo().stats();
      const lang = getLanguage();
      for (const g of NAV) for (const it of g.items) {
        const v = it.count ? it.count(stats) : null;
        countEls.get(it.id).textContent = v ? formatNumber(v, lang) : '';
      }
      replace(storageEl,
        h('span', { class: 'storage-indicator__row' }, icon('hard-drive', { size: 15 }), h('span', null, t('storage.onThisDevice'))),
        h('span', { class: 'storage-indicator__value' }, t('storage.usedBy', { size: formatBytes(stats.original_bytes + stats.thumbnail_bytes, lang), count: stats.total + stats.trashed })));
      cachedSources = null;
    } catch { /* counts are optional; pages show their own errors */ }
  }
  const debouncedCounts = debounce(refreshCounts, 300);

  function setActive(routeName) {
    const id = ACTIVE_ALIASES[routeName] ?? routeName;
    for (const [nav, link] of navLinks) {
      if (nav === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const a of bottomNav.querySelectorAll('[data-nav]')) {
      if (a.dataset.nav === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function setSearchValue(q) {
    if (document.activeElement !== searchInput) searchInput.value = q ?? '';
    clearBtn.hidden = !searchInput.value;
  }

  const offs = [
    listen('library:changed', debouncedCounts),
    listen('selection:changed', renderSelectionBar),
    subscribe(['online', 'ocrActive'], renderStatus),
    subscribe(['route'], renderSelectionBar),
    subscribe(['theme'], () => replace(themeBtn, icon(themeIcon()))),
  ];
  renderStatus();
  refreshCounts();

  return {
    main,
    searchInput,
    setActive,
    setSearchValue,
    showInspector,
    hideInspector,
    focusSearch: () => { searchInput.focus(); searchInput.select(); },
    destroy: () => { offs.forEach((off) => off()); inspectorPanel?.destroy(); },
  };
}
