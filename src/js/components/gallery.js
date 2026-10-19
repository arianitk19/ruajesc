// Screenshot gallery: grid or list, paginated loading (60 per page with an
// IntersectionObserver plus an explicit button), multi-selection with
// Ctrl/Cmd-click, Shift-range and long-press, and keyboard navigation.
import { h, on, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { repo } from '../services/database.service.js';
import { getSettings } from '../services/settings.service.js';
import { emit, listen, setState, state, toggleSelection } from '../state.js';
import { formatBytes, formatDate, formatDimensions } from '../utils/formatting.js';
import { excerpt, fold, tokenize } from '../utils/text.js';
import { config } from '../config.js';
import { displayName, itemMenu } from './actions.js';
import { openMenu } from './menu.js';
import { thumbImage } from './thumb.js';
import { button, errorState, highlighted, skeletonGrid } from './ui.js';

const WIDE_QUERY = '(min-width: 1280px)';

/**
 * @param {{ query: () => object, empty: () => Node, onOpen: (item, ids) => void, onInspect?: (item) => void, onCount?: (total) => void }} opts
 */
export function createGallery({ query, empty, onOpen, onInspect, onCount }) {
  let items = [];
  let total = 0;
  let loading = false;
  let error = null;
  let generation = 0;
  let anchorIndex = null;
  let tokens = [];

  const listEl = h('ul', { class: 'gallery', role: 'list' });
  const footer = h('div', { class: 'gallery-footer' });
  const sentinel = h('div', { class: 'gallery-sentinel', aria: { hidden: 'true' } });
  const root = h('div', { class: 'gallery-wrap' }, skeletonGrid(), listEl, sentinel, footer);
  listEl.hidden = true;

  const layout = () => getSettings().galleryLayout;
  const applyLayout = () => {
    const s = getSettings();
    listEl.className = ['gallery', `gallery--${s.galleryLayout}`, `gallery--${s.density}`, s.thumbFit === 'contain' && 'gallery--contain', state.selecting && 'is-selecting'].filter(Boolean).join(' ');
  };

  function tile(item, index) {
    const name = displayName(item);
    const selected = state.selection.has(item.id);
    const date = item.captured_at ?? item.imported_at;
    const ocrHit = tokens.length && item.ocr_text ? excerpt(item.ocr_text, tokens, 50) : '';
    const showOcr = ocrHit && tokens.some((tk) => fold(ocrHit).includes(tk));
    const lang = getLanguage();
    return h('li', { class: ['tile', selected && 'is-selected'], dataset: { id: item.id, index: String(index) } },
      h('button', { type: 'button', class: 'tile__check', dataset: { action: 'select' }, aria: { pressed: String(selected), label: t('gallery.selectItem', { name }) } },
        icon(selected ? 'square-check' : 'square', { size: 18 })),
      h('button', { type: 'button', class: 'tile__open', dataset: { action: 'open' }, aria: { label: t('gallery.openItem', { name }) } },
        h('span', { class: 'tile__media' }, thumbImage(item, { alt: '' }),
          item.is_favorite ? h('span', { class: 'tile__fav', title: t('actions.favorite') }, icon('star', { size: 14 })) : null,
          state.ocrActive?.id === item.id ? h('span', { class: 'tile__badge' }, icon('loader', { size: 12, className: 'spin' }), t('ocr.reading')) : null),
        h('span', { class: 'tile__meta' },
          h('span', { class: 'tile__name' }, highlighted(name, tokens)),
          layout() === 'list'
            ? [
              h('span', { class: 'tile__col tile__col--date' }, formatDate(date, lang, 'short')),
              h('span', { class: 'tile__col' }, formatDimensions(item.width, item.height, lang)),
              h('span', { class: 'tile__col' }, formatBytes(item.file_size, lang)),
              h('span', { class: 'tile__col tile__col--tags' }, item.tags.slice(0, 3).map((tg) => h('span', { class: 'mini-tag' }, tg.name))),
            ]
            : h('span', { class: 'tile__sub' }, formatDate(date, lang, 'short')),
          showOcr ? h('span', { class: 'tile__ocr' }, icon('scan-text', { size: 12 }), h('span', null, highlighted(ocrHit, tokens))) : null)),
      h('button', { type: 'button', class: 'tile__more', dataset: { action: 'menu' }, aria: { label: t('gallery.moreFor', { name }), haspopup: 'menu' } }, icon('more', { size: 16 })));
  }

  function renderFooter() {
    replace(footer);
    if (error) {
      footer.append(errorState({ text: t(error), onRetry: () => load(false) }));
      return;
    }
    if (!items.length) return;
    footer.append(h('p', { class: 'gallery-footer__status', aria: { live: 'polite' } }, t('gallery.showing', { shown: items.length, total })));
    if (items.length < total) footer.append(button(loading ? t('common.loading') : t('gallery.loadMore'), { kind: 'secondary', disabled: loading, onClick: () => load(false) }));
  }

  async function load(reset) {
    if (loading && !reset) return;
    const gen = reset ? ++generation : generation;
    loading = true;
    error = null;
    renderFooter();
    const opts = query();
    tokens = tokenize(opts.query ?? '');
    try {
      const keep = reset ? Math.max(items.length, config.pageSize) : config.pageSize;
      const res = await repo().list({ ...opts, offset: reset ? 0 : items.length, limit: Math.min(keep, 1000) });
      if (gen !== generation) return;
      total = res.total;
      items = reset ? res.items : [...items, ...res.items];
      onCount?.(total);
      render(reset);
    } catch (e) {
      if (gen !== generation) return;
      error = e?.i18nKey ?? 'errors.loadTitle';
      root.querySelector('[aria-busy]')?.remove();
      listEl.hidden = items.length === 0;
    } finally {
      if (gen === generation) {
        loading = false;
        renderFooter();
      }
    }
  }

  function render(reset) {
    root.querySelector('[aria-busy]')?.remove();
    root.querySelector(':scope > .empty')?.remove();
    applyLayout();
    if (!items.length) {
      listEl.hidden = true;
      replace(listEl);
      root.insertBefore(empty(), sentinel);
      return;
    }
    listEl.hidden = false;
    if (reset) replace(listEl, ...items.map(tile));
    else {
      const start = listEl.children.length;
      listEl.append(...items.slice(start).map((it, i) => tile(it, start + i)));
    }
  }

  function updateSelectionUi() {
    for (const li of listEl.children) {
      const sel = state.selection.has(li.dataset.id);
      li.classList.toggle('is-selected', sel);
      const btn = li.querySelector('.tile__check');
      btn.setAttribute('aria-pressed', String(sel));
      replace(btn, icon(sel ? 'square-check' : 'square', { size: 18 }));
    }
    listEl.classList.toggle('is-selecting', state.selecting);
  }

  function handleSelect(index, event) {
    if (event.shiftKey && anchorIndex != null) {
      const [a, b] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
      for (let i = a; i <= b; i++) toggleSelection(items[i].id, true);
    } else {
      toggleSelection(items[index].id);
      anchorIndex = index;
    }
    setState({ selecting: state.selection.size > 0 || state.selecting });
    updateSelectionUi();
  }

  const ids = () => items.map((it) => it.id);
  const isWide = () => matchMedia(WIDE_QUERY).matches;

  on(listEl, 'click', '[data-action]', (event, target) => {
    const index = Number(target.closest('.tile').dataset.index);
    const item = items[index];
    if (!item) return;
    const action = target.dataset.action;
    if (action === 'select') return handleSelect(index, event);
    if (action === 'menu') return openMenu(target, itemMenu(item, { onOpen: () => onOpen(item, ids()) }), { label: displayName(item) });
    if (action === 'open') {
      if (event.ctrlKey || event.metaKey || event.shiftKey || state.selecting) return handleSelect(index, event);
      anchorIndex = index;
      if (onInspect && isWide() && event.detail === 1) return onInspect(item);
      onOpen(item, ids());
    }
  });
  on(listEl, 'dblclick', '[data-action="open"]', (event, target) => {
    const item = items[Number(target.closest('.tile').dataset.index)];
    if (item && onInspect && isWide() && !state.selecting) onOpen(item, ids());
  });
  on(listEl, 'contextmenu', '.tile', (event, li) => {
    const item = items[Number(li.dataset.index)];
    if (!item) return;
    event.preventDefault();
    openMenu({ x: event.clientX, y: event.clientY }, itemMenu(item, { onOpen: () => onOpen(item, ids()) }), { label: displayName(item) });
  });

  // Long-press to start selecting on touch screens.
  let pressTimer = null;
  on(listEl, 'touchstart', '.tile', (event, li) => {
    pressTimer = setTimeout(() => {
      pressTimer = null;
      navigator.vibrate?.(10);
      handleSelect(Number(li.dataset.index), event);
      li.dataset.suppressClick = '1';
    }, 450);
  }, { passive: true });
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  listEl.addEventListener('touchend', cancelPress);
  listEl.addEventListener('touchmove', cancelPress, { passive: true });
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest?.('.tile');
    if (li?.dataset.suppressClick) {
      delete li.dataset.suppressClick;
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // Arrow-key navigation between tiles.
  listEl.addEventListener('keydown', (e) => {
    const current = e.target.closest?.('.tile');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const tiles = [...listEl.children];
    const i = tiles.indexOf(current);
    const perRow = layout() === 'list' ? 1 : Math.max(1, Math.round(listEl.clientWidth / current.offsetWidth));
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + perRow, ArrowUp: i - perRow, Home: 0, End: tiles.length - 1 }[e.key];
    if (next < 0 || next >= tiles.length) return;
    e.preventDefault();
    tiles[next].querySelector('.tile__open').focus();
    if (next >= tiles.length - 4 && items.length < total) load(false);
  });

  const io = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting) && !loading && items.length < total && !error) load(false);
  }, { rootMargin: '800px 0px' });
  io.observe(sentinel);

  let refreshTimer = null;
  const offLib = listen('library:changed', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => load(true), 120);
  });
  const offSel = listen('selection:changed', updateSelectionUi);
  const offSettings = listen('settings:changed', ({ patch }) => {
    if (['galleryLayout', 'density', 'thumbFit'].some((k) => k in patch)) load(true);
  });

  load(true);

  return {
    el: root,
    reload: () => load(true),
    ids,
    total: () => total,
    selectAll: () => {
      for (const it of items) toggleSelection(it.id, true);
      setState({ selecting: true });
      emit('selection:changed', { size: state.selection.size });
    },
    destroy: () => {
      io.disconnect();
      offLib();
      offSel();
      offSettings();
      clearTimeout(refreshTimer);
    },
  };
}
