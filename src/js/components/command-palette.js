// Command palette (Ctrl/⌘ + K): run commands or jump to screenshots.
import { debounce, h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { hasRepo, repo } from '../services/database.service.js';
import { fold, tokenize } from '../utils/text.js';
import { displayName } from './actions.js';
import { thumbImage } from './thumb.js';
import { highlighted, kbd } from './ui.js';

let open = null;

/**
 * @param {{commands: () => {id:string,label:string,icon:string,keywords?:string,hint?:string,run:Function}[], openScreenshot: (item, ids) => void, search: (q: string) => void}} opts
 */
export function openCommandPalette({ commands, openScreenshot, search }) {
  if (open) { open.focus(); return; }
  const previouslyFocused = document.activeElement;
  const inputEl = h('input', { class: 'palette__input', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    placeholder: t('palette.placeholder'), aria: { label: t('palette.label'), expanded: 'true', controls: 'palette-list', autocomplete: 'list' } });
  const listEl = h('ul', { class: 'palette__list', id: 'palette-list', role: 'listbox', aria: { label: t('palette.results') } });
  const panel = h('div', { class: 'palette', role: 'dialog', aria: { modal: 'true', label: t('palette.label') } },
    h('div', { class: 'palette__search' }, icon('search', { size: 18 }), inputEl, kbd('Esc')),
    listEl,
    h('footer', { class: 'palette__footer' }, kbd('↑', '↓'), h('span', null, t('palette.navigate')), kbd('↵'), h('span', null, t('palette.run'))));
  const backdrop = h('div', { class: 'palette-backdrop', onMouseDown: (e) => { if (e.target === backdrop) close(); } }, panel);

  let options = [];
  let active = 0;
  let shots = [];

  function optionNode(index, iconName, label, hint) {
    return h('li', { class: 'palette__option', role: 'option', id: `pal-${index}`, dataset: { index: String(index) } },
      h('span', { class: 'palette__icon' }, icon(iconName, { size: 16 })),
      h('span', { class: 'palette__label' }, label),
      hint ? h('span', { class: 'palette__hint' }, hint) : null);
  }

  const render = () => {
    const q = fold(inputEl.value.trim());
    const cmds = commands().filter((c) => !q || fold(`${c.label} ${c.keywords ?? ''}`).includes(q)).slice(0, q ? 8 : 12);
    options = [];
    const nodes = [];
    const group = (label) => nodes.push(h('li', { class: 'palette__group', role: 'presentation' }, label));
    const addCommands = () => {
      if (!cmds.length) return;
      group(t('palette.commands'));
      for (const c of cmds) {
        options.push({ run: c.run });
        nodes.push(optionNode(options.length - 1, c.icon, c.label, c.hint));
      }
    };
    // A typed command name runs that command; otherwise Enter searches.
    if (q) addCommands();
    if (inputEl.value.trim()) {
      options.push({ run: () => search(inputEl.value.trim()) });
      nodes.push(optionNode(options.length - 1, 'search', t('palette.searchFor', { query: inputEl.value.trim() })));
    }
    if (shots.length) {
      group(t('palette.screenshots'));
      const ids = shots.map((s) => s.id);
      const tokens = tokenize(inputEl.value);
      for (const s of shots) {
        options.push({ run: () => openScreenshot(s, ids) });
        nodes.push(h('li', { class: 'palette__option', role: 'option', id: `pal-${options.length - 1}`, dataset: { index: String(options.length - 1) } },
          h('span', { class: 'palette__thumb' }, thumbImage(s, { eager: true })),
          h('span', { class: 'palette__label' }, highlighted(displayName(s), tokens))));
      }
    }
    if (!q) addCommands();
    if (!options.length) nodes.push(h('li', { class: 'palette__empty', role: 'presentation' }, t('search.noMatches')));
    replace(listEl, ...nodes);
    active = Math.max(0, Math.min(active, options.length - 1));
    highlight();
  };

  function highlight() {
    for (const el of listEl.querySelectorAll('.palette__option')) {
      const isActive = Number(el.dataset.index) === active;
      el.setAttribute('aria-selected', String(isActive));
      if (isActive) el.scrollIntoView({ block: 'nearest' });
    }
    if (options.length) inputEl.setAttribute('aria-activedescendant', `pal-${active}`);
  }

  const fetchShots = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 2 || !hasRepo()) { shots = []; render(); return; }
    try {
      const res = await repo().list({ query: q, sort: 'relevance', limit: 5 });
      if (inputEl.value.trim() === q) { shots = res.items; render(); }
    } catch { /* the palette still works for commands */ }
  }, 180);

  inputEl.addEventListener('input', () => { active = 0; render(); fetchShots(); });
  inputEl.addEventListener('keydown', (e) => {
    const n = Math.max(options.length, 1);
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % n; highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % n; highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  listEl.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.palette__option');
    if (li && Number(li.dataset.index) !== active) { active = Number(li.dataset.index); highlight(); }
  });
  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('.palette__option');
    if (li) { active = Number(li.dataset.index); runActive(); }
  });

  function runActive() {
    const opt = options[active];
    if (!opt) return;
    close(false);
    opt.run();
  }
  function close(restore = true) {
    backdrop.remove();
    open = null;
    if (restore && previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  }
  document.body.append(backdrop);
  render();
  inputEl.focus();
  open = { focus: () => inputEl.focus(), close };
}

export function isPaletteOpen() {
  return Boolean(open);
}
