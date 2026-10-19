// Main-thread entry for image processing. Uses a Web Worker with
// OffscreenCanvas when the browser supports it, and an equivalent main-thread
// path otherwise, so imports never depend on one browser feature.
import { PHASH_SIZE, captureDateFromBytes, pHashFromGray, rgbaToGray, sha256Hex, thumbnailGeometry } from './image-core.js';

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function supportsWorkerPath() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined' && !workerBroken;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/image.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, result, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(Object.assign(new Error(error), { i18nKey: error }));
    else job.resolve(result);
  };
  worker.onerror = () => {
    workerBroken = true;
    for (const job of pending.values()) job.fallback();
    pending.clear();
    worker = null;
  };
  return worker;
}

async function processOnMainThread(file, mime) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const captured = captureDateFromBytes(buffer, mime);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw Object.assign(new Error('errors.decodeFailed'), { i18nKey: 'errors.decodeFailed' });
    }
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) throw Object.assign(new Error('errors.decodeFailed'), { i18nKey: 'errors.decodeFailed' });
    const g = thumbnailGeometry(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = g.targetWidth;
    canvas.height = g.targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, g.sourceWidth, g.sourceHeight, 0, 0, g.targetWidth, g.targetHeight);
    const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    let thumb = await toBlob('image/webp', 0.82);
    if (!thumb || thumb.type !== 'image/webp') thumb = await toBlob('image/jpeg', 0.85);
    const small = document.createElement('canvas');
    small.width = PHASH_SIZE;
    small.height = PHASH_SIZE;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, PHASH_SIZE, PHASH_SIZE);
    const phash = pHashFromGray(rgbaToGray(sctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE).data));
    return { width, height, hash, phash, thumb, captured: captured ? captured.toISOString() : null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @returns {Promise<{width:number,height:number,hash:string,phash:string,thumb:Blob,captured:string|null}>}
 */
export function processImage(file, mime) {
  if (!supportsWorkerPath()) return processOnMainThread(file, mime);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, fallback: () => processOnMainThread(file, mime).then(resolve, reject) });
    getWorker().postMessage({ id, file, mime });
  });
}

export async function copyImageToClipboard(blob) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
  // Clipboard image writes are reliably supported for PNG only.
  let png = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    png = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
