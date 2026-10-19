// Shared UI primitives. Each returns a DOM node; none uses innerHTML.
import { h, uid } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { highlightSegments } from '../utils/text.js';

export function button(label, { kind = 'secondary', size, iconName, iconOnly = false, onClick, type = 'button', attrs = {}, disabled } = {}) {
  const cls = ['btn', `btn--${kind}`, size && `btn--${size}`, iconOnly && 'btn--icon'];
  return h('button', {
    type, class: cls, onClick, disabled,
    ...(iconOnly ? { aria: { label }, title: label } : {}),
    ...attrs,
  }, iconName ? icon(iconName, { size: size === 'sm' ? 16 : 18 }) : null, iconOnly ? null : h('span', null, label));
}

export function field({ label, hint, error, control, id = uid('f') }) {
  control.id = control.id || id;
  const hintId = hint ? `${control.id}-hint` : null;
  const errId = `${control.id}-err`;
  control.setAttribute('aria-describedby', [hintId, errId].filter(Boolean).join(' '));
  const err = h('p', { class: 'field__error', id: errId, role: 'alert', hidden: !error }, error ?? '');
  const wrap = h('div', { class: 'field' },
    label ? h('label', { class: 'field__label', for: control.id }, label) : null,
    control,
    hint ? h('p', { class: 'field__hint', id: hintId }, hint) : null,
    err);
  wrap.setError = (message) => {
    err.textContent = message ?? '';
    err.hidden = !message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
  };
  return wrap;
}

export function input(props = {}) {
  return h('input', { class: 'input', type: 'text', ...props });
}

export function textarea(props = {}) {
  return h('textarea', { class: 'input textarea', rows: 3, ...props });
}

export function select(options, { value, onChange, ...props } = {}) {
  return h('select', { class: 'input select', onChange: (e) => onChange?.(e.target.value, e), ...props },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

/** Accessible switch built on a native checkbox. */
export function toggle({ label, description, checked, onChange, id = uid('sw'), disabled }) {
  const box = h('input', { type: 'checkbox', class: 'switch__input', id, checked, disabled, role: 'switch',
    onChange: (e) => onChange?.(e.target.checked) });
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-row__text' },
      h('label', { for: id, class: 'setting-row__label' }, label),
      description ? h('p', { class: 'setting-row__desc' }, description) : null),
    h('span', { class: 'switch' }, box, h('span', { class: 'switch__track', aria: { hidden: 'true' } })));
}

export function segmented(options, { value, onChange, label }) {
  const name = uid('seg');
  return h('div', { class: 'segmented', role: 'radiogroup', aria: { label } },
    options.map((o) => {
      const id = uid('seg-o');
      return h('span', { class: 'segmented__item' },
        h('input', { type: 'radio', name, id, value: o.value, checked: o.value === value, onChange: () => onChange(o.value) }),
        h('label', { for: id, title: o.title ?? null }, o.icon ? icon(o.icon, { size: 16 }) : null, o.label ? h('span', null, o.label) : null));
    }));
}

export function chip(text, { onRemove, kind, iconName, onClick, title } = {}) {
  const tag = onClick ? 'button' : 'span';
  return h(tag, { class: ['chip', kind && `chip--${kind}`], type: onClick ? 'button' : null, onClick, title },
    iconName ? icon(iconName, { size: 13 }) : null,
    h('span', { class: 'chip__text' }, text),
    onRemove ? h('button', { type: 'button', class: 'chip__remove', aria: { label: t('tags.remove', { name: text }) },
      onClick: (e) => { e.stopPropagation(); onRemove(); } }, icon('x', { size: 12 })) : null);
}

export function spinner(label = t('common.loading')) {
  return h('span', { class: 'spinner', role: 'status', aria: { label } }, icon('loader', { size: 18, className: 'spin' }));
}

export function progressBar(value, { label } = {}) {
  const bar = h('div', { class: 'progress', role: 'progressbar', aria: { valuemin: 0, valuemax: 100, valuenow: Math.round(value * 100), label } },
    h('span', { class: 'progress__fill', style: { width: `${Math.round(value * 100)}%` } }));
  bar.set = (v) => {
    bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    bar.firstChild.style.width = `${Math.round(v * 100)}%`;
  };
  return bar;
}

export function emptyState({ iconName = 'images', title, text, actions = [], headingLevel = 2 }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon(iconName, { size: 26 })),
    h(`h${headingLevel}`, { class: 'empty__title', tabindex: headingLevel === 1 ? '-1' : null }, title),
    text ? h('p', { class: 'empty__text' }, text) : null,
    actions.length ? h('div', { class: 'empty__actions' }, actions) : null);
}

export function errorState({ title = t('errors.loadTitle'), text, onRetry }) {
  return h('div', { class: 'empty empty--error', role: 'alert' },
    h('div', { class: 'empty__icon' }, icon('alert-triangle', { size: 26 })),
    h('h2', { class: 'empty__title' }, title),
    text ? h('p', { class: 'empty__text' }, text) : null,
    onRetry ? h('div', { class: 'empty__actions' }, button(t('common.retry'), { kind: 'secondary', iconName: 'refresh', onClick: onRetry })) : null);
}

export function skeletonGrid(count = 12) {
  return h('div', { class: 'gallery gallery--grid', aria: { busy: 'true', label: t('common.loading') } },
    Array.from({ length: count }, () => h('div', { class: 'tile tile--skeleton' },
      h('div', { class: 'tile__media skeleton' }),
      h('div', { class: 'tile__meta' }, h('span', { class: 'skeleton skeleton--line' }), h('span', { class: 'skeleton skeleton--line skeleton--short' })))));
}

/** Renders text with search matches wrapped in <mark>, safely. */
export function highlighted(text, tokens) {
  return highlightSegments(text, tokens).map((seg) => (seg.match ? h('mark', { class: 'hl' }, seg.text) : seg.text));
}

export function pageHeader({ title, subtitle, actions = [], back }) {
  return h('header', { class: 'page-header' },
    h('div', { class: 'page-header__text' },
      back ? h('a', { class: 'page-back', href: back.href }, icon('chevron-left', { size: 16 }), h('span', null, back.label)) : null,
      h('h1', { class: 'page-title', tabindex: '-1' }, title),
      subtitle ? h('p', { class: 'page-sub' }, subtitle) : null),
    actions.length ? h('div', { class: 'page-header__actions' }, actions) : null);
}

export function kbd(...keys) {
  return h('span', { class: 'kbd-group' }, keys.map((k) => h('kbd', { class: 'kbd' }, k)));
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
