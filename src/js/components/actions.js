// Screenshot actions, shared by the gallery, viewer, inspector, selection bar
// and command palette, so each action behaves and is worded the same everywhere.
import { downloadBlob, h } from '../lib/dom.js';
import { getLanguage, t } from '../i18n/index.js';
import { backupFilename, exportBackup } from '../services/backup.service.js';
import { repo } from '../services/database.service.js';
import { enqueueOcr } from '../services/ocr.service.js';
import * as shots from '../services/screenshot.service.js';
import { getSettings } from '../services/settings.service.js';
import { clearSelection } from '../state.js';
import { copyImageToClipboard } from '../utils/image-processing.js';
import { formatDate } from '../utils/formatting.js';
import { EXTENSIONS } from '../utils/validation.js';
import { pickCollections } from './collection-picker.js';
import { confirmDialog, openDialog } from './dialog.js';
import { toast, toastError } from './toast.js';
import { progressBar } from './ui.js';
import { tagInput } from './tag-input.js';

export function displayName(item) {
  return item.title?.trim() || item.original_filename || t('common.untitled');
}

export function captureLabel(item) {
  if (!item.captured_at) return t('details.captureUnknown');
  return `${formatDate(item.captured_at, getLanguage())} (${t(`details.captureSource.${item.captured_source ?? 'file'}`)})`;
}

export async function downloadOriginal(item) {
  try {
    const blob = await repo().getOriginalBlob(item);
    if (!blob) throw Object.assign(new Error('missing'), { i18nKey: 'errors.fileMissing' });
    downloadBlob(blob, item.original_filename || `screenshot.${EXTENSIONS[item.mime_type] ?? 'png'}`);
  } catch (error) {
    toastError(error);
  }
}

export async function copyImage(item) {
  try {
    await copyImageToClipboard(await repo().getOriginalBlob(item));
    toast(t('viewer.copied'), { kind: 'success' });
  } catch (error) {
    toast(t(error?.message === 'unsupported' ? 'viewer.copyUnsupported' : 'viewer.copyFailed'), { kind: 'error' });
  }
}

export async function setFavorite(ids, value) {
  try {
    await shots.toggleFavorite(ids, value);
    toast(t(value ? 'actions.favorited' : 'actions.unfavorited', { count: ids.length }), { kind: 'success' });
  } catch (error) {
    toastError(error);
  }
}

export async function trash(ids) {
  try {
    await shots.moveToTrash(ids);
    clearSelection();
    toast(t('actions.trashed', { count: ids.length }), {
      kind: 'success',
      action: { label: t('common.undo'), onClick: () => shots.restore(ids).catch(toastError) },
    });
    return true;
  } catch (error) {
    toastError(error);
    return false;
  }
}

export async function restore(ids) {
  try {
    await shots.restore(ids);
    clearSelection();
    toast(t('actions.restored', { count: ids.length }), { kind: 'success' });
    return true;
  } catch (error) {
    toastError(error);
    return false;
  }
}

export async function deleteForever(ids) {
  const ok = await confirmDialog({
    title: t('actions.deleteForeverTitle', { count: ids.length }),
    message: t('actions.deleteForeverText'),
    confirmLabel: t('actions.deleteForever'),
    danger: true,
  });
  if (!ok) return false;
  try {
    const { deleted } = await shots.deleteForever(ids);
    clearSelection();
    toast(t('actions.deleted', { count: deleted.length }), { kind: 'success' });
    return true;
  } catch (error) {
    toastError(error);
    return false;
  }
}

export async function addToCollection(ids, current) {
  const result = await pickCollections(ids, { current });
  if (result) clearSelection();
  return result;
}

export function addTags(ids) {
  let names = [];
  return new Promise((resolve) => {
    openDialog({
      title: t('tags.addToMany', { count: ids.length }),
      size: 'sm',
      body: tagInput({ value: [], suggestions: () => repo().listTags(), onChange: (v) => { names = v; } }),
      onClose: (v) => resolve(v ?? null),
      actions: [
        { label: t('common.cancel'), kind: 'secondary', value: null },
        {
          label: t('tags.add'), kind: 'primary',
          onClick: async () => {
            if (!names.length) return false;
            try {
              await shots.addTagsToMany(ids, names);
              clearSelection();
              toast(t('tags.addedToMany', { count: ids.length }), { kind: 'success' });
              return names;
            } catch (error) {
              toastError(error);
              return false;
            }
          },
        },
      ],
    });
  });
}

export function runOcr(ids) {
  if (!getSettings().ocrEnabled) {
    toast(t('ocr.disabledHint'), { kind: 'info' });
    return;
  }
  const n = enqueueOcr(ids, { priority: true });
  toast(n ? t('ocr.queued', { count: n }) : t('ocr.alreadyQueued'), { kind: 'info' });
}

export async function exportZip(ids) {
  const controller = new AbortController();
  const bar = progressBar(0, { label: t('backup.exporting') });
  const status = h('p', { class: 'modal__text' }, t('backup.preparing'));
  const dlg = openDialog({
    title: t('backup.exportSelectedTitle', { count: ids.length }),
    size: 'sm',
    dismissable: false,
    body: [status, bar],
    actions: [{ label: t('common.cancel'), kind: 'secondary', onClick: () => { controller.abort(); } }],
  });
  try {
    const { blob } = await exportBackup({
      ids,
      signal: controller.signal,
      onProgress: (done, total) => {
        bar.set(done / total);
        status.textContent = t('backup.progress', { done, total });
      },
    });
    dlg.close(true);
    downloadBlob(blob, backupFilename('screenshots'));
    clearSelection();
    toast(t('backup.exportDone', { count: ids.length }), { kind: 'success' });
  } catch (error) {
    dlg.close(false);
    if (error?.name !== 'AbortError') toastError(error, 'backup.errors.exportFailed');
  }
}

/** Menu items for one screenshot (context menu and "more" buttons). */
export function itemMenu(item, { onOpen } = {}) {
  if (item.is_trashed) {
    return [
      onOpen && { label: t('common.open'), icon: 'eye', onClick: onOpen },
      { label: t('actions.restore'), icon: 'rotate-ccw', onClick: () => restore([item.id]) },
      { label: t('actions.download'), icon: 'download', onClick: () => downloadOriginal(item) },
      { separator: true },
      { label: t('actions.deleteForever'), icon: 'trash', danger: true, onClick: () => deleteForever([item.id]) },
    ].filter(Boolean);
  }
  return [
    onOpen && { label: t('common.open'), icon: 'eye', onClick: onOpen },
    { label: item.is_favorite ? t('actions.unfavorite') : t('actions.favorite'), icon: 'star', onClick: () => setFavorite([item.id], !item.is_favorite) },
    { label: t('actions.addToCollection'), icon: 'folder-plus', onClick: () => addToCollection([item.id], item.collection_ids) },
    { label: t('actions.download'), icon: 'download', onClick: () => downloadOriginal(item) },
    { label: t('actions.copyImage'), icon: 'copy', onClick: () => copyImage(item) },
    { label: item.ocr_status === 'done' ? t('ocr.rerun') : t('ocr.run'), icon: 'scan-text', onClick: () => runOcr([item.id]) },
    { separator: true },
    { label: t('actions.trash'), icon: 'trash', danger: true, onClick: () => trash([item.id]) },
  ].filter(Boolean);
}
