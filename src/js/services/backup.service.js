// Backup and restore. A backup is a standard ZIP:
//   manifest.json            metadata, tags, collections, favorites, notes, OCR text
//   originals/<id>.<ext>     untouched original files
//   thumbnails/<id>.<ext>    thumbnails (optional; regenerated if missing)
// Restoring never overwrites anything: it only adds screenshots, skipping or
// copying duplicates as chosen, and it can resume after an interruption.
import { Zip, ZipDeflate, ZipPassThrough, unzip } from 'fflate';
import { config } from '../config.js';
import { kvDelete, kvGet, kvSet } from '../lib/db.js';
import { emit, libraryChanged } from '../state.js';
import { fold } from '../utils/text.js';
import { processImage } from '../utils/image-processing.js';
import { sha256Hex } from '../utils/image-core.js';
import { CATEGORY_KEYS } from './category.service.js';
import { EXTENSIONS, cleanFilename, cleanText, isHexColor, sniffImageType } from '../utils/validation.js';
import { repo } from './database.service.js';

export const BACKUP_FORMAT = 'screenshot-organizer-backup';
export const BACKUP_VERSION = 1;
const LAST_BACKUP_KEY = 'lastBackup';

const META_FIELDS = ['id', 'title', 'description', 'notes', 'original_filename', 'mime_type', 'file_size', 'width', 'height',
  'captured_at', 'captured_source', 'imported_at', 'is_favorite', 'is_trashed', 'trashed_at', 'ocr_status', 'ocr_text',
  'ocr_lang', 'category', 'category_source', 'category_evidence', 'content_hash', 'phash'];

function abortIfNeeded(signal) {
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}

export function toManifestItem(item) {
  const out = {};
  for (const k of META_FIELDS) out[k] = item[k] ?? null;
  out.tags = (item.tags ?? []).map((t) => t.name);
  out.collection_ids = item.collection_ids ?? [];
  out.file = `originals/${item.id}.${EXTENSIONS[item.mime_type] ?? 'img'}`;
  return out;
}

export function buildManifest(items, collections, { exportId = crypto.randomUUID(), now = new Date() } = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    export_id: exportId,
    exported_at: now.toISOString(),
    app_version: config.appVersion,
    counts: { screenshots: items.length, collections: collections.length },
    collections: collections.map(({ id, name, description, color, icon, created_at }) => ({ id, name, description, color, icon, created_at })),
    screenshots: items,
  };
}

/** When the last full backup was made, and of how many screenshots. */
export async function getLastBackup() {
  return (await kvGet(LAST_BACKUP_KEY).catch(() => null)) ?? null;
}

/** True when the library has screenshots and no full backup in `days` days. */
export async function backupIsDue(days = config.backupReminderDays) {
  const total = await repo().count();
  if (!total) return false;
  const last = await getLastBackup();
  return !last || Date.parse(last.at) < Date.now() - days * 86400_000;
}

/**
 * Builds a ZIP backup. With `ids` only those screenshots are included.
 * @returns {Promise<{blob: Blob, manifest: object}>}
 */
export async function exportBackup({ ids = null, includeThumbnails = true, includeTrashed = true, onProgress, signal } = {}) {
  const r = repo();
  const items = await r.exportItems(ids, { includeTrashed });
  const used = new Set(items.flatMap((it) => it.collection_ids ?? []));
  const collections = (await r.allCollections()).filter((c) => !ids || used.has(c.id));

  const parts = [];
  let zipError = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else parts.push(chunk);
  });
  const addBytes = (path, bytes, compress = false) => {
    const entry = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(entry);
    entry.push(bytes, true);
  };

  const manifestItems = [];
  for (let i = 0; i < items.length; i++) {
    abortIfNeeded(signal);
    const item = items[i];
    const meta = toManifestItem(item);
    const original = await r.getOriginalBlob(item);
    if (!original) throw Object.assign(new Error('missing original'), { i18nKey: 'errors.fileMissing' });
    addBytes(meta.file, new Uint8Array(await original.arrayBuffer()));
    if (includeThumbnails) {
      const thumb = await r.getThumbBlob(item).catch(() => null);
      if (thumb) {
        meta.thumbnail = `thumbnails/${item.id}.${thumb.type === 'image/jpeg' ? 'jpg' : 'webp'}`;
        addBytes(meta.thumbnail, new Uint8Array(await thumb.arrayBuffer()));
      }
    }
    manifestItems.push(meta);
    onProgress?.(i + 1, items.length);
    if (zipError) throw zipError;
  }
  const manifest = buildManifest(manifestItems, collections);
  addBytes('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
  zip.end();
  if (zipError) throw zipError;
  if (!ids) {
    await kvSet(LAST_BACKUP_KEY, { at: manifest.exported_at, count: items.length }).catch(() => {});
    emit('backup:done', {});
  }
  return { blob: new Blob(parts, { type: 'application/zip' }), manifest };
}

export async function exportJson({ ids = null } = {}) {
  const r = repo();
  const items = (await r.exportItems(ids)).map(toManifestItem);
  const manifest = buildManifest(items, await r.allCollections());
  return new Blob([JSON.stringify({ ...manifest, images_included: false }, null, 2)], { type: 'application/json' });
}

/** CSV cell escaping, including protection against spreadsheet formula injection. */
export function csvCell(value) {
  let s = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items, collections) {
  const colNames = new Map(collections.map((c) => [c.id, c.name]));
  const header = ['id', 'title', 'original_filename', 'description', 'notes', 'tags', 'collections', 'category', 'is_favorite',
    'is_trashed', 'width', 'height', 'file_size', 'mime_type', 'captured_at', 'captured_source', 'imported_at', 'ocr_status', 'ocr_text', 'content_hash'];
  const rows = items.map((it) => [
    it.id, it.title, it.original_filename, it.description, it.notes, (it.tags ?? []).map((t) => t.name ?? t),
    (it.collection_ids ?? []).map((id) => colNames.get(id) ?? id), it.category ?? '', it.is_favorite, it.is_trashed,
    it.width, it.height, it.file_size, it.mime_type, it.captured_at ?? '', it.captured_source ?? '', it.imported_at,
    it.ocr_status, it.ocr_text ?? '', it.content_hash ?? '',
  ]);
  // UTF-8 BOM so spreadsheet apps read ë and ç correctly.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export async function exportCsv({ ids = null } = {}) {
  const r = repo();
  return new Blob([toCsv(await r.exportItems(ids), await r.allCollections())], { type: 'text/csv;charset=utf-8' });
}

// --- Restore ----------------------------------------------------------------------

export function readZip(file) {
  return file.arrayBuffer().then((buf) => new Promise((resolve, reject) => {
    unzip(new Uint8Array(buf), (err, files) => (err ? reject(Object.assign(err, { i18nKey: 'backup.errors.notZip' })) : resolve(files)));
  }));
}

const isIso = (v) => v == null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));

/** Structural validation of a manifest. Returns i18n keys for problems. */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.format !== BACKUP_FORMAT) errors.push('backup.errors.format');
  else if (typeof manifest.version !== 'number' || manifest.version > BACKUP_VERSION) errors.push('backup.errors.version');
  if (!Array.isArray(manifest?.screenshots)) errors.push('backup.errors.noScreenshots');
  if (manifest?.collections != null && !Array.isArray(manifest.collections)) errors.push('backup.errors.format');
  if (errors.length) return { ok: false, errors, invalidItems: [] };
  const invalidItems = [];
  const ids = new Set();
  for (const s of manifest.screenshots) {
    const ok = s && typeof s.id === 'string' && !ids.has(s.id) && typeof s.file === 'string'
      && /^originals\/[^/]+$/.test(s.file) && isIso(s.imported_at) && isIso(s.captured_at)
      && (s.tags == null || Array.isArray(s.tags)) && (s.collection_ids == null || Array.isArray(s.collection_ids));
    if (!ok) invalidItems.push(s?.id ?? null);
    else ids.add(s.id);
  }
  return { ok: true, errors, invalidItems };
}

/**
 * Opens and fully checks a backup file: manifest structure, every image is
 * present, is a real image, and matches its recorded SHA-256.
 */
export async function inspectBackup(file, { onProgress, signal } = {}) {
  const files = await readZip(file);
  const raw = files['manifest.json'];
  if (!raw) throw Object.assign(new Error('no manifest'), { i18nKey: 'backup.errors.noManifest' });
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw Object.assign(new Error('bad manifest'), { i18nKey: 'backup.errors.format' });
  }
  const check = validateManifest(manifest);
  if (!check.ok) throw Object.assign(new Error('invalid'), { i18nKey: check.errors[0] });

  const problems = [];
  const valid = [];
  const list = manifest.screenshots;
  for (let i = 0; i < list.length; i++) {
    abortIfNeeded(signal);
    const s = list[i];
    if (check.invalidItems.includes(s?.id ?? null)) { problems.push({ id: s?.id, error: 'backup.errors.itemInvalid' }); continue; }
    const bytes = files[s.file];
    if (!bytes) { problems.push({ id: s.id, error: 'backup.errors.fileMissing' }); continue; }
    const mime = sniffImageType(bytes.subarray(0, 16));
    if (!mime) { problems.push({ id: s.id, error: 'errors.unsupportedType' }); continue; }
    const hash = await sha256Hex(bytes);
    if (s.content_hash && s.content_hash !== hash) { problems.push({ id: s.id, error: 'backup.errors.hashMismatch' }); continue; }
    valid.push({ ...s, mime_type: mime, content_hash: hash });
    onProgress?.(i + 1, list.length);
  }

  let duplicates = 0;
  for (const s of valid) {
    s.duplicate = (await repo().findByHash(s.content_hash)).length > 0;
    if (s.duplicate) duplicates++;
  }
  const existingNames = new Set((await repo().allCollections()).map((c) => fold(c.name)));
  const collections = (manifest.collections ?? []).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
  const job = await kvGet(`restore:${manifest.export_id}`);

  return {
    manifest,
    files,
    valid,
    problems,
    duplicates,
    collections,
    matchingCollections: collections.filter((c) => existingNames.has(fold(c.name))).length,
    resumable: job ? { done: job.done.length } : null,
  };
}

function uniqueName(name, taken) {
  let candidate = name;
  for (let n = 2; taken.has(fold(candidate)); n++) candidate = `${name} (${n})`.slice(0, 80);
  taken.add(fold(candidate));
  return candidate;
}

/**
 * @param {Awaited<ReturnType<typeof inspectBackup>>} backup
 * @param {{duplicates: 'skip'|'copy', collections: 'merge'|'new'}} options
 */
export async function restoreBackup(backup, { duplicates = 'skip', collections = 'merge', onProgress, signal } = {}) {
  const r = repo();
  const jobKey = `restore:${backup.manifest.export_id}`;
  const job = (await kvGet(jobKey)) ?? { done: [], collectionMap: {}, started_at: new Date().toISOString() };
  const done = new Set(job.done);
  const summary = { restored: 0, skipped: 0, failed: 0, resumed: done.size, errors: [] };

  // Collections first, so links can be recreated.
  const existing = await r.allCollections();
  const byName = new Map(existing.map((c) => [fold(c.name), c]));
  const taken = new Set(existing.map((c) => fold(c.name)));
  for (const c of backup.collections) {
    if (job.collectionMap[c.id]) continue;
    const name = cleanText(c.name, 80).trim() || 'Koleksion';
    if (collections === 'merge' && byName.has(fold(name))) {
      job.collectionMap[c.id] = byName.get(fold(name)).id;
      continue;
    }
    const created = await r.createCollection({
      name: uniqueName(name, taken),
      description: cleanText(c.description, 500),
      color: isHexColor(c.color) ? c.color : '#10B981',
      icon: /^[a-z0-9-]{1,40}$/.test(c.icon ?? '') ? c.icon : 'folder',
    });
    job.collectionMap[c.id] = created.id;
  }
  await kvSet(jobKey, job);

  for (let i = 0; i < backup.valid.length; i++) {
    abortIfNeeded(signal);
    const s = backup.valid[i];
    if (done.has(s.id)) { onProgress?.(i + 1, backup.valid.length); continue; }
    try {
      const alreadyThere = (await r.findByHash(s.content_hash)).length > 0;
      if (alreadyThere && duplicates === 'skip') {
        summary.skipped++;
      } else {
        const original = new Blob([backup.files[s.file]], { type: s.mime_type });
        const processed = await processImage(original, s.mime_type);
        const record = {
          id: crypto.randomUUID(),
          title: cleanText(s.title, 200),
          description: cleanText(s.description, 5000),
          notes: cleanText(s.notes, 10000),
          original_filename: cleanFilename(s.original_filename),
          mime_type: s.mime_type,
          file_size: original.size,
          thumbnail_size: processed.thumb.size,
          width: processed.width,
          height: processed.height,
          captured_at: isIso(s.captured_at) ? s.captured_at : null,
          captured_source: ['exif', 'filename', 'file'].includes(s.captured_source) ? s.captured_source : null,
          imported_at: isIso(s.imported_at) && s.imported_at ? s.imported_at : new Date().toISOString(),
          is_favorite: Boolean(s.is_favorite),
          is_trashed: Boolean(s.is_trashed),
          trashed_at: s.is_trashed ? (isIso(s.trashed_at) && s.trashed_at ? s.trashed_at : new Date().toISOString()) : null,
          ocr_status: s.ocr_status === 'done' && typeof s.ocr_text === 'string' ? 'done' : 'none',
          ocr_text: typeof s.ocr_text === 'string' ? cleanText(s.ocr_text, 100000) : null,
          ocr_lang: typeof s.ocr_lang === 'string' ? s.ocr_lang.slice(0, 40) : null,
          category: CATEGORY_KEYS.includes(s.category) ? s.category : null,
          category_source: ['auto', 'user'].includes(s.category_source) ? s.category_source : null,
          category_evidence: Array.isArray(s.category_evidence) ? s.category_evidence.slice(0, 6) : [],
          content_hash: processed.hash,
          phash: processed.phash,
        };
        const saved = await r.create({ record, original, thumb: processed.thumb });
        const tags = (s.tags ?? []).filter((t) => typeof t === 'string').slice(0, 50);
        if (tags.length) await r.setTags(saved.id, tags);
        for (const cid of s.collection_ids ?? []) {
          const target = job.collectionMap[cid];
          if (target) await r.addToCollection([saved.id], target);
        }
        summary.restored++;
      }
      job.done.push(s.id);
      done.add(s.id);
      await kvSet(jobKey, job);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      summary.failed++;
      summary.errors.push({ id: s.id, error: error?.i18nKey ?? 'errors.generic' });
    }
    onProgress?.(i + 1, backup.valid.length);
  }
  if (!summary.failed) await kvDelete(jobKey);
  libraryChanged('restore');
  return summary;
}

export function backupFilename(prefix = 'screenshot-organizer-backup', ext = 'zip', now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}.${ext}`;
}
