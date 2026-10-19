// Backup and restore: full ZIP backups, JSON/CSV metadata exports, and a
// restore flow with validation, preview, conflict choices and resume.
import { downloadBlob, h, pickFiles, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { backupFilename, exportBackup, exportCsv, exportJson, getLastBackup, inspectBackup, restoreBackup } from '../services/backup.service.js';
import { formatBytes, formatDate, formatNumber } from '../utils/formatting.js';
import { toast, toastError } from '../components/toast.js';
import { button, pageHeader, progressBar, segmented, toggle } from '../components/ui.js';

export function render(ctx) {
  ctx.setTitle(t('nav.backup'));
  const lang = getLanguage();
  let includeThumbnails = true;
  let includeTrashed = true;
  let exportController = null;

  // Export ------------------------------------------------------------------------
  const lastEl = h('p', { class: 'muted small', aria: { live: 'polite' } });
  const showLast = async () => {
    const last = await getLastBackup();
    lastEl.textContent = last ? t('backup.lastValue', { date: formatDate(last.at, lang), count: last.count }) : t('backup.neverLong');
  };
  showLast();
  const exportBar = progressBar(0, { label: t('backup.exporting') });
  exportBar.hidden = true;
  const exportStatus = h('p', { class: 'muted small', aria: { live: 'polite' } });
  const cancelExport = button(t('common.cancel'), { kind: 'quiet', size: 'sm', onClick: () => exportController?.abort() });
  cancelExport.hidden = true;
  const fullBtn = button(t('backup.exportFull'), { kind: 'primary', iconName: 'archive', onClick: async () => {
    exportController = new AbortController();
    fullBtn.disabled = true;
    exportBar.hidden = false;
    cancelExport.hidden = false;
    exportStatus.textContent = t('backup.preparing');
    try {
      const { blob, manifest } = await exportBackup({
        includeThumbnails, includeTrashed, signal: exportController.signal,
        onProgress: (d, total) => { exportBar.set(d / total); exportStatus.textContent = t('backup.progress', { done: d, total }); },
      });
      downloadBlob(blob, backupFilename());
      exportStatus.textContent = t('backup.exportSummary', { count: manifest.counts.screenshots, size: formatBytes(blob.size, lang) });
      toast(t('backup.exportDone', { count: manifest.counts.screenshots }), { kind: 'success' });
      showLast();
    } catch (error) {
      exportStatus.textContent = error?.name === 'AbortError' ? t('backup.exportCancelled') : t('backup.errors.exportFailed');
      if (error?.name !== 'AbortError') toastError(error, 'backup.errors.exportFailed');
    } finally {
      fullBtn.disabled = false;
      exportBar.hidden = true;
      cancelExport.hidden = true;
    }
  } });
  const metaExport = async (kind) => {
    try {
      downloadBlob(kind === 'json' ? await exportJson() : await exportCsv(), backupFilename('screenshot-metadata', kind));
      toast(t('backup.metaDone'), { kind: 'success' });
    } catch (error) { toastError(error); }
  };

  const exportPanel = h('section', { class: 'panel', aria: { labelledby: 'export-title' } },
    h('h2', { class: 'section-title', id: 'export-title' }, icon('download', { size: 18 }), h('span', null, t('backup.exportTitle'))),
    h('p', { class: 'small' }, t('backup.exportIntro')),
    lastEl,
    toggle({ label: t('backup.includeThumbs'), description: t('backup.includeThumbsHint'), checked: includeThumbnails, onChange: (v) => { includeThumbnails = v; } }),
    toggle({ label: t('backup.includeTrash'), checked: includeTrashed, onChange: (v) => { includeTrashed = v; } }),
    h('div', { class: 'setting-actions' }, fullBtn, cancelExport),
    exportBar, exportStatus,
    h('div', { class: 'setting-actions setting-actions--divided' },
      button(t('backup.exportJson'), { kind: 'secondary', size: 'sm', iconName: 'file-text', onClick: () => metaExport('json') }),
      button(t('backup.exportCsv'), { kind: 'secondary', size: 'sm', iconName: 'file-text', onClick: () => metaExport('csv') })),
    h('p', { class: 'muted tiny' }, t('backup.metaNote')));

  // Restore -----------------------------------------------------------------------
  const restoreBody = h('div', { class: 'restore-body' });
  let duplicates = 'skip';
  let collections = 'merge';
  let restoreController = null;

  async function chooseFile() {
    const [file] = await pickFiles({ accept: '.zip,application/zip', multiple: false });
    if (!file) return;
    const bar = progressBar(0, { label: t('backup.validating') });
    const status = h('p', { class: 'muted small', aria: { live: 'polite' } }, t('backup.validating'));
    replace(restoreBody, status, bar);
    try {
      const backup = await inspectBackup(file, { onProgress: (d, total) => { bar.set(d / total); status.textContent = t('backup.validatingProgress', { done: d, total }); } });
      showPreview(backup, file);
    } catch (error) {
      replace(restoreBody,
        h('p', { class: 'notice notice--error' }, icon('alert-triangle', { size: 16 }), h('span', null, t(error?.i18nKey ?? 'backup.errors.unreadable'))),
        button(t('backup.chooseOther'), { kind: 'secondary', onClick: chooseFile }));
    }
  }

  function showPreview(backup, file) {
    const m = backup.manifest;
    const facts = [
      [t('backup.preview.file'), `${file.name} (${formatBytes(file.size, lang)})`],
      [t('backup.preview.created'), formatDate(m.exported_at, lang)],
      [t('backup.preview.screenshots'), formatNumber(backup.valid.length, lang)],
      [t('backup.preview.duplicates'), formatNumber(backup.duplicates, lang)],
      [t('backup.preview.collections'), t('backup.preview.collectionsValue', { count: backup.collections.length, matching: backup.matchingCollections })],
    ];
    const problems = backup.problems.length
      ? h('div', { class: 'notice notice--warning' }, icon('alert-triangle', { size: 16 }),
        h('div', null, h('p', null, t('backup.problems', { count: backup.problems.length })),
          h('ul', { class: 'problem-list' }, backup.problems.slice(0, 8).map((p) => h('li', null, `${p.id ?? '?'}: ${t(p.error)}`)))))
      : h('p', { class: 'notice notice--ok' }, icon('check-circle', { size: 16 }), h('span', null, t('backup.allValid')));
    const bar = progressBar(0, { label: t('backup.restoring') });
    bar.hidden = true;
    const status = h('p', { class: 'muted small', aria: { live: 'polite' } });
    const cancelBtn = button(t('common.cancel'), { kind: 'quiet', onClick: () => restoreController?.abort() });
    cancelBtn.hidden = true;
    const startBtn = button(backup.resumable ? t('backup.resume') : t('backup.startRestore'), { kind: 'primary', iconName: 'rotate-ccw', disabled: !backup.valid.length, onClick: async () => {
      startBtn.disabled = true;
      bar.hidden = false;
      restoreController = new AbortController();
      cancelBtn.hidden = false;
      try {
        const summary = await restoreBackup(backup, {
          duplicates, collections, signal: restoreController.signal,
          onProgress: (d, total) => { bar.set(d / total); status.textContent = t('backup.progress', { done: d, total }); },
        });
        replace(restoreBody,
          h('p', { class: ['notice', summary.failed ? 'notice--warning' : 'notice--ok'] }, icon(summary.failed ? 'alert-triangle' : 'check-circle', { size: 16 }),
            h('span', null, t('backup.restoreSummary', summary))),
          summary.failed ? h('p', { class: 'small' }, t('backup.restoreRetryHint')) : null,
          h('div', { class: 'setting-actions' },
            button(t('nav.allScreenshots'), { kind: 'primary', onClick: () => ctx.navigate('/library') }),
            button(t('backup.chooseOther'), { kind: 'secondary', onClick: chooseFile })));
      } catch (error) {
        status.textContent = error?.name === 'AbortError' ? t('backup.restorePaused') : t(error?.i18nKey ?? 'backup.errors.restoreFailed');
        startBtn.disabled = false;
        startBtn.querySelector('span').textContent = t('backup.resume');
      } finally {
        cancelBtn.hidden = true;
      }
    } });
    replace(restoreBody,
      h('dl', { class: 'meta-list' }, facts.map(([k, v]) => h('div', { class: 'meta-row' }, h('dt', null, k), h('dd', null, v)))),
      problems,
      backup.resumable ? h('p', { class: 'notice notice--info' }, icon('history', { size: 16 }), h('span', null, t('backup.resumable', { count: backup.resumable.done }))) : null,
      h('div', { class: 'setting-row' }, h('div', { class: 'setting-row__text' }, h('span', { class: 'setting-row__label' }, t('backup.dupStrategy')), h('p', { class: 'setting-row__desc' }, t('backup.dupStrategyHint'))),
        segmented([{ value: 'skip', label: t('backup.dupSkip') }, { value: 'copy', label: t('backup.dupCopy') }], { value: duplicates, label: t('backup.dupStrategy'), onChange: (v) => { duplicates = v; } })),
      h('div', { class: 'setting-row' }, h('div', { class: 'setting-row__text' }, h('span', { class: 'setting-row__label' }, t('backup.colStrategy')), h('p', { class: 'setting-row__desc' }, t('backup.colStrategyHint'))),
        segmented([{ value: 'merge', label: t('backup.colMerge') }, { value: 'new', label: t('backup.colNew') }], { value: collections, label: t('backup.colStrategy'), onChange: (v) => { collections = v; } })),
      h('p', { class: 'muted small' }, t('backup.neverOverwrites')),
      h('div', { class: 'setting-actions' }, startBtn, cancelBtn, button(t('backup.chooseOther'), { kind: 'quiet', onClick: chooseFile })),
      bar, status);
  }

  replace(restoreBody,
    h('p', { class: 'small' }, t('backup.restoreIntro')),
    button(t('backup.chooseFile'), { kind: 'secondary', iconName: 'upload', onClick: chooseFile }));

  const el = h('div', { class: 'page' },
    pageHeader({ title: t('nav.backup'), subtitle: t('backup.sub') }),
    h('p', { class: 'notice notice--info' }, icon('hard-drive', { size: 16 }), h('span', null, t('backup.whyLocal'))),
    h('div', { class: 'two-col' }, exportPanel,
      h('section', { class: 'panel', aria: { labelledby: 'restore-title' } },
        h('h2', { class: 'section-title', id: 'restore-title' }, icon('rotate-ccw', { size: 18 }), h('span', null, t('backup.restoreTitle'))),
        restoreBody)),
    h('p', { class: 'muted small' }, t('backup.formatNote')));
  return { el, destroy: () => { exportController?.abort(); restoreController?.abort(); } };
}
