// Local OCR with Tesseract.js. Images are recognised inside the browser; the
// worker, WebAssembly core and language models are served by this app itself
// (public/ocr), so no screenshot and no model request goes to a third party.
// Tesseract.js is only downloaded the first time OCR actually runs.
import { emit, libraryChanged, setState } from '../state.js';
import { autoCategoryPatch } from './category.service.js';
import { hasRepo, repo } from './database.service.js';
import { getSettings } from './settings.service.js';
import { onImported } from './screenshot.service.js';

const MAX_TEXT = 100_000;
const IDLE_TERMINATE_MS = 60_000;

const queue = [];
const queued = new Set();
let running = false;
let worker = null;
let workerLangs = '';
let idleTimer = null;
let currentId = null;

export function ocrLanguages() {
  const langs = getSettings().ocrLangs?.length ? getSettings().ocrLangs : ['sqi', 'eng'];
  return langs.join('+');
}

async function getWorker() {
  const langs = ocrLanguages();
  if (worker && workerLangs === langs) return worker;
  if (worker) await worker.terminate().catch(() => {});
  const { createWorker } = await import('tesseract.js');
  const base = new URL('ocr/', document.baseURI).href;
  worker = await createWorker(langs, 1 /* LSTM only */, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core/`,
    langPath: `${base}lang`,
    gzip: true,
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text' && currentId) {
        setState({ ocrActive: { id: currentId, progress: m.progress, queued: queue.length } });
      }
    },
  });
  workerLangs = langs;
  return worker;
}

function scheduleTerminate() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (running || !worker) return;
    await worker.terminate().catch(() => {});
    worker = null;
    workerLangs = '';
  }, IDLE_TERMINATE_MS);
}

export function cleanOcrText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/** Adds screenshots to the OCR queue. `priority` puts them first. */
export function enqueueOcr(ids, { priority = false } = {}) {
  if (!getSettings().ocrEnabled) return 0;
  let added = 0;
  for (const id of [].concat(ids)) {
    if (queued.has(id) || id === currentId) continue;
    queued.add(id);
    if (priority) queue.unshift(id);
    else queue.push(id);
    added++;
  }
  emit('ocr:queue', { queued: queue.length });
  runQueue();
  return added;
}

export function cancelOcrQueue() {
  queue.length = 0;
  queued.clear();
  emit('ocr:queue', { queued: 0 });
}

export function ocrQueueLength() {
  return queue.length + (currentId ? 1 : 0);
}

async function runQueue() {
  if (running) return;
  running = true;
  clearTimeout(idleTimer);
  try {
    while (queue.length) {
      if (!hasRepo() || !getSettings().ocrEnabled) break;
      const id = queue.shift();
      queued.delete(id);
      currentId = id;
      setState({ ocrActive: { id, progress: 0, queued: queue.length } });
      await recognizeOne(id);
    }
  } finally {
    currentId = null;
    running = false;
    setState({ ocrActive: null });
    emit('ocr:queue', { queued: queue.length });
    scheduleTerminate();
  }
}

async function recognizeOne(id) {
  const r = repo();
  try {
    const item = await r.get(id);
    if (!item || item.is_trashed) return;
    await r.update(id, { ocr_status: 'processing', ocr_error: null });
    emit('ocr:progress', { id, status: 'processing' });
    const blob = await r.getOriginalBlob(item);
    const w = await getWorker();
    const { data } = await w.recognize(blob);
    let updated = await r.update(id, {
      ocr_status: 'done',
      ocr_text: cleanOcrText(data?.text),
      ocr_lang: ocrLanguages(),
      ocr_error: null,
      ocr_updated_at: new Date().toISOString(),
    });
    if (getSettings().autoCategorize && updated.category_source !== 'user') {
      const patch = autoCategoryPatch(updated);
      if (patch) updated = await r.update(id, patch);
    }
    emit('ocr:progress', { id, status: 'done' });
    libraryChanged('ocr');
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 300);
    try {
      await r.update(id, { ocr_status: 'failed', ocr_error: message, ocr_updated_at: new Date().toISOString() });
    } catch { /* the item may have been deleted meanwhile */ }
    emit('ocr:progress', { id, status: 'failed' });
    libraryChanged('ocr');
    // A failed model download would fail every item; stop and let the user retry.
    if (/fetch|network|load|traineddata/i.test(message)) {
      queue.length = 0;
      queued.clear();
      emit('ocr:fatal', { message });
    }
  }
}

/** Resumes items that were waiting for OCR when the app last closed. */
export async function resumePendingOcr() {
  const s = getSettings();
  if (!s.ocrEnabled || !s.ocrAuto || !hasRepo()) return;
  const items = await repo().needingOcr(25).catch(() => []);
  // 'processing' here means a previous session closed mid-recognition.
  const pending = items.filter((i) => i.ocr_status === 'pending' || i.ocr_status === 'processing');
  if (pending.length) enqueueOcr(pending.map((i) => i.id));
}

/** Queues every screenshot that has no text yet (user-initiated only). */
export async function ocrWholeLibrary() {
  const items = await repo().exportItems(null, { includeTrashed: false });
  return enqueueOcr(items.filter((i) => ['none', 'pending', 'processing', 'failed'].includes(i.ocr_status)).map((i) => i.id));
}

onImported((item) => enqueueOcr(item.id));

