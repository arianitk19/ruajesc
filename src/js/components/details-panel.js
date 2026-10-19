// Editable details for one screenshot. Used by the desktop inspector and by
// the viewer's side panel. Every change is saved to the library immediately.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { CATEGORY_KEYS } from '../services/category.service.js';
import { repo } from '../services/database.service.js';
import * as shots from '../services/screenshot.service.js';
import { listen, state } from '../state.js';
import { formatBytes, formatDate, formatDimensions } from '../utils/formatting.js';
import { addToCollection, captureLabel, displayName, runOcr } from './actions.js';
import { toast, toastError } from './toast.js';
import { button, chip, select, spinner } from './ui.js';
import { tagInput } from './tag-input.js';

function metaRow(label, value, { mono = false } = {}) {
  return h('div', { class: 'meta-row' }, h('dt', null, label), h('dd', { class: mono ? 'mono-ish' : null, title: typeof value === 'string' ? value : null }, value));
}

function savingField(item, key, { multiline = false, max, label, placeholder, onSaving, onSaved, onFailed }) {
  const el = h(multiline ? 'textarea' : 'input', {
    class: multiline ? 'input textarea textarea--auto' : 'input input--title',
    maxlength: max,
    placeholder,
    rows: multiline ? 2 : null,
    aria: { label },
  });
  el.value = item[key] ?? '';
  const status = h('span', { class: 'save-status', aria: { live: 'polite' } });
  let last = item[key] ?? '';
  const save = async () => {
    if (el.value === last) return;
    status.textContent = t('details.saving');
    onSaving?.();
    try {
      const updated = await shots.updateDetails(item.id, { [key]: el.value });
      last = updated[key] ?? '';
      item[key] = last;
      onSaved?.(updated);
      status.textContent = t('details.saved');
      setTimeout(() => { if (status.textContent === t('details.saved')) status.textContent = ''; }, 1600);
    } catch (error) {
      status.textContent = '';
      onFailed?.();
      toastError(error);
    }
  };
  el.addEventListener('blur', save);
  el.addEventListener('keydown', (e) => {
    if (!multiline && e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.value = last; el.blur(); e.stopPropagation(); }
  });
  return h('div', { class: 'detail-field' }, h('div', { class: 'detail-field__label' }, h('span', null, label), status), el);
}

function ocrSection(item) {
  const status = item.ocr_status ?? 'none';
  const active = state.ocrActive?.id === item.id;
  const pill = h('span', { class: ['pill', `pill--ocr-${status}`] },
    active ? t('ocr.statusRunning', { percent: Math.round((state.ocrActive.progress ?? 0) * 100) }) : t(`ocr.status.${status}`));
  const actions = h('div', { class: 'detail-actions' });
  if (!active && status !== 'processing') {
    actions.append(button(status === 'done' ? t('ocr.rerun') : t('ocr.run'), { kind: 'secondary', size: 'sm', iconName: 'scan-text', onClick: () => runOcr([item.id]) }));
  }
  let body;
  if (status === 'done' && item.ocr_text) {
    actions.append(button(t('ocr.copyText'), { kind: 'quiet', size: 'sm', iconName: 'copy', onClick: async () => {
      try {
        await navigator.clipboard.writeText(item.ocr_text);
        toast(t('ocr.textCopied'), { kind: 'success' });
      } catch {
        toast(t('viewer.copyFailed'), { kind: 'error' });
      }
    } }));
    body = h('pre', { class: 'ocr-text', tabindex: '0' }, item.ocr_text);
  } else if (status === 'done') {
    body = h('p', { class: 'muted small' }, t('ocr.noText'));
  } else if (status === 'failed') {
    body = h('p', { class: 'error-text small' }, t('ocr.failedText'), item.ocr_error ? h('span', { class: 'block muted' }, item.ocr_error) : null);
  } else {
    body = h('p', { class: 'muted small' }, t(`ocr.hint.${status === 'pending' || status === 'processing' ? 'pending' : 'none'}`));
  }
  return h('section', { class: 'detail-section' },
    h('div', { class: 'detail-section__head' }, h('h3', null, t('ocr.title')), pill),
    body,
    actions,
    item.ocr_lang && status === 'done' ? h('p', { class: 'muted tiny' }, t('ocr.langUsed', { langs: item.ocr_lang.split('+').map((l) => t(`ocr.lang.${l}`)).join(', ') })) : null);
}

function categorySection(item) {
  const options = [{ value: '', label: t('categories.none') }, ...CATEGORY_KEYS.map((k) => ({ value: k, label: t(`categories.names.${k}`) }))];
  const control = select(options, {
    value: item.category ?? '',
    aria: { label: t('categories.title') },
    onChange: async (value) => {
      try {
        await shots.setCategory(item.id, value || null);
        toast(t('categories.updated'), { kind: 'success' });
      } catch (error) {
        toastError(error);
      }
    },
  });
  const source = item.category_source === 'user'
    ? h('p', { class: 'muted tiny' }, t('categories.setByYou'), ' ',
      h('button', { type: 'button', class: 'link-btn', onClick: () => shots.resetCategory(item.id).then(() => toast(t('categories.reset'), { kind: 'success' })).catch(toastError) }, t('categories.useSuggestion')))
    : item.category_source === 'auto' && item.category_evidence?.length
      ? h('p', { class: 'muted tiny' }, t('categories.basedOn'), ' ', item.category_evidence.map((e) => `“${e.word}”`).join(', '))
      : null;
  return h('section', { class: 'detail-section' }, h('div', { class: 'detail-section__head' }, h('h3', null, t('categories.title'))), control, source);
}

/** @returns {{el: HTMLElement, destroy: Function}} */
export function detailsPanel(id) {
  const el = h('div', { class: 'details' }, spinner());
  let item = null;
  let collections = [];
  // Edits made in this panel update it in place; reloading would rebuild the
  // fields and wipe the "Saved" confirmation.
  let ownEdits = 0;
  const categoryEl = h('div');
  const fieldHooks = {
    onSaving: () => { ownEdits++; },
    onFailed: () => { ownEdits = Math.max(0, ownEdits - 1); },
    onSaved: (updated) => {
      item = { ...item, category: updated.category, category_source: updated.category_source, category_evidence: updated.category_evidence };
      replace(categoryEl, categorySection(item));
    },
  };

  const render = () => {
    if (!item) {
      replace(el, h('p', { class: 'muted' }, t('details.notFound')));
      return;
    }
    const cols = item.collection_ids.map((cid) => collections.find((c) => c.id === cid)).filter(Boolean);
    const lang = getLanguage();
    replace(el,
      savingField(item, 'title', { label: t('details.title'), max: 200, placeholder: item.original_filename, ...fieldHooks }),
      savingField(item, 'description', { label: t('details.description'), max: 5000, multiline: true, placeholder: t('details.descriptionPlaceholder'), ...fieldHooks }),
      savingField(item, 'notes', { label: t('details.notes'), max: 10000, multiline: true, placeholder: t('details.notesPlaceholder'), ...fieldHooks }),
      h('section', { class: 'detail-section' },
        h('div', { class: 'detail-section__head' }, h('h3', null, t('tags.label'))),
        tagInput({
          value: item.tags.map((tg) => tg.name),
          suggestions: () => repo().listTags(),
          onChange: async (names) => {
            try { item.tags = await shots.setTags(item.id, names); } catch (error) { toastError(error); }
          },
        })),
      h('section', { class: 'detail-section' },
        h('div', { class: 'detail-section__head' }, h('h3', null, t('collections.title'))),
        h('div', { class: 'chip-row' },
          cols.map((c) => chip(c.name, { onClick: () => { location.hash = `#/collections/${c.id}`; } })),
          item.is_trashed ? null : h('button', { type: 'button', class: 'chip chip--add', onClick: () => addToCollection([item.id], item.collection_ids) },
            icon('plus', { size: 13 }), h('span', null, cols.length ? t('collections.change') : t('actions.addToCollection'))))),
      replace(categoryEl, categorySection(item)),
      ocrSection(item),
      h('section', { class: 'detail-section' },
        h('div', { class: 'detail-section__head' }, h('h3', null, t('details.information'))),
        h('dl', { class: 'meta-list' },
          metaRow(t('details.filename'), item.original_filename),
          metaRow(t('details.dimensions'), `${formatDimensions(item.width, item.height, lang)} px`),
          metaRow(t('details.size'), formatBytes(item.file_size, lang)),
          metaRow(t('details.type'), item.mime_type.replace('image/', '').toUpperCase()),
          metaRow(t('details.captured'), captureLabel(item)),
          metaRow(t('details.imported'), formatDate(item.imported_at, lang)),
          item.trashed_at ? metaRow(t('details.trashedAt'), formatDate(item.trashed_at, lang)) : null,
          item.content_hash ? metaRow(t('details.hash'), `${item.content_hash.slice(0, 16)}…`, { mono: true }) : null)));
  };

  const load = async () => {
    try {
      [item, collections] = await Promise.all([repo().get(id), repo().listCollections()]);
      render();
    } catch (error) {
      replace(el, h('p', { class: 'error-text' }, t(error?.i18nKey ?? 'errors.loadTitle')));
    }
  };

  // Refresh when data changes elsewhere, unless the user is typing here.
  const offLib = listen('library:changed', ({ reason }) => {
    if (reason === 'edit' && ownEdits > 0) { ownEdits--; return; }
    if (el.contains(document.activeElement) && ['edit', 'tags'].includes(reason)) return;
    load();
  });
  const offOcr = listen('ocr:progress', (d) => { if (d.id === id) load(); });
  load();
  return {
    el,
    title: () => (item ? displayName(item) : ''),
    destroy: () => { offLib(); offOcr(); },
  };
}
