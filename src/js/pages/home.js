// Home: what's new, quick ways into the library, real counts, and a reminder
// to back up — the library lives only in this browser.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { backupIsDue, getLastBackup } from '../services/backup.service.js';
import { repo } from '../services/database.service.js';
import { getSettings } from '../services/settings.service.js';
import { listen } from '../state.js';
import { formatBytes, formatDate, formatNumber } from '../utils/formatting.js';
import { displayName } from '../components/actions.js';
import { openImport } from '../components/import-dialog.js';
import { screenshotStack, thumbImage } from '../components/thumb.js';
import { button, emptyState, errorState, spinner } from '../components/ui.js';

function greeting() {
  const hour = new Date().getHours();
  return t(`home.greeting.${hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`);
}

export function render(ctx) {
  const el = h('div', { class: 'page page--home' }, spinner());
  ctx.setTitle(t('nav.home'));

  const load = async () => {
    try {
      const r = repo();
      const [stats, recent, collections, due, last] = await Promise.all([
        r.stats(),
        r.list({ view: 'all', sort: 'imported_at', dir: 'desc', limit: 10 }),
        r.listCollections(),
        getSettings().backupReminder ? backupIsDue() : false,
        getLastBackup(),
      ]);
      const lang = getLanguage();
      const fmt = (n) => formatNumber(n, lang);

      if (!stats.total && !stats.trashed) {
        replace(el,
          h('header', { class: 'home-hero' }, h('div', null, h('h1', { class: 'page-title', tabindex: '-1' }, greeting()), h('p', { class: 'page-sub' }, t('home.emptyLead')))),
          emptyState({
            iconName: 'image-plus',
            title: t('empty.libraryTitle'),
            text: t('home.emptyText'),
            actions: [button(t('import.button'), { kind: 'primary', iconName: 'upload', onClick: () => openImport() }),
              button(t('nav.help'), { kind: 'secondary', iconName: 'help', onClick: () => ctx.navigate('/help') })],
          }));
        return;
      }

      const reminder = due ? h('div', { class: 'notice notice--warning reminder', role: 'status' },
        icon('archive', { size: 16 }),
        h('div', { class: 'reminder__text' },
          h('p', { class: 'reminder__title' }, t('backup.reminderTitle')),
          h('p', null, last ? t('backup.reminderSince', { date: formatDate(last.at, lang, 'short') }) : t('backup.reminderNever'))),
        button(t('backup.exportFull'), { kind: 'secondary', size: 'sm', onClick: () => ctx.navigate('/backup') })) : null;

      const summary = [
        { label: t('stats.total'), value: fmt(stats.total), href: '#/library' },
        { label: t('stats.recent7'), value: fmt(stats.recent_7d), href: '#/recent' },
        { label: t('stats.unorganized'), value: fmt(stats.unorganized), href: '#/uncollected' },
        { label: t('stats.ocrDone'), value: fmt(stats.ocr.done), href: '#/ocr' },
      ];
      const smart = [
        { href: '#/uncollected', icon: 'folder', title: t('views.uncollected'), text: t('views.uncollectedSub') },
        { href: '#/ocr', icon: 'scan-text', title: t('views.withOcr'), text: t('views.withOcrSub') },
        { href: '#/large', icon: 'hard-drive', title: t('views.large'), text: t('views.largeSub') },
        { href: '#/duplicates', icon: 'layers', title: t('views.duplicates'),
          text: stats.exact_duplicate_groups ? t('views.duplicatesFound', { count: stats.exact_duplicate_groups }) : t('views.duplicatesSub') },
      ];

      replace(el,
        h('header', { class: 'home-hero' },
          h('div', null,
            h('h1', { class: 'page-title', tabindex: '-1' }, greeting()),
            h('p', { class: 'page-sub' }, t('home.lead', { count: stats.total, size: formatBytes(stats.original_bytes, lang) }))),
          button(t('import.button'), { kind: 'primary', iconName: 'upload', onClick: () => openImport() })),
        reminder,
        h('ul', { class: 'summary-strip', role: 'list' },
          summary.map((s) => h('li', null, h('a', { class: 'summary-item', href: s.href },
            h('span', { class: 'summary-item__value' }, s.value), h('span', { class: 'summary-item__label' }, s.label))))),
        recent.items.length ? h('section', { class: 'home-section', aria: { labelledby: 'home-recent' } },
          h('div', { class: 'section-head' }, h('h2', { id: 'home-recent', class: 'section-title' }, t('home.recentTitle')),
            h('a', { class: 'section-link', href: '#/recent' }, t('home.seeAll'))),
          h('ul', { class: 'recent-strip', role: 'list' }, recent.items.map((it) => h('li', null,
            h('button', { type: 'button', class: 'recent-card', aria: { label: t('gallery.openItem', { name: displayName(it) }) },
              onClick: () => ctx.openViewer(it, recent.items.map((x) => x.id)) },
            h('span', { class: 'recent-card__media' }, thumbImage(it)),
            h('span', { class: 'recent-card__name' }, displayName(it))))))) : null,
        collections.length ? h('section', { class: 'home-section', aria: { labelledby: 'home-cols' } },
          h('div', { class: 'section-head' }, h('h2', { id: 'home-cols', class: 'section-title' }, t('collections.title')),
            h('a', { class: 'section-link', href: '#/collections' }, t('home.seeAll'))),
          h('ul', { class: 'collection-grid collection-grid--compact', role: 'list' }, collections.slice(0, 4).map((c) => h('li', null,
            h('a', { class: 'collection-card', href: `#/collections/${c.id}` },
              screenshotStack(c.previews, { iconName: c.icon }),
              h('span', { class: 'collection-card__name' }, h('span', { class: 'color-dot', style: { background: c.color } }), h('span', null, c.name)),
              h('span', { class: 'collection-card__count' }, t('common.screenshotCount', { count: c.screenshot_count }))))))) : null,
        h('section', { class: 'home-section', aria: { labelledby: 'home-smart' } },
          h('div', { class: 'section-head' }, h('h2', { id: 'home-smart', class: 'section-title' }, t('home.smartTitle'))),
          h('ul', { class: 'smart-grid', role: 'list' }, smart.map((s) => h('li', null,
            h('a', { class: 'smart-card', href: s.href }, h('span', { class: 'smart-card__icon' }, icon(s.icon, { size: 18 })),
              h('span', { class: 'smart-card__title' }, s.title), h('span', { class: 'smart-card__text' }, s.text)))))));
    } catch (error) {
      replace(el, errorState({ text: t(error?.i18nKey ?? 'errors.generic'), onRetry: load }));
    }
  };
  let timer;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 200); };
  const offs = [listen('library:changed', refresh), listen('backup:done', refresh)];
  load();
  return { el, destroy: () => { offs.forEach((o) => o()); clearTimeout(timer); } };
}
