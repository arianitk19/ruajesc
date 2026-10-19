// Import pipeline and screenshot editing.
// Import, per file: validate → decode/hash/thumbnail (worker) → duplicate
// check → save (one atomic IndexedDB transaction) → queue OCR.
import { isQuotaError } from '../lib/idb.js';
import { libraryChanged } from '../state.js';
import { processImage } from '../utils/image-processing.js';
import { captureDateFromFilename } from '../utils/image-core.js';
import { cleanFilename, cleanText, validateImageFile } from '../utils/validation.js';
import { autoCategoryPatch, categorize } from './category.service.js';
import { repo } from './database.service.js';
import { getSettings } from './settings.service.js';

let ocrHook = null;
/** The OCR service registers itself here to avoid an import cycle. */
export function onImported(fn) {
  ocrHook = fn;
}

export const IMPORT_STATUSES = ['queued', 'validating', 'processing', 'checking', 'saving', 'done', 'duplicate', 'failed', 'cancelled'];
const BUSY = ['queued', 'validating', 'processing', 'checking', 'saving'];

/** Builds the metadata row for a processed file. Exported for tests. */
export function buildRecord(file, mime, processed, settings = getSettings(), now = new Date()) {
  const name = cleanFilename(file.name);
  let captured_at = null;
  let captured_source = null;
  if (processed.captured) {
    captured_at = processed.captured;
    captured_source = 'exif';
  } else {
    const fromName = captureDateFromFilename(name);
    if (fromName) {
      captured_at = fromName.toISOString();
      captured_source = 'filename';
    } else if (file.lastModified && file.lastModified < now.getTime() - 60_000 && file.lastModified > Date.UTC(1995, 0, 1)) {
      captured_at = new Date(file.lastModified).toISOString();
      captured_source = 'file';
    }
  }
  const record = {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    notes: '',
    original_filename: name,
    mime_type: mime,
    file_size: file.size,
    thumbnail_size: processed.thumb.size,
    width: processed.width,
    height: processed.height,
    captured_at,
    captured_source,
    imported_at: now.toISOString(),
    content_hash: processed.hash,
    phash: processed.phash,
    is_favorite: false,
    is_trashed: false,
    trashed_at: null,
    ocr_status: settings.ocrEnabled && settings.ocrAuto ? 'pending' : 'none',
    ocr_text: null,
    category: null,
    category_source: null,
    category_evidence: [],
  };
  if (settings.autoCategorize) {
    const guess = categorize(record);
    if (guess.category !== 'other') {
      record.category = guess.category;
      record.category_source = 'auto';
      record.category_evidence = guess.evidence;
    }
  }
  return record;
}

/**
 * A batch import. `onUpdate(job)` fires whenever any item changes.
 * Items: { key, file, name, size, status, error, savedId, duplicateOf }
 */
export function createImportJob(files, { onUpdate } = {}) {
  const controller = new AbortController();
  const hashesInBatch = new Map(); // hash -> key of first item
  const job = {
    items: files.map((file, i) => ({
      key: `${Date.now()}-${i}`,
      file,
      name: cleanFilename(file.name || `screenshot-${i + 1}.png`),
      size: file.size,
      status: 'queued',
      error: null,
      errorParams: null,
      savedId: null,
      duplicateOf: null,
      force: false,
    })),
    running: false,
    get done() {
      return this.items.every((it) => !BUSY.includes(it.status));
    },
    counts() {
      const c = Object.fromEntries(IMPORT_STATUSES.map((s) => [s, 0]));
      for (const it of this.items) c[it.status]++;
      return c;
    },
  };
  const update = () => onUpdate?.(job);
  const set = (item, patch) => {
    Object.assign(item, patch);
    update();
  };

  async function runItem(item) {
    if (controller.signal.aborted) return set(item, { status: 'cancelled' });
    try {
      set(item, { status: 'validating', error: null });
      const valid = await validateImageFile(item.file);
      if (!valid.ok) return set(item, { status: 'failed', error: valid.error, errorParams: valid.params ?? null });

      set(item, { status: 'processing' });
      const processed = await processImage(item.file, valid.mime);
      if (controller.signal.aborted) return set(item, { status: 'cancelled' });

      set(item, { status: 'checking' });
      const settings = getSettings();
      if (!item.force && settings.duplicateOnImport === 'skip') {
        const firstKey = hashesInBatch.get(processed.hash);
        if (firstKey && firstKey !== item.key) return set(item, { status: 'duplicate', duplicateOf: { batch: firstKey } });
        const existing = await repo().findByHash(processed.hash);
        if (existing.length) return set(item, { status: 'duplicate', duplicateOf: existing[0] });
      }
      if (!hashesInBatch.has(processed.hash)) hashesInBatch.set(processed.hash, item.key);

      const record = buildRecord(item.file, valid.mime, processed, settings);
      set(item, { status: 'saving' });
      const saved = await repo().create({ record, original: item.file, thumb: processed.thumb });
      set(item, { status: 'done', savedId: saved.id });
      libraryChanged('import');
      if (saved.ocr_status === 'pending') ocrHook?.(saved);
    } catch (error) {
      const key = isQuotaError(error) ? 'errors.localQuota' : (error?.i18nKey ?? 'errors.saveFailed');
      set(item, { status: 'failed', error: key });
    }
  }

  async function worker(queue) {
    while (queue.length) await runItem(queue.shift());
  }

  job.start = async () => {
    job.running = true;
    update();
    const queue = job.items.filter((it) => it.status === 'queued');
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker(queue)));
    job.running = false;
    update();
    return job;
  };

  job.cancel = () => {
    controller.abort();
    for (const it of job.items) if (it.status === 'queued') it.status = 'cancelled';
    update();
  };

  job.retry = async (key, { force = false } = {}) => {
    const item = job.items.find((it) => it.key === key);
    if (!item) return;
    item.force = force || item.force;
    await runItem(item);
    update();
  };

  job.retryFailed = async () => {
    for (const it of job.items.filter((x) => x.status === 'failed')) await runItem(it);
    update();
  };

  return job;
}

// --- Editing ------------------------------------------------------------------

const LIMITS = { title: 200, description: 5000, notes: 10000 };

export async function updateDetails(id, patch) {
  const clean = {};
  for (const [key, max] of Object.entries(LIMITS)) if (patch[key] != null) clean[key] = cleanText(patch[key], max);
  let item = await repo().update(id, clean);
  if (getSettings().autoCategorize && item.category_source !== 'user') {
    const cat = autoCategoryPatch(item);
    if (cat) item = await repo().update(id, cat);
  }
  libraryChanged('edit');
  return item;
}

export async function setTags(id, names) {
  const tags = await repo().setTags(id, names);
  const item = await repo().get(id);
  if (getSettings().autoCategorize && item && item.category_source !== 'user') {
    const cat = autoCategoryPatch(item);
    if (cat) await repo().update(id, cat);
  }
  libraryChanged('tags');
  return tags;
}

export async function setCategory(id, category) {
  const item = await repo().update(id, { category, category_source: category ? 'user' : null, category_evidence: [] });
  libraryChanged('category');
  return item;
}

export async function resetCategory(id) {
  const current = await repo().get(id);
  const guess = categorize(current);
  const item = await repo().update(id, {
    category: guess.category === 'other' ? null : guess.category,
    category_source: guess.category === 'other' ? null : 'auto',
    category_evidence: guess.evidence,
  });
  libraryChanged('category');
  return item;
}

/** Re-runs the rules for every screenshot the user has not categorised themselves. */
export async function recategorizeAll() {
  const items = await repo().exportItems(null, { includeTrashed: false });
  let changed = 0;
  for (const it of items) {
    if (it.category_source === 'user') continue;
    const guess = categorize(it);
    const category = guess.category === 'other' ? null : guess.category;
    if (category !== (it.category ?? null)) {
      await repo().update(it.id, { category, category_source: category ? 'auto' : null, category_evidence: guess.evidence });
      changed++;
    }
  }
  libraryChanged('category');
  return changed;
}

export async function toggleFavorite(ids, value) {
  const n = await repo().setFavorite(ids, value);
  libraryChanged('favorite');
  return n;
}

export async function moveToTrash(ids) {
  const n = await repo().trash(ids);
  libraryChanged('trash');
  return n;
}

export async function restore(ids) {
  const n = await repo().restore(ids);
  libraryChanged('restore');
  return n;
}

export async function restoreAll() {
  const n = await repo().restoreAll();
  libraryChanged('restore');
  return n;
}

export async function deleteForever(ids) {
  const result = await repo().deleteForever(ids);
  libraryChanged('delete');
  return result;
}

export async function emptyTrash() {
  const result = await repo().emptyTrash();
  libraryChanged('delete');
  return result;
}

export async function addTagsToMany(ids, names) {
  const n = await repo().addTags(ids, names);
  libraryChanged('tags');
  return n;
}
