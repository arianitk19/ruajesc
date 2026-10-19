// Import dialog: file picker, drag and drop, clipboard paste, per-file status,
// retry, "import anyway" for duplicates, and cancellation.
import { h, pickFiles, replace } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { createImportJob } from '../services/screenshot.service.js';
import { formatBytes } from '../utils/formatting.js';
import { ACCEPT_ATTRIBUTE } from '../utils/validation.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { button, progressBar } from './ui.js';

const STATUS_ICON = {
  queued: 'clock', validating: 'loader', processing: 'loader', checking: 'loader', saving: 'loader',
  done: 'check-circle', duplicate: 'layers', failed: 'alert-triangle', cancelled: 'x',
};
const BUSY = ['queued', 'validating', 'processing', 'checking', 'saving'];

let activeDialog = null;

function dropzone(onFiles) {
  const zone = h('div', { class: 'dropzone', tabindex: '0', role: 'button', aria: { label: t('import.dropLabel') } },
    h('span', { class: 'dropzone__icon' }, icon('image-plus', { size: 28 })),
    h('p', { class: 'dropzone__title' }, t('import.dropTitle')),
    h('p', { class: 'dropzone__text' }, t('import.dropText')),
    h('p', { class: 'dropzone__hint' }, t('import.formats')));
  const browse = async () => {
    const files = await pickFiles({ accept: ACCEPT_ATTRIBUTE, multiple: true });
    if (files.length) onFiles(files);
  };
  zone.addEventListener('click', browse);
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('is-over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
  return zone;
}

/** Opens the import dialog, optionally starting with files already chosen. */
export function openImport(initialFiles = []) {
  if (activeDialog) {
    if (initialFiles.length) activeDialog.add(initialFiles);
    return activeDialog;
  }
  const jobs = [];
  const list = h('ul', { class: 'import-list', aria: { label: t('import.files') } });
  const summary = h('p', { class: 'import-summary', aria: { live: 'polite' } });
  const bar = progressBar(0, { label: t('import.progress') });
  bar.hidden = true;

  const allItems = () => jobs.flatMap((j) => j.items.map((it) => ({ job: j, it })));

  const row = ({ job, it }) => {
    const actions = [];
    if (it.status === 'failed') actions.push(button(t('common.retry'), { kind: 'quiet', size: 'sm', onClick: () => job.retry(it.key) }));
    if (it.status === 'duplicate') actions.push(button(t('import.importAnyway'), { kind: 'quiet', size: 'sm', onClick: () => job.retry(it.key, { force: true }) }));
    const detail = it.status === 'failed' ? t(it.error ?? 'errors.saveFailed', it.errorParams ? { max: formatBytes(it.errorParams.max, getLanguage()) } : undefined)
      : it.status === 'duplicate' ? t('import.duplicateOf', { name: it.duplicateOf?.title || it.duplicateOf?.original_filename || t('import.thisBatch') })
        : t(`import.status.${it.status}`);
    return h('li', { class: ['import-row', `import-row--${it.status}`] },
      h('span', { class: 'import-row__icon' }, icon(STATUS_ICON[it.status], { size: 16, className: BUSY.includes(it.status) && it.status !== 'queued' ? 'spin' : '' })),
      h('span', { class: 'import-row__text' },
        h('span', { class: 'import-row__name' }, it.name),
        h('span', { class: 'import-row__detail' }, `${formatBytes(it.size, getLanguage())} — ${detail}`)),
      actions.length ? h('span', { class: 'import-row__actions' }, actions) : null);
  };

  let dlg;
  const update = () => {
    const items = allItems();
    replace(list, ...items.map(row));
    const c = { done: 0, failed: 0, duplicate: 0 };
    let finished = 0;
    for (const { it } of items) {
      if (it.status in c) c[it.status]++;
      if (!BUSY.includes(it.status)) finished++;
    }
    bar.hidden = items.length === 0;
    bar.set(items.length ? finished / items.length : 0);
    summary.textContent = items.length ? t('import.summary', { done: c.done, total: items.length, failed: c.failed, duplicate: c.duplicate }) : '';
    const running = jobs.some((j) => !j.done);
    dlg?.setActions([
      running
        ? { label: t('import.cancel'), kind: 'secondary', closes: false, onClick: () => { jobs.forEach((j) => j.cancel()); return false; } }
        : { label: t('common.close'), kind: 'secondary', value: true },
      c.failed && !running ? { label: t('import.retryFailed'), kind: 'secondary', closes: false, onClick: () => { jobs.forEach((j) => j.retryFailed()); return false; } } : null,
      { label: t('import.addMore'), kind: 'primary', icon: 'plus', closes: false, onClick: async () => {
        const files = await pickFiles({ accept: ACCEPT_ATTRIBUTE, multiple: true });
        if (files.length) add(files);
        return false;
      } },
    ].filter(Boolean));
  };

  const add = (files) => {
    const valid = files.filter((f) => f && typeof f.size === 'number');
    if (!valid.length) return;
    zone.classList.add('dropzone--compact');
    const job = createImportJob(valid, { onUpdate: update });
    jobs.push(job);
    update();
    job.start().then(() => {
      update();
      const done = job.items.filter((i) => i.status === 'done').length;
      if (done && !document.body.contains(dlg.el)) toast(t('import.success', { count: done }), { kind: 'success' });
    });
  };

  const zone = dropzone(add);
  dlg = openDialog({
    title: t('import.title'),
    description: t('import.desc'),
    size: 'lg',
    body: [zone, bar, summary, list],
    onClose: () => {
      activeDialog = null;
      if (jobs.some((j) => !j.done)) toast(t('import.continuesInBackground'), { kind: 'info' });
    },
  });
  activeDialog = { add, dlg };
  update();
  if (initialFiles.length) add(initialFiles);
  return activeDialog;
}
