// Chooses collections for one or many screenshots, with inline creation.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { repo } from '../services/database.service.js';
import { libraryChanged } from '../state.js';
import { fold } from '../utils/text.js';
import { validateCollectionName } from '../utils/validation.js';
import { openDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { button, emptyState, input, spinner } from './ui.js';

/**
 * @param {string[]} ids screenshots to assign
 * @param {{current?: string[]}} opts collection ids the (single) screenshot is already in
 */
export async function pickCollections(ids, { current = [] } = {}) {
  const single = ids.length === 1;
  const selected = new Set(single ? current : []);
  const initial = new Set(selected);
  let collections = [];
  const search = input({ type: 'search', placeholder: t('collections.searchPlaceholder'), aria: { label: t('collections.search') } });
  const list = h('ul', { class: 'picker-list', role: 'list' }, h('li', null, spinner()));
  const newName = input({ placeholder: t('collections.newPlaceholder'), maxlength: 80, aria: { label: t('collections.name') } });
  const createBtn = button(t('collections.create'), { kind: 'secondary', iconName: 'folder-plus', size: 'sm' });

  const render = () => {
    if (!collections.length) {
      replace(list, h('li', null, emptyState({ iconName: 'folder', title: t('collections.emptyTitle'), text: t('collections.pickerEmpty') })));
      return;
    }
    const q = fold(search.value.trim());
    const shown = collections.filter((c) => !q || fold(c.name).includes(q));
    if (!shown.length) {
      replace(list, h('li', { class: 'picker-none' }, t('search.noMatches')));
      return;
    }
    replace(list, ...shown.map((c) => {
      const id = `pick-${c.id}`;
      return h('li', { class: 'picker-row' },
        h('input', { type: 'checkbox', id, class: 'checkbox', checked: selected.has(c.id),
          onChange: (e) => { if (e.target.checked) selected.add(c.id); else selected.delete(c.id); } }),
        h('label', { for: id, class: 'picker-row__label' },
          h('span', { class: 'color-dot', style: { background: c.color } }),
          h('span', { class: 'picker-row__name' }, c.name),
          h('span', { class: 'picker-row__count' }, t('common.screenshotCount', { count: c.screenshot_count }))));
    }));
  };

  const load = async () => {
    try {
      collections = await repo().listCollections();
      render();
    } catch (error) {
      replace(list, h('li', null, t('errors.loadTitle')));
      toastError(error);
    }
  };

  createBtn.addEventListener('click', async () => {
    const v = validateCollectionName(newName.value);
    if (!v.ok) return toast(t(v.error, v.params), { kind: 'error' });
    try {
      createBtn.disabled = true;
      const c = await repo().createCollection({ name: v.value });
      selected.add(c.id);
      newName.value = '';
      await load();
      toast(t('collections.created', { name: c.name }), { kind: 'success' });
    } catch (error) {
      toastError(error);
    } finally {
      createBtn.disabled = false;
    }
  });
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createBtn.click(); } });
  search.addEventListener('input', render);

  return new Promise((resolve) => {
    openDialog({
      title: single ? t('collections.pickTitleOne') : t('collections.pickTitleMany', { count: ids.length }),
      size: 'md',
      body: [search, list, h('div', { class: 'picker-create' }, icon('folder-plus', { size: 16 }), newName, createBtn)],
      onClose: (v) => resolve(v ?? null),
      actions: [
        { label: t('common.cancel'), kind: 'secondary', value: null },
        {
          label: t('common.save'), kind: 'primary',
          onClick: async () => {
            try {
              const add = [...selected].filter((c) => !initial.has(c));
              const remove = single ? [...initial].filter((c) => !selected.has(c)) : [];
              for (const cid of add) await repo().addToCollection(ids, cid);
              for (const cid of remove) await repo().removeFromCollection(ids, cid);
              libraryChanged('collections');
              if (add.length || remove.length) toast(t('collections.assigned'), { kind: 'success' });
              return { add, remove };
            } catch (error) {
              toastError(error);
              return false;
            }
          },
        },
      ],
    });
    load();
  });
}
