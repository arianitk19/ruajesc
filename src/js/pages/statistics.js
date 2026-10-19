// Statistics from real data only. Charts appear only when there is data to show.
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { CATEGORY_KEYS } from '../services/category.service.js';
import { repo } from '../services/database.service.js';
import { ocrWholeLibrary } from '../services/ocr.service.js';
import { storageSummary } from '../services/storage.service.js';
import { listen } from '../state.js';
import { formatBytes, formatMonth, formatNumber, formatPercent } from '../utils/formatting.js';
import { toast, toastError } from '../components/toast.js';
import { button, errorState, pageHeader, spinner } from '../components/ui.js';

function barChart(rows, { label, format }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('figure', { class: 'chart' },
    h('figcaption', { class: 'chart__title' }, label),
    h('ul', { class: 'bars', role: 'list' }, rows.map((r) => h('li', { class: 'bars__row' },
      h('span', { class: 'bars__label' }, r.label),
      h('span', { class: 'bars__track', aria: { hidden: 'true' } }, h('span', { class: 'bars__fill', style: { width: `${(r.value / max) * 100}%` } })),
      h('span', { class: 'bars__value' }, format(r.value))))));
}

function columnChart(rows, { label, format }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('figure', { class: 'chart' },
    h('figcaption', { class: 'chart__title' }, label),
    h('ol', { class: 'columns', role: 'list' }, rows.map((r) => h('li', { class: 'columns__col', title: `${r.full}: ${format(r.value)}`, aria: { label: `${r.full}: ${format(r.value)}` } },
      h('span', { class: 'columns__value' }, r.value ? format(r.value) : ''),
      h('span', { class: 'columns__bar', style: { height: `${Math.max(2, (r.value / max) * 100)}%` }, aria: { hidden: 'true' } }),
      h('span', { class: 'columns__label' }, r.label)))));
}

export function render(ctx) {
  const body = h('div', { class: 'stats' }, spinner());
  const el = h('div', { class: 'page' }, pageHeader({ title: t('nav.statistics'), subtitle: t('stats.sub') }), body);
  ctx.setTitle(t('nav.statistics'));

  const load = async () => {
    try {
      const [stats, storage] = await Promise.all([repo().stats(), storageSummary()]);
      const lang = getLanguage();
      const n = (v) => formatNumber(v, lang);
      const cards = [
        { label: t('stats.total'), value: n(stats.total) },
        { label: t('stats.collections'), value: n(stats.collections) },
        { label: t('stats.favorites'), value: n(stats.favorites) },
        { label: t('stats.recent30'), value: n(stats.recent_30d) },
        { label: t('stats.totalSize'), value: formatBytes(stats.original_bytes, lang) },
        { label: t('stats.unorganized'), value: n(stats.unorganized) },
        { label: t('stats.ocrCompletion'), value: formatPercent(stats.ocr.done, stats.total, lang) },
        { label: t('stats.duplicateGroups'), value: n(stats.exact_duplicate_groups) },
      ];
      const months = [];
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push({ label: formatMonth(key, lang, { withYear: false }), full: formatMonth(key, lang), value: stats.imports_by_month.find((m) => m.month === key)?.count ?? 0 });
      }
      const categories = CATEGORY_KEYS.map((k) => ({ label: t(`categories.names.${k}`), value: stats.categories[k] ?? 0 })).filter((r) => r.value).sort((a, b) => b.value - a.value);
      const ocrRows = ['done', 'pending', 'failed', 'none'].map((k) => ({ label: t(`ocr.status.${k}`), value: stats.ocr[k] }));
      const ocrBtn = button(t('ocr.runLibrary'), { kind: 'secondary', size: 'sm', iconName: 'scan-text', onClick: async () => {
        try {
          const nq = await ocrWholeLibrary();
          toast(nq ? t('ocr.queued', { count: nq }) : t('ocr.nothingToDo'), { kind: 'info' });
        } catch (error) { toastError(error); }
      } });

      replace(body,
        h('ul', { class: 'stat-grid', role: 'list' }, cards.map((c) => h('li', { class: 'stat' },
          h('span', { class: 'stat__value' }, c.value), h('span', { class: 'stat__label' }, c.label)))),
        stats.total
          ? h('div', { class: 'chart-grid' },
            columnChart(months, { label: t('stats.importsByMonth'), format: n }),
            categories.length ? barChart(categories, { label: t('stats.byCategory'), format: n }) : null,
            h('div', null, barChart(ocrRows, { label: t('stats.ocrStatus'), format: n }), stats.ocr.none + stats.ocr.failed ? ocrBtn : null))
          : h('p', { class: 'muted' }, t('stats.noData')),
        h('section', { class: 'panel' },
          h('h2', { class: 'section-title' }, icon('hard-drive', { size: 18 }), h('span', null, t('storage.title'))),
          h('dl', { class: 'meta-list' },
            h('div', { class: 'meta-row' }, h('dt', null, t('storage.originals')), h('dd', null, formatBytes(storage.originals, lang))),
            h('div', { class: 'meta-row' }, h('dt', null, t('storage.thumbnails')), h('dd', null, formatBytes(storage.thumbnails, lang))),
            storage.device ? h('div', { class: 'meta-row' }, h('dt', null, t('storage.deviceUsage')),
              h('dd', null, t('storage.ofQuota', { used: formatBytes(storage.device.usage, lang), quota: formatBytes(storage.device.quota, lang) }))) : null),
          h('div', { class: 'explainer' },
            h('p', null, t('storage.explainOriginals')),
            h('p', null, t('storage.explainThumbs')),
            h('p', null, t('storage.explainLocal')),
            storage.device ? h('p', null, t('storage.explainEstimate')) : null)));
    } catch (error) {
      replace(body, errorState({ text: t(error?.i18nKey ?? 'errors.generic'), onRetry: load }));
    }
  };
  const off = listen('library:changed', load);
  load();
  return { el, destroy: off };
}
