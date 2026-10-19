// Full-screen image viewer. Loads the original on demand. Fit modes handle very
// tall screenshots ("fit width" scrolls them), zoom with buttons, Ctrl/⌘+wheel
// or pinch, drag to pan, ←/→ and swipe to move, Esc to close.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { repo } from '../services/database.service.js';
import { listen } from '../state.js';
import { formatNumber } from '../utils/formatting.js';
import { copyImage, deleteForever, displayName, downloadOriginal, itemMenu, restore, setFavorite, trash } from './actions.js';
import { detailsPanel } from './details-panel.js';
import { openMenu } from './menu.js';
import { spinner } from './ui.js';

let current = null;

function toolButton(label, iconName, onClick, extra = {}) {
  return h('button', { type: 'button', class: 'viewer__tool', title: label, aria: { label }, onClick, ...extra }, icon(iconName, { size: 18 }));
}

/** @param {{ids?: string[], onClose?: Function, onNavigate?: (id: string) => void}} opts */
export function openViewer(id, { ids = [id], onClose, onNavigate } = {}) {
  if (current) current.destroy(false);
  let index = Math.max(0, ids.indexOf(id));
  let item = null;
  let scale = 1;
  let mode = 'fit'; // fit | width | zoom
  let panel = null;
  let loadToken = 0;
  let sideOpen = matchMedia('(min-width: 900px)').matches;

  const img = h('img', { class: 'viewer__img', alt: '', draggable: 'false' });
  const stage = h('div', { class: 'viewer__stage', tabindex: '0', aria: { label: t('viewer.image') } }, img);
  const status = h('div', { class: 'viewer__status' }, spinner());
  const title = h('h2', { class: 'viewer__title', id: 'viewer-title' });
  const counter = h('span', { class: 'viewer__counter', aria: { live: 'polite' } });
  const zoomLabel = h('span', { class: 'viewer__zoom', aria: { live: 'polite' } });
  const favBtn = toolButton(t('actions.favorite'), 'star', () => item && setFavorite([item.id], !item.is_favorite));
  const side = h('aside', { class: 'viewer__side', aria: { label: t('details.panel') } });
  const prevBtn = h('button', { type: 'button', class: 'viewer__nav viewer__nav--prev', aria: { label: t('viewer.previous') }, onClick: () => go(-1) }, icon('chevron-left', { size: 24 }));
  const nextBtn = h('button', { type: 'button', class: 'viewer__nav viewer__nav--next', aria: { label: t('viewer.next') }, onClick: () => go(1) }, icon('chevron-right', { size: 24 }));
  const sideBtn = toolButton(t('viewer.toggleDetails'), 'info', () => {
    sideOpen = !sideOpen;
    root.classList.toggle('viewer--side-open', sideOpen);
    sideBtn.setAttribute('aria-pressed', String(sideOpen));
  }, { aria: { label: t('viewer.toggleDetails'), pressed: String(sideOpen) } });
  const moreBtn = toolButton(t('common.more'), 'more', () => item && openMenu(moreBtn,
    itemMenu(item).filter((m) => m.icon && !['download', 'copy', 'star', 'trash', 'eye'].includes(m.icon)), { label: displayName(item) }));
  const fullBtn = toolButton(t('viewer.fullscreen'), 'maximize', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.().catch(() => {});
  });

  const actionsEl = h('div', { class: 'viewer__actions' });
  const renderActions = () => {
    replace(actionsEl);
    if (!item) return;
    if (item.is_trashed) {
      actionsEl.append(
        toolButton(t('actions.restore'), 'rotate-ccw', async () => { if (await restore([item.id])) load(); }),
        toolButton(t('actions.download'), 'download', () => downloadOriginal(item)),
        toolButton(t('actions.deleteForever'), 'trash', async () => { if (await deleteForever([item.id])) removeCurrent(); }),
      );
    } else {
      favBtn.classList.toggle('is-on', item.is_favorite);
      favBtn.setAttribute('aria-pressed', String(item.is_favorite));
      favBtn.setAttribute('aria-label', item.is_favorite ? t('actions.unfavorite') : t('actions.favorite'));
      actionsEl.append(
        favBtn,
        toolButton(t('actions.download'), 'download', () => downloadOriginal(item)),
        toolButton(t('actions.copyImage'), 'copy', () => copyImage(item)),
        toolButton(t('actions.trash'), 'trash', async () => { if (await trash([item.id])) removeCurrent(); }),
        moreBtn,
      );
    }
  };

  const root = h('div', { class: ['viewer', sideOpen && 'viewer--side-open'], role: 'dialog', aria: { modal: 'true', labelledby: 'viewer-title' } },
    h('header', { class: 'viewer__bar' },
      toolButton(t('common.close'), 'x', () => close()),
      h('div', { class: 'viewer__heading' }, title, counter),
      h('div', { class: 'viewer__zoomgroup', role: 'group', aria: { label: t('viewer.zoomControls') } },
        toolButton(t('viewer.zoomOut'), 'zoom-out', () => zoomBy(1 / 1.25)),
        zoomLabel,
        toolButton(t('viewer.zoomIn'), 'zoom-in', () => zoomBy(1.25)),
        toolButton(t('viewer.fit'), 'minimize-2', () => setMode('fit')),
        toolButton(t('viewer.fitWidth'), 'maximize-2', () => setMode('width'))),
      actionsEl,
      fullBtn,
      sideBtn),
    h('div', { class: 'viewer__body' }, h('div', { class: 'viewer__canvas' }, stage, status, prevBtn, nextBtn), side));

  function naturalSize() {
    return { w: img.naturalWidth || item?.width || 1, h: img.naturalHeight || item?.height || 1 };
  }

  function applyTransform() {
    const { w, h: hh } = naturalSize();
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    if (mode === 'fit') scale = Math.min(sw / w, sh / hh, 1);
    else if (mode === 'width') scale = Math.min(sw / w, 1);
    img.style.width = `${Math.round(w * scale)}px`;
    img.style.height = `${Math.round(hh * scale)}px`;
    stage.classList.toggle('is-scrollable', w * scale > sw || hh * scale > sh);
    zoomLabel.textContent = formatNumber(scale, getLanguage(), { style: 'percent', maximumFractionDigits: 0 });
  }

  function setMode(m) {
    mode = m;
    applyTransform();
    if (m !== 'zoom') stage.scrollTo({ top: 0, left: 0 });
  }

  function zoomBy(factor, center) {
    const before = scale;
    mode = 'zoom';
    scale = Math.min(8, Math.max(0.05, scale * factor));
    const rect = stage.getBoundingClientRect();
    const cx = center ? center.x - rect.left : stage.clientWidth / 2;
    const cy = center ? center.y - rect.top : stage.clientHeight / 2;
    const px = (stage.scrollLeft + cx) / before;
    const py = (stage.scrollTop + cy) / before;
    applyTransform();
    stage.scrollLeft = px * scale - cx;
    stage.scrollTop = py * scale - cy;
  }

  async function load() {
    const token = ++loadToken;
    const currentId = ids[index];
    status.hidden = false;
    replace(status, spinner());
    img.removeAttribute('src');
    img.classList.add('is-loading');
    counter.textContent = ids.length > 1 ? t('viewer.counter', { index: index + 1, total: ids.length }) : '';
    prevBtn.hidden = index <= 0;
    nextBtn.hidden = index >= ids.length - 1;
    try {
      item = await repo().get(currentId);
      if (token !== loadToken) return;
      if (!item) throw Object.assign(new Error('missing'), { i18nKey: 'details.notFound' });
      title.textContent = displayName(item);
      img.alt = displayName(item);
      renderActions();
      // Thumbnail first for instant feedback, then the original.
      const thumbUrl = await repo().getThumbUrl(item).catch(() => null);
      if (token !== loadToken) return;
      if (thumbUrl) img.src = thumbUrl;
      mode = item.height / item.width > 2.2 ? 'width' : 'fit';
      applyTransform();
      const url = await repo().getOriginalUrl(item);
      if (!url) throw Object.assign(new Error('missing'), { i18nKey: 'errors.fileMissing' });
      await new Promise((resolve, reject) => {
        const pre = new Image();
        pre.onload = resolve;
        pre.onerror = reject;
        pre.src = url;
      });
      if (token !== loadToken) return;
      img.src = url;
      img.classList.remove('is-loading');
      status.hidden = true;
      applyTransform();
    } catch (error) {
      if (token !== loadToken) return;
      img.classList.remove('is-loading');
      status.hidden = false;
      replace(status, h('p', { class: 'viewer__error' }, icon('alert-triangle', { size: 20 }), h('span', null, t(error?.i18nKey ?? 'viewer.loadFailed'))));
    }
    panel?.destroy();
    panel = detailsPanel(currentId);
    replace(side, panel.el);
    onNavigate?.(currentId);
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= ids.length) return;
    index = next;
    load();
  }

  function removeCurrent() {
    ids.splice(index, 1);
    if (!ids.length) return close();
    if (index >= ids.length) index = ids.length - 1;
    load();
  }

  function onKey(e) {
    if (e.target instanceof HTMLElement && e.target.closest('.viewer__side') && e.key !== 'Escape') return;
    if (document.querySelector('dialog[open], .menu-backdrop')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(1 / 1.25);
    else if (e.key === '0') setMode('fit');
    else if (e.key.toLowerCase() === 'f' && item && !item.is_trashed) setFavorite([item.id], !item.is_favorite);
  }

  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX, y: e.clientY });
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    if (mode === 'zoom' && scale >= 1) setMode('fit');
    else zoomBy(Math.max(1, 2 * scale) / scale, { x: e.clientX, y: e.clientY });
  });

  // Drag to pan when zoomed; swipe to change image when fitted.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop, t: Date.now() };
    if (stage.classList.contains('is-scrollable') && e.pointerType === 'mouse') stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerType !== 'mouse' || !stage.classList.contains('is-scrollable')) return;
    stage.scrollLeft = drag.left - (e.clientX - drag.x);
    stage.scrollTop = drag.top - (e.clientY - drag.y);
  });
  stage.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (e.pointerType !== 'mouse' && Date.now() - drag.t < 500 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && mode !== 'zoom') go(dx < 0 ? 1 : -1);
    drag = null;
  });

  // Pinch zoom on touch screens.
  let pinch = null;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: scale };
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const target = Math.min(8, Math.max(0.05, pinch.s * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d)));
    zoomBy(target / scale, { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  }, { passive: true });
  stage.addEventListener('touchend', () => { pinch = null; });

  const onResize = () => applyTransform();
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  const offLib = listen('library:changed', ({ reason }) => {
    if (!item || !['favorite', 'restore', 'trash', 'edit', 'ocr', 'category'].includes(reason)) return;
    repo().get(item.id).then((fresh) => {
      if (!fresh) return;
      item = fresh;
      title.textContent = displayName(item);
      renderActions();
    }).catch(() => {});
  });
  const previouslyFocused = document.activeElement;
  document.body.append(root);
  document.body.classList.add('has-viewer');
  stage.focus();
  load();

  function destroy(restoreFocus = true) {
    if (!root.isConnected) return;
    loadToken++;
    panel?.destroy();
    root.remove();
    document.body.classList.remove('has-viewer');
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    offLib();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (restoreFocus && previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    if (current?.root === root) current = null;
  }
  function close() {
    destroy();
    onClose?.();
  }
  current = { root, destroy, close, get id() { return ids[index]; } };
  return current;
}

export function closeViewer() {
  current?.destroy();
  current = null;
}

export function viewerOpenFor() {
  return current?.id ?? null;
}
