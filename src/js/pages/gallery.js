// One page for every screenshot list: library views, smart views, search,
// a collection, a tag, a category, and Trash.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { CATEGORY_KEYS } from '../services/category.service.js';
import { repo } from '../services/database.service.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import * as shots from '../services/screenshot.service.js';
import { clearSelection, setState, state, subscribe } from '../state.js';
import { COLLECTION_COLORS, COLLECTION_ICONS, validateCollectionName } from '../utils/validation.js';
import { createGallery } from '../components/gallery.js';
import { confirmDialog, openDialog } from '../components/dialog.js';
import { toast, toastError } from '../components/toast.js';
import { button, emptyState, errorState, field, input, pageHeader, segmented, select, textarea } from '../components/ui.js';
import { openImport } from '../components/import-dialog.js';

const VIEWS = {
  library: { view: 'all', title: 'nav.allScreenshots', empty: 'library' },
  recent: { view: 'recent', title: 'nav.recent', subtitle: 'views.recentSub', empty: 'recent' },
  favorites: { view: 'favorites', title: 'nav.favorites', subtitle: 'views.favoritesSub', empty: 'favorites' },
  uncollected: { view: 'uncollected', title: 'views.uncollected', subtitle: 'views.uncollectedSub', empty: 'uncollected' },
  ocr: { view: 'ocr', title: 'views.withOcr', subtitle: 'views.withOcrSub', empty: 'ocr' },
  large: { view: 'large', title: 'views.large', subtitle: 'views.largeSub', empty: 'large' },
  search: { view: 'all', title: 'search.title', empty: 'search' },
  trash: { view: 'trash', title: 'nav.trash', subtitle: 'trash.sub', empty: 'trash' },
  collection: { view: 'all', title: null, empty: 'collection' },
  tag: { view: 'all', title: null, empty: 'tag' },
  category: { view: 'all', title: null, empty: 'category' },
};

const SORTS = ['imported_at', 'captured_at', 'original_filename', 'file_size', 'dimensions'];

function collectionForm(initial = {}) {
  const name = input({ value: initial.name ?? '', maxlength: 80, autocomplete: 'off' });
  const description = textarea({ maxlength: 500, rows: 2 });
  description.value = initial.description ?? '';
  let color = initial.color ?? COLLECTION_COLORS[0];
  let iconName = initial.icon ?? 'folder';
  const nameField = field({ label: t('collections.name'), control: name });
  const colors = h('div', { class: 'swatches', role: 'radiogroup', aria: { label: t('collections.color') } },
    COLLECTION_COLORS.map((c) => h('button', { type: 'button', class: 'swatch', role: 'radio', aria: { checked: String(c === color), label: c }, style: { background: c },
      onClick: (e) => { color = c; for (const s of colors.children) s.setAttribute('aria-checked', String(s === e.currentTarget)); } })));
  const icons = h('div', { class: 'icon-choices', role: 'radiogroup', aria: { label: t('collections.icon') } },
    COLLECTION_ICONS.map((ic) => h('button', { type: 'button', class: 'icon-choice', role: 'radio', aria: { checked: String(ic === iconName), label: ic },
      onClick: (e) => { iconName = ic; for (const s of icons.children) s.setAttribute('aria-checked', String(s === e.currentTarget)); } }, icon(ic, { size: 18 }))));
  const el = h('form', { class: 'stack-form', onSubmit: (e) => e.preventDefault() },
    nameField,
    field({ label: t('collections.description'), control: description }),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, t('collections.color')), colors),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, t('collections.icon')), icons));
  return {
    el,
    value: () => ({ name: name.value.trim(), description: description.value.trim(), color, icon: iconName }),
    validate: () => {
      const v = validateCollectionName(name.value);
      nameField.setError(v.ok ? null : t(v.error, v.params));
      if (!v.ok) name.focus();
      return v.ok;
    },
  };
}

export function editCollectionDialog(collection, { onSaved } = {}) {
  const form = collectionForm(collection ?? {});
  openDialog({
    title: collection ? t('collections.editTitle') : t('collections.newTitle'),
    body: form.el,
    actions: [
      { label: t('common.cancel'), kind: 'secondary' },
      {
        label: collection ? t('common.save') : t('collections.create'), kind: 'primary',
        onClick: async () => {
          if (!form.validate()) return false;
          try {
            const saved = collection ? await repo().updateCollection(collection.id, form.value()) : await repo().createCollection(form.value());
            toast(t(collection ? 'collections.saved' : 'collections.created', { name: saved.name }), { kind: 'success' });
            onSaved?.(saved);
            return true;
          } catch (error) {
            toastError(error);
            return false;
          }
        },
      },
    ],
  });
}

function emptyFor(kind, ctx) {
  const importBtn = button(t('import.button'), { kind: 'primary', iconName: 'upload', onClick: () => openImport() });
  const map = {
    library: { iconName: 'images', title: t('empty.libraryTitle'), text: t('empty.libraryText'), actions: [importBtn] },
    recent: { iconName: 'clock', title: t('empty.recentTitle'), text: t('empty.recentText'), actions: [importBtn] },
    favorites: { iconName: 'star', title: t('empty.favoritesTitle'), text: t('empty.favoritesText') },
    uncollected: { iconName: 'folder', title: t('empty.uncollectedTitle'), text: t('empty.uncollectedText') },
    ocr: { iconName: 'scan-text', title: t('empty.ocrTitle'), text: t('empty.ocrText') },
    large: { iconName: 'hard-drive', title: t('empty.largeTitle'), text: t('empty.largeText') },
    search: ctx.query.q
      ? { iconName: 'search', title: t('empty.searchTitle', { query: ctx.query.q }), text: t('empty.searchText') }
      : { iconName: 'search', title: t('search.prompt') },
    trash: { iconName: 'trash', title: t('empty.trashTitle'), text: t('empty.trashText') },
    collection: { iconName: 'folder', title: t('empty.collectionTitle'), text: t('empty.collectionText'),
      actions: [button(t('nav.allScreenshots'), { kind: 'secondary', onClick: () => ctx.navigate('/library') })] },
    tag: { iconName: 'tag', title: t('empty.tagTitle'), text: t('empty.tagText') },
    category: { iconName: 'sparkles', title: t('empty.categoryTitle'), text: t('empty.categoryText') },
  };
  return emptyState(map[kind]);
}

export function render(ctx) {
  const name = ctx.route.name;
  const def = VIEWS[name] ?? VIEWS.library;
  const q = ctx.query.q ?? '';
  const isSearch = name === 'search';
  let sort = name === 'trash' ? 'trashed_at' : (isSearch && q ? 'relevance' : getSettings().sort);
  let dir = name === 'trash' ? 'desc' : getSettings().dir;
  let favoriteOnly = false;
  let entity = null;

  const titleEl = h('div');
  const countEl = h('span', { class: 'toolbar__count', aria: { live: 'polite' } });
  const page = h('div', { class: 'page page--gallery' }, titleEl);

  const gallery = createGallery({
    query: () => ({
      view: def.view,
      query: q,
      sort,
      dir,
      collectionId: name === 'collection' ? ctx.params.id : null,
      tagId: name === 'tag' ? ctx.params.id : null,
      category: name === 'category' ? ctx.params.key : null,
      favorite: favoriteOnly ? true : null,
    }),
    empty: () => emptyFor(def.empty, ctx),
    onOpen: (item, ids) => ctx.openViewer(item, ids),
    onInspect: (item) => ctx.shell.showInspector(item, () => ctx.openViewer(item, gallery.ids())),
    onCount: (total) => { countEl.textContent = t('common.screenshotCount', { count: total }); },
  });

  // Toolbar ------------------------------------------------------------------------
  const sortSelect = select([
    ...(isSearch && q ? [{ value: 'relevance', label: t('sort.relevance') }] : []),
    ...(name === 'trash' ? [{ value: 'trashed_at', label: t('sort.trashed_at') }] : []),
    ...SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) })),
  ], {
    value: sort,
    aria: { label: t('sort.label') },
    onChange: (v) => {
      sort = v;
      if (!['relevance', 'trashed_at'].includes(v)) updateSettings({ sort: v });
      gallery.reload();
    },
  });
  const dirLabel = () => t(dir === 'asc' ? 'sort.ascending' : 'sort.descending');
  const dirBtn = h('button', { type: 'button', class: ['btn btn--quiet btn--icon', dir === 'asc' && 'is-flipped'], aria: { label: dirLabel() }, title: dirLabel(),
    onClick: () => {
      dir = dir === 'asc' ? 'desc' : 'asc';
      if (name !== 'trash') updateSettings({ dir });
      dirBtn.setAttribute('aria-label', dirLabel());
      dirBtn.title = dirLabel();
      dirBtn.classList.toggle('is-flipped', dir === 'asc');
      gallery.reload();
    } }, icon('arrow-down-up'));

  const layoutToggle = segmented([
    { value: 'grid', icon: 'layout-grid', title: t('gallery.grid') },
    { value: 'list', icon: 'list', title: t('gallery.list') },
  ], { value: getSettings().galleryLayout, label: t('gallery.layout'), onChange: (v) => updateSettings({ galleryLayout: v }) });

  const selectBtn = button(t('selection.select'), { kind: 'quiet', size: 'sm', iconName: 'square-check', onClick: () => {
    if (state.selecting) clearSelection();
    else setState({ selecting: true });
    gallery.el.querySelector('.gallery')?.classList.toggle('is-selecting', state.selecting);
  } });
  const selectAllBtn = button(t('selection.selectAllShown'), { kind: 'quiet', size: 'sm', onClick: () => gallery.selectAll() });
  selectAllBtn.hidden = !state.selecting;
  const offSelecting = subscribe('selecting', (on) => { selectAllBtn.hidden = !on; });

  const favToggle = name === 'favorites' || name === 'trash' ? null : h('button', { type: 'button', class: 'btn btn--quiet btn--sm filter-chip', aria: { pressed: 'false' },
    onClick: () => {
      favoriteOnly = !favoriteOnly;
      favToggle.setAttribute('aria-pressed', String(favoriteOnly));
      gallery.reload();
    } }, icon('star', { size: 15 }), h('span', null, t('filters.favoritesOnly')));

  page.append(
    h('div', { class: 'toolbar', role: 'toolbar', aria: { label: t('gallery.toolbar') } },
      countEl,
      h('div', { class: 'toolbar__group' }, favToggle, selectBtn, selectAllBtn),
      h('div', { class: 'toolbar__group toolbar__group--end' }, sortSelect, dirBtn, layoutToggle)),
    gallery.el);

  // Header ---------------------------------------------------------------------------
  const headerActions = [];
  if (name === 'trash') {
    headerActions.push(
      button(t('trash.restoreAll'), { kind: 'secondary', iconName: 'rotate-ccw', onClick: async () => {
        try {
          const n = await shots.restoreAll();
          toast(t('actions.restored', { count: n }), { kind: 'success' });
        } catch (error) { toastError(error); }
      } }),
      button(t('trash.empty'), { kind: 'danger', iconName: 'trash', onClick: async () => {
        const total = gallery.total();
        if (!total) return;
        const ok = await confirmDialog({ title: t('trash.emptyTitle', { count: total }), message: t('trash.emptyText'), confirmLabel: t('trash.empty'), danger: true });
        if (!ok) return;
        try {
          const { deleted } = await shots.emptyTrash();
          toast(t('actions.deleted', { count: deleted.length }), { kind: 'success' });
        } catch (error) { toastError(error); }
      } }),
    );
  }

  const renderHeader = () => {
    let title = def.title ? t(def.title) : '';
    let subtitle = def.subtitle ? t(def.subtitle) : null;
    let back = null;
    const actions = [...headerActions];
    if (isSearch) {
      title = q ? t('search.resultsFor', { query: q }) : t('search.title');
      subtitle = t('search.scope');
    }
    if (name === 'collection' && entity) {
      back = { href: '#/collections', label: t('nav.collections') };
      title = entity.name;
      subtitle = entity.description || null;
      actions.push(
        button(t('common.edit'), { kind: 'secondary', iconName: 'pencil', onClick: () => editCollectionDialog(entity, { onSaved: (c) => { entity = { ...entity, ...c }; renderHeader(); } }) }),
        button(t('collections.delete'), { kind: 'quiet', iconName: 'trash', onClick: async () => {
          const ok = await confirmDialog({ title: t('collections.deleteTitle', { name: entity.name }), message: t('collections.deleteText'), confirmLabel: t('collections.delete'), danger: true });
          if (!ok) return;
          try {
            await repo().deleteCollection(entity.id);
            toast(t('collections.deleted', { name: entity.name }), { kind: 'success' });
            ctx.navigate('/collections');
          } catch (error) { toastError(error); }
        } }),
      );
    }
    if (name === 'tag' && entity) {
      back = { href: '#/collections?tab=tags', label: t('tags.title') };
      title = `#${entity.name}`;
    }
    if (name === 'category') {
      back = { href: '#/categories', label: t('nav.categories') };
      title = t(`categories.names.${ctx.params.key}`);
      subtitle = t(`categories.desc.${ctx.params.key}`);
    }
    const header = pageHeader({ title, subtitle, actions, back });
    if (name === 'collection' && entity) {
      header.querySelector('.page-title').prepend(h('span', { class: 'title-icon', style: { color: entity.color } }, icon(entity.icon, { size: 22 })));
    }
    replace(titleEl, header);
    ctx.setTitle(title);
  };

  const notFound = () => {
    gallery.destroy();
    replace(page, errorState({ title: t('errors.notFoundTitle'), text: t('errors.notFoundText') }));
  };
  if (name === 'category' && !CATEGORY_KEYS.includes(ctx.params.key)) notFound();
  else if (name === 'collection' || name === 'tag') {
    (async () => {
      try {
        entity = name === 'collection'
          ? await repo().getCollection(ctx.params.id)
          : (await repo().listTags()).find((tg) => tg.id === ctx.params.id) ?? null;
      } catch (error) { toastError(error); }
      if (!entity) notFound();
      else renderHeader();
    })();
  } else renderHeader();

  return {
    el: page,
    destroy: () => { gallery.destroy(); offSelecting(); clearSelection(); },
  };
}
