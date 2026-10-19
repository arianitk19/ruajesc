// Collections and tags.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { repo } from '../services/database.service.js';
import { libraryChanged, listen } from '../state.js';
import { fold } from '../utils/text.js';
import { confirmDialog, promptDialog } from '../components/dialog.js';
import { openMenu } from '../components/menu.js';
import { screenshotStack } from '../components/thumb.js';
import { toast, toastError } from '../components/toast.js';
import { button, emptyState, errorState, input, pageHeader, segmented, skeletonGrid } from '../components/ui.js';
import { updateQuery } from '../router.js';
import { editCollectionDialog } from './gallery.js';

export function render(ctx) {
  let tab = ctx.query.tab === 'tags' ? 'tags' : 'collections';
  const filter = input({ type: 'search', aria: { label: t('collections.search') } });
  const content = h('div', { class: 'collections-content' }, skeletonGrid(4));
  const newCollection = () => editCollectionDialog(null, { onSaved: () => libraryChanged('collections') });
  const newBtn = button(t('collections.new'), { kind: 'primary', iconName: 'folder-plus', onClick: newCollection });
  const tabs = segmented([
    { value: 'collections', label: t('collections.title') },
    { value: 'tags', label: t('tags.title') },
  ], { value: tab, label: t('collections.tabs'), onChange: (v) => { tab = v; updateQuery({ tab: v === 'tags' ? 'tags' : null }); filter.value = ''; load(); } });
  const el = h('div', { class: 'page' },
    pageHeader({ title: t('nav.collections'), subtitle: t('collections.sub'), actions: [newBtn] }),
    h('div', { class: 'toolbar' }, tabs, h('div', { class: 'toolbar__group toolbar__group--end' }, filter)),
    content);
  ctx.setTitle(t('nav.collections'));
  let data = [];

  const renderCollections = () => {
    if (!data.length) {
      replace(content, emptyState({ iconName: 'folder', title: t('collections.emptyTitle'), text: t('collections.emptyText'),
        actions: [button(t('collections.new'), { kind: 'primary', iconName: 'folder-plus', onClick: newCollection })] }));
      return;
    }
    const q = fold(filter.value.trim());
    const shown = data.filter((c) => !q || fold(`${c.name} ${c.description}`).includes(q));
    if (!shown.length) {
      replace(content, emptyState({ iconName: 'search', title: t('search.noMatches') }));
      return;
    }
    replace(content, h('ul', { class: 'collection-grid', role: 'list' }, shown.map((c) => {
      const more = h('button', { type: 'button', class: 'btn btn--quiet btn--icon collection-card__more', aria: { label: t('gallery.moreFor', { name: c.name }), haspopup: 'menu' },
        onClick: () => openMenu(more, [
          { label: t('common.open'), icon: 'eye', onClick: () => ctx.navigate(`/collections/${c.id}`) },
          { label: t('common.edit'), icon: 'pencil', onClick: () => editCollectionDialog(c, { onSaved: () => libraryChanged('collections') }) },
          { separator: true },
          { label: t('collections.delete'), icon: 'trash', danger: true, onClick: async () => {
            const ok = await confirmDialog({ title: t('collections.deleteTitle', { name: c.name }), message: t('collections.deleteText'), confirmLabel: t('collections.delete'), danger: true });
            if (!ok) return;
            try {
              await repo().deleteCollection(c.id);
              libraryChanged('collections');
              toast(t('collections.deleted', { name: c.name }), { kind: 'success' });
            } catch (error) { toastError(error); }
          } },
        ], { label: c.name }) }, icon('more', { size: 16 }));
      return h('li', { class: 'collection-item' },
        h('a', { class: 'collection-card', href: `#/collections/${c.id}` },
          screenshotStack(c.previews, { iconName: c.icon }),
          h('span', { class: 'collection-card__name' }, h('span', { class: 'collection-card__icon', style: { color: c.color } }, icon(c.icon, { size: 16 })), h('span', null, c.name)),
          h('span', { class: 'collection-card__count' }, t('common.screenshotCount', { count: c.screenshot_count })),
          c.description ? h('span', { class: 'collection-card__desc' }, c.description) : null),
        more);
    })));
  };

  const renderTags = () => {
    if (!data.length) {
      replace(content, emptyState({ iconName: 'tag', title: t('tags.emptyTitle'), text: t('tags.emptyText') }));
      return;
    }
    const q = fold(filter.value.trim());
    const shown = data.filter((tg) => !q || fold(tg.name).includes(q));
    if (!shown.length) {
      replace(content, emptyState({ iconName: 'search', title: t('search.noMatches') }));
      return;
    }
    replace(content, h('ul', { class: 'tag-table', role: 'list' }, shown.map((tg) => h('li', { class: 'tag-row' },
      h('a', { class: 'tag-row__name', href: `#/tags/${tg.id}` }, icon('tag', { size: 15 }), h('span', null, tg.name)),
      h('span', { class: 'tag-row__count' }, t('common.screenshotCount', { count: tg.screenshot_count })),
      h('span', { class: 'tag-row__actions' },
        button(t('tags.renameTitle'), { kind: 'quiet', size: 'sm', iconName: 'pencil', iconOnly: true, onClick: async () => {
          const name = await promptDialog({ title: t('tags.renameTitle'), label: t('tags.name'), value: tg.name, maxLength: 50,
            validate: (v) => (!v ? t('errors.nameRequired') : null) });
          if (!name || name === tg.name) return;
          try {
            await repo().renameTag(tg.id, name);
            libraryChanged('tags');
            toast(t('tags.renamed', { name }), { kind: 'success' });
          } catch (error) { toastError(error); }
        } }),
        button(t('tags.delete'), { kind: 'quiet', size: 'sm', iconName: 'trash', iconOnly: true, onClick: async () => {
          const ok = await confirmDialog({ title: t('tags.deleteTitle', { name: tg.name }), message: t('tags.deleteText'), confirmLabel: t('common.delete'), danger: true });
          if (!ok) return;
          try {
            await repo().deleteTag(tg.id);
            libraryChanged('tags');
            toast(t('tags.deleted', { name: tg.name }), { kind: 'success' });
          } catch (error) { toastError(error); }
        } }))))));
  };

  const load = async () => {
    newBtn.hidden = tab !== 'collections';
    filter.placeholder = tab === 'tags' ? t('tags.searchPlaceholder') : t('collections.searchPlaceholder');
    try {
      data = tab === 'tags' ? await repo().listTags() : await repo().listCollections();
      (tab === 'tags' ? renderTags : renderCollections)();
    } catch (error) {
      replace(content, errorState({ text: t(error?.i18nKey ?? 'errors.generic'), onRetry: load }));
    }
  };
  filter.addEventListener('input', () => (tab === 'tags' ? renderTags : renderCollections)());
  const off = listen('library:changed', load);
  load();
  return { el, destroy: off };
}
