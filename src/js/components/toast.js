// Toast notifications in a polite live region. Errors use role="alert".
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';

let region = null;

function ensureRegion() {
  if (region && document.body.contains(region)) return region;
  region = h('section', { class: 'toasts', aria: { label: t('common.notifications') } });
  document.body.append(region);
  return region;
}

const ICONS = { success: 'check-circle', error: 'alert-triangle', info: 'info', warning: 'alert-triangle' };

/**
 * @param {string} message already translated text
 * @param {{kind?: 'success'|'error'|'info'|'warning', action?: {label: string, onClick: Function}, duration?: number}} options
 */
export function toast(message, { kind = 'info', action, duration } = {}) {
  const root = ensureRegion();
  const ms = duration ?? (kind === 'error' ? 8000 : action ? 7000 : 4000);
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast--leaving');
    setTimeout(() => el.remove(), 180);
  };
  const el = h('div', { class: ['toast', `toast--${kind}`], role: kind === 'error' ? 'alert' : 'status' },
    icon(ICONS[kind] ?? 'info', { size: 18, className: 'toast__icon' }),
    h('p', { class: 'toast__text' }, message),
    action ? h('button', { type: 'button', class: 'toast__action', onClick: () => { close(); action.onClick(); } }, action.label) : null,
    h('button', { type: 'button', class: 'toast__close', aria: { label: t('common.close') }, onClick: close }, icon('x', { size: 16 })));
  root.append(el);
  if (ms > 0) {
    timer = setTimeout(close, ms);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
  }
  while (root.children.length > 4) root.firstChild.remove();
  return { close };
}

export function toastError(error, fallbackKey = 'errors.generic') {
  if (import.meta.env?.DEV) console.error(error);
  return toast(t(error?.i18nKey ?? fallbackKey), { kind: 'error' });
}
