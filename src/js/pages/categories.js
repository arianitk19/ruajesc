// Smart categories: transparent keyword rules, with counts from real data.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { CATEGORY_ICONS, CATEGORY_KEYS } from '../services/category.service.js';
import { repo } from '../services/database.service.js';
import { recategorizeAll } from '../services/screenshot.service.js';
import { getSettings } from '../services/settings.service.js';
import { listen } from '../state.js';
import { screenshotStack } from '../components/thumb.js';
import { toast, toastError } from '../components/toast.js';
import { button, errorState, pageHeader, skeletonGrid } from '../components/ui.js';

export function render(ctx) {
  const grid = h('div', null, skeletonGrid(6));
  const runBtn = button(t('categories.recalculate'), { kind: 'secondary', iconName: 'refresh', onClick: async () => {
    runBtn.disabled = true;
    try {
      toast(t('categories.recalculated', { count: await recategorizeAll() }), { kind: 'success' });
    } catch (error) {
      toastError(error);
    } finally {
      runBtn.disabled = false;
    }
  } });
  const el = h('div', { class: 'page' },
    pageHeader({ title: t('nav.categories'), subtitle: t('categories.sub'), actions: [runBtn] }),
    h('p', { class: 'notice notice--info' }, icon('info', { size: 16 }), h('span', null, getSettings().autoCategorize ? t('categories.howItWorks') : t('categories.disabledNote'))),
    grid);
  ctx.setTitle(t('nav.categories'));

  const load = async () => {
    try {
      const stats = await repo().stats();
      const previews = await Promise.all(CATEGORY_KEYS.map((k) =>
        (stats.categories[k] ? repo().list({ category: k, limit: 3 }).then((r) => r.items).catch(() => []) : Promise.resolve([]))));
      replace(grid, h('ul', { class: 'collection-grid', role: 'list' }, CATEGORY_KEYS.map((k, i) => h('li', null,
        h('a', { class: 'collection-card', href: `#/categories/${k}` },
          screenshotStack(previews[i], { iconName: CATEGORY_ICONS[k] }),
          h('span', { class: 'collection-card__name' }, h('span', { class: 'collection-card__icon' }, icon(CATEGORY_ICONS[k], { size: 16 })), h('span', null, t(`categories.names.${k}`))),
          h('span', { class: 'collection-card__count' }, t('common.screenshotCount', { count: stats.categories[k] ?? 0 })),
          h('span', { class: 'collection-card__desc' }, t(`categories.desc.${k}`)))))));
    } catch (error) {
      replace(grid, errorState({ text: t(error?.i18nKey ?? 'errors.generic'), onRetry: load }));
    }
  };
  const off = listen('library:changed', load);
  load();
  return { el, destroy: off };
}
