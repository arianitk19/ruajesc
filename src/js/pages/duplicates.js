// Duplicate review. Shows exact and visually similar groups side by side;
// the user picks what to keep and the rest moves to Trash (recoverable).
import { h, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { findDuplicates, keepAll, resolveGroup } from '../services/duplicate.service.js';
import { getSettings } from '../services/settings.service.js';
import { formatBytes, formatDate, formatDimensions, formatNumber } from '../utils/formatting.js';
import { displayName } from '../components/actions.js';
import { thumbImage } from '../components/thumb.js';
import { toast, toastError } from '../components/toast.js';
import { button, emptyState, errorState, pageHeader, progressBar, toggle } from '../components/ui.js';

export function render(ctx) {
  let controller = null;
  let groups = [];
  let showReviewed = false;
  let similar = true;
  const content = h('div', { class: 'dup-content' });
  const bar = progressBar(0, { label: t('duplicates.scanning') });
  const statusText = h('p', { class: 'muted', aria: { live: 'polite' } });
  const scanBtn = button(t('duplicates.scan'), { kind: 'secondary', iconName: 'scan-search', onClick: () => scan() });
  const cancelBtn = button(t('common.cancel'), { kind: 'quiet', onClick: () => controller?.abort() });
  const progressWrap = h('div', { class: 'scan-progress', hidden: true }, bar, statusText, cancelBtn);
  const options = h('div', { class: 'dup-options' },
    toggle({ label: t('duplicates.includeSimilar'), description: t('duplicates.includeSimilarHint', { n: getSettings().similarThreshold }), checked: similar, onChange: (v) => { similar = v; scan(); } }),
    toggle({ label: t('duplicates.showReviewed'), checked: showReviewed, onChange: (v) => { showReviewed = v; renderGroups(); } }));
  const el = h('div', { class: 'page' },
    pageHeader({ title: t('nav.duplicates'), subtitle: t('duplicates.sub'), actions: [scanBtn] }),
    h('p', { class: 'notice notice--info' }, icon('shield-check', { size: 16 }), h('span', null, t('duplicates.safety'))),
    options, progressWrap, content);
  ctx.setTitle(t('nav.duplicates'));

  function groupCard(group) {
    const lang = getLanguage();
    // Suggest keeping the highest-resolution, then largest image.
    // Suggest the copy worth keeping: highest resolution, then lossless PNG over
    // re-encoded JPEG/WebP, then a favorite, then the oldest import.
    const lossless = (it) => (it.mime_type === 'image/png' ? 1 : 0);
    const best = [...group.items].sort((a, b) => (b.width * b.height - a.width * a.height)
      || (lossless(b) - lossless(a))
      || (Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite)))
      || String(a.imported_at).localeCompare(String(b.imported_at)))[0];
    const keep = new Set([best.id]);
    const ids = group.items.map((i) => i.id);
    const similarity = group.kind === 'exact' ? null : formatNumber((64 - group.distance) / 64, lang, { style: 'percent', maximumFractionDigits: 0 });
    return h('article', { class: ['dup-group', group.reviewed && 'dup-group--reviewed'] },
      h('header', { class: 'dup-group__head' },
        h('span', { class: ['pill', group.kind === 'exact' ? 'pill--accent' : 'pill--neutral'] },
          group.kind === 'exact' ? t('duplicates.exact') : t('duplicates.similar', { percent: similarity })),
        h('span', { class: 'muted small' }, t('common.screenshotCount', { count: group.items.length })),
        group.reviewed ? h('span', { class: 'pill pill--ok' }, t('duplicates.reviewed')) : null),
      h('ul', { class: 'dup-items', role: 'list' }, group.items.map((it) => {
        const id = `keep-${group.key}-${it.id}`;
        return h('li', { class: 'dup-item' },
          h('button', { type: 'button', class: 'dup-item__media', aria: { label: t('gallery.openItem', { name: displayName(it) }) }, onClick: () => ctx.openViewer(it, ids) }, thumbImage(it)),
          h('div', { class: 'dup-item__meta' },
            h('p', { class: 'dup-item__name' }, displayName(it)),
            h('dl', { class: 'dup-facts' },
              h('div', null, h('dt', null, t('details.dimensions')), h('dd', null, formatDimensions(it.width, it.height, lang))),
              h('div', null, h('dt', null, t('details.size')), h('dd', null, formatBytes(it.file_size, lang))),
              h('div', null, h('dt', null, t('details.imported')), h('dd', null, formatDate(it.imported_at, lang, 'short'))))),
          h('label', { class: 'dup-item__keep', for: id },
            h('input', { type: 'checkbox', class: 'checkbox', id, checked: keep.has(it.id), onChange: (e) => { if (e.target.checked) keep.add(it.id); else keep.delete(it.id); } }),
            h('span', null, it.id === best.id ? t('duplicates.keepSuggested') : t('duplicates.keep')),
            h('span', { class: 'sr-only' }, ` — ${displayName(it)}`)));
      })),
      h('footer', { class: 'dup-group__actions' },
        button(t('duplicates.keepAll'), { kind: 'quiet', size: 'sm', onClick: async () => {
          try {
            await keepAll(group);
            group.reviewed = true;
            toast(t('duplicates.markedReviewed'), { kind: 'success' });
            renderGroups();
          } catch (error) { toastError(error); }
        } }),
        button(t('duplicates.resolve'), { kind: 'primary', size: 'sm', onClick: async () => {
          if (!keep.size) return toast(t('duplicates.keepAtLeastOne'), { kind: 'error' });
          try {
            const { trashed } = await resolveGroup(group, [...keep]);
            toast(t('duplicates.resolved', { count: trashed }), { kind: 'success' });
            scan();
          } catch (error) { toastError(error); }
        } })));
  }

  function renderGroups() {
    const visible = groups.filter((g) => showReviewed || !g.reviewed);
    const reviewedCount = groups.length - groups.filter((g) => !g.reviewed).length;
    if (!visible.length) {
      replace(content, emptyState({
        iconName: 'check-circle',
        title: groups.length ? t('duplicates.allReviewed') : t('duplicates.noneTitle'),
        text: reviewedCount ? t('duplicates.reviewedHidden', { count: reviewedCount }) : t('duplicates.noneText'),
      }));
      return;
    }
    replace(content,
      h('p', { class: 'muted small' }, t('duplicates.found', { count: visible.length })),
      h('div', { class: 'dup-groups' }, visible.map(groupCard)));
  }

  async function scan() {
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    progressWrap.hidden = false;
    scanBtn.disabled = true;
    bar.set(0);
    statusText.textContent = t('duplicates.scanning');
    try {
      const res = await findDuplicates({
        signal: mine.signal,
        similar,
        onProgress: (p) => {
          bar.set(p);
          statusText.textContent = t('duplicates.scanningProgress', { percent: Math.round(p * 100) });
        },
      });
      groups = res.groups;
      renderGroups();
    } catch (error) {
      if (error?.name === 'AbortError') statusText.textContent = t('duplicates.cancelled');
      else replace(content, errorState({ text: t(error?.i18nKey ?? 'errors.generic'), onRetry: scan }));
    } finally {
      if (controller === mine) {
        progressWrap.hidden = true;
        scanBtn.disabled = false;
      }
    }
  }

  scan();
  return { el, destroy: () => controller?.abort() };
}
