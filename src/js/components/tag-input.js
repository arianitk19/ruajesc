// Tag editor: chips plus an input with suggestions from existing tags.
// Enter or comma adds a tag; Backspace in an empty input removes the last one.
import { h, replace, uid } from '../lib/dom.js';
import { t } from '../i18n/index.js';
import { fold } from '../utils/text.js';
import { normalizeTagName } from '../utils/validation.js';
import { chip } from './ui.js';

export function tagInput({ value = [], suggestions, onChange, label = t('tags.label') }) {
  let tags = [...value];
  let all = [];
  const listId = uid('tag-sugg');
  const inputEl = h('input', { class: 'tag-input__field', type: 'text', placeholder: t('tags.placeholder'), maxlength: 50,
    autocomplete: 'off', role: 'combobox', aria: { label, autocomplete: 'list', expanded: 'false', controls: listId } });
  const chipsEl = h('div', { class: 'tag-input__chips' });
  const listEl = h('ul', { class: 'tag-input__suggestions', id: listId, role: 'listbox', hidden: true });
  const root = h('div', { class: 'tag-input', onClick: (e) => { if (e.target === root || e.target === chipsEl) inputEl.focus(); } }, chipsEl, inputEl, listEl);
  let active = -1;

  const emit = () => onChange?.([...tags]);
  const render = () => {
    replace(chipsEl, ...tags.map((name) => chip(name, { onRemove: () => { tags = tags.filter((x) => x !== name); render(); emit(); } })));
  };
  const hideList = () => {
    listEl.hidden = true;
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const add = (raw) => {
    const name = normalizeTagName(raw);
    if (!name) return;
    if (!tags.some((x) => fold(x) === fold(name))) {
      tags.push(name);
      render();
      emit();
    }
    inputEl.value = '';
    hideList();
  };
  const showList = () => {
    const q = fold(inputEl.value.trim());
    const options = all.filter((s) => !tags.some((x) => fold(x) === fold(s.name)) && (!q || fold(s.name).includes(q))).slice(0, 8);
    if (!options.length) return hideList();
    replace(listEl, ...options.map((s, i) => h('li', { id: `${listId}-${i}`, role: 'option', class: 'tag-input__option',
      aria: { selected: 'false' }, onMouseDown: (e) => { e.preventDefault(); add(s.name); } }, s.name)));
    listEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  };
  const move = (delta) => {
    const opts = [...listEl.children];
    if (!opts.length || listEl.hidden) return;
    active = (active + delta + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
    inputEl.setAttribute('aria-activedescendant', opts[active].id);
  };

  inputEl.addEventListener('focus', async () => {
    try { all = (await suggestions?.()) ?? []; } catch { all = []; }
    showList();
  });
  inputEl.addEventListener('input', () => {
    if (inputEl.value.includes(',')) {
      inputEl.value.split(',').slice(0, -1).forEach(add);
      inputEl.value = inputEl.value.split(',').pop();
    }
    showList();
  });
  inputEl.addEventListener('blur', () => {
    setTimeout(hideList, 100);
    if (inputEl.value.trim()) add(inputEl.value);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const opts = [...listEl.children];
      if (active >= 0 && opts[active]) add(opts[active].textContent);
      else add(inputEl.value);
    } else if (e.key === 'Backspace' && !inputEl.value && tags.length) {
      tags.pop();
      render();
      emit();
    } else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape' && !listEl.hidden) { e.stopPropagation(); hideList(); }
  });
  render();
  return root;
}
