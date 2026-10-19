// Dialogs on the native <dialog> element: focus trapping, Escape and the
// inert background come from the browser. On phones they render as sheets.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { button, field, input } from './ui.js';

const stack = [];

/**
 * @param {{title: string, description?: string, body?: Node|Node[], actions?: object[], size?: 'sm'|'md'|'lg', onClose?: Function, dismissable?: boolean}} opts
 */
export function openDialog({ title, description, body, actions = [], size = 'md', onClose, dismissable = true }) {
  const previouslyFocused = document.activeElement;
  const n = stack.length + 1;
  const titleId = `dlg-title-${n}`;
  const descId = description ? `dlg-desc-${n}` : null;
  const footer = h('footer', { class: 'modal__footer' });
  const el = h('dialog', { class: ['modal', `modal--${size}`], aria: { labelledby: titleId, describedby: descId } },
    h('div', { class: 'modal__panel' },
      h('header', { class: 'modal__header' },
        h('div', null,
          h('h2', { class: 'modal__title', id: titleId }, title),
          description ? h('p', { class: 'modal__desc', id: descId }, description) : null),
        dismissable ? h('button', { type: 'button', class: 'btn btn--quiet btn--icon modal__close', aria: { label: t('common.close') },
          onClick: () => close(null) }, icon('x')) : null),
      h('div', { class: 'modal__body' }, body),
      footer));

  let closed = false;
  let result = null;
  function close(value) {
    if (closed) return;
    closed = true;
    result = value;
    el.close();
  }
  el.addEventListener('close', () => {
    closed = true;
    el.remove();
    stack.splice(stack.indexOf(api), 1);
    onClose?.(result);
    if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
  });
  el.addEventListener('cancel', (e) => { if (!dismissable) e.preventDefault(); });
  el.addEventListener('mousedown', (e) => { if (e.target === el && dismissable) close(null); });

  const setActions = (list) => {
    replace(footer, ...list.map((a) => {
      const b = button(a.label, { kind: a.kind ?? 'secondary', iconName: a.icon, disabled: a.disabled,
        onClick: async () => {
          if (!a.onClick) return close(a.value ?? null);
          b.disabled = true;
          try {
            const r = await a.onClick(api);
            if (r !== false && a.closes !== false) close(a.value ?? r ?? null);
          } finally {
            b.disabled = false;
          }
        } });
      if (a.autofocus) b.setAttribute('autofocus', '');
      if (a.id) b.dataset.action = a.id;
      return b;
    }));
    footer.hidden = list.length === 0;
  };
  setActions(actions);

  const api = { el, close, setActions, footer };
  stack.push(api);
  document.body.append(el);
  el.showModal();
  const auto = el.querySelector('[autofocus]') ?? el.querySelector('.modal__body input, .modal__body textarea, .modal__body select');
  (auto ?? el.querySelector('.modal__close') ?? el).focus?.();
  return api;
}

/** @returns {Promise<boolean>} */
export function confirmDialog({ title, message, confirmLabel = t('common.confirm'), cancelLabel = t('common.cancel'), danger = false, requireText = null }) {
  return new Promise((resolve) => {
    const nodes = [h('p', { class: 'modal__text' }, message)];
    let typed = null;
    if (requireText) {
      typed = input({ autocomplete: 'off', spellcheck: false });
      nodes.push(field({ label: t('common.typeToConfirm', { text: requireText }), control: typed }));
    }
    const dlg = openDialog({
      title,
      size: 'sm',
      body: nodes,
      onClose: (v) => resolve(v === true),
      actions: [
        { label: cancelLabel, kind: 'secondary', value: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true, autofocus: !requireText, id: 'confirm', disabled: Boolean(requireText) },
      ],
    });
    if (typed) {
      const confirmBtn = dlg.footer.querySelector('[data-action="confirm"]');
      typed.addEventListener('input', () => { confirmBtn.disabled = typed.value.trim() !== requireText; });
    }
  });
}

/** @returns {Promise<string|null>} */
export function promptDialog({ title, label, value = '', confirmLabel = t('common.save'), validate, maxLength = 200 }) {
  return new Promise((resolve) => {
    const control = input({ value, maxlength: maxLength, autocomplete: 'off' });
    const wrap = field({ label, control });
    let dlg;
    const submit = () => {
      const v = control.value.trim();
      const err = validate?.(v);
      if (err) {
        wrap.setError(err);
        control.focus();
        return;
      }
      dlg.close(v);
    };
    const form = h('form', { class: 'stack-form', onSubmit: (e) => { e.preventDefault(); submit(); } }, wrap);
    dlg = openDialog({
      title, size: 'sm', body: form,
      onClose: (v) => resolve(typeof v === 'string' ? v : null),
      actions: [
        { label: t('common.cancel'), kind: 'secondary', value: null },
        { label: confirmLabel, kind: 'primary', closes: false, onClick: () => { submit(); return false; } },
      ],
    });
    control.select();
  });
}

export function closeAllDialogs() {
  for (const d of [...stack].reverse()) d.close(null);
}

export function hasOpenDialog() {
  return stack.length > 0;
}
