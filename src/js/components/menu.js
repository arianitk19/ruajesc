// Dropdown and context menus with keyboard support (arrows, Home/End, Escape).
// On narrow screens menus open as bottom action sheets.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';

let openMenuApi = null;

/**
 * @param {HTMLElement|{x:number,y:number}} anchor element, or a point for context menus
 * @param {{label?: string, icon?: string, onClick?: Function, danger?: boolean, disabled?: boolean, checked?: boolean, separator?: boolean, heading?: string, hint?: string}[]} items
 */
export function openMenu(anchor, items, { label = t('common.menu'), align = 'end' } = {}) {
  openMenuApi?.close();
  const isSheet = matchMedia('(max-width: 640px)').matches;
  const previouslyFocused = document.activeElement;
  const list = h('div', { class: ['menu', isSheet && 'menu--sheet'], role: 'menu', aria: { label }, tabindex: '-1' },
    isSheet ? h('div', { class: 'menu__grabber', aria: { hidden: 'true' } }) : null,
    items.map((it) => {
      if (it.separator) return h('div', { class: 'menu__sep', role: 'separator' });
      if (it.heading) return h('div', { class: 'menu__heading', role: 'presentation' }, it.heading);
      return h('button', {
        type: 'button',
        class: ['menu__item', it.danger && 'menu__item--danger'],
        role: it.checked != null ? 'menuitemradio' : 'menuitem',
        aria: { checked: it.checked != null ? String(Boolean(it.checked)) : null },
        disabled: it.disabled,
        onClick: () => { close(); it.onClick?.(); },
      },
      it.icon ? icon(it.icon, { size: 16 }) : (it.checked != null ? icon(it.checked ? 'check' : 'square', { size: 16, className: it.checked ? '' : 'invisible' }) : null),
      h('span', { class: 'menu__label' }, it.label),
      it.hint ? h('span', { class: 'menu__hint' }, it.hint) : null);
    }));
  const backdrop = h('div', { class: ['menu-backdrop', isSheet && 'menu-backdrop--sheet'], onMouseDown: (e) => { if (e.target === backdrop) close(); } }, list);
  document.body.append(backdrop);

  if (!isSheet) {
    const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = list.offsetWidth;
    const mh = list.offsetHeight;
    let left = align === 'end' ? rect.right - mw : rect.left;
    let top = rect.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
    left = Math.min(Math.max(8, left), innerWidth - mw - 8);
    list.style.left = `${left}px`;
    list.style.top = `${top}px`;
  }

  const buttons = () => [...list.querySelectorAll('.menu__item:not(:disabled)')];
  const focusAt = (i) => { const b = buttons(); if (b.length) b[(i + b.length) % b.length].focus(); };
  list.addEventListener('keydown', (e) => {
    const i = buttons().indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  const onScroll = (e) => { if (!list.contains(e.target)) close(); };
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  if (anchor instanceof Element) anchor.setAttribute('aria-expanded', 'true');

  focusAt(0);
  function close() {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', close);
    if (anchor instanceof Element) {
      anchor.setAttribute('aria-expanded', 'false');
      if (document.activeElement === document.body || !document.activeElement) anchor.focus();
    } else if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    if (openMenuApi?.list === list) openMenuApi = null;
  }
  openMenuApi = { close, list };
  return openMenuApi;
}

export function closeMenus() {
  openMenuApi?.close();
}
