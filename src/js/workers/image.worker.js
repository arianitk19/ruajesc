// Decodes an image off the main thread and produces everything the import
// pipeline needs: dimensions, SHA-256, perceptual hash and a WebP thumbnail.
import { PHASH_SIZE, captureDateFromBytes, pHashFromGray, rgbaToGray, sha256Hex, thumbnailGeometry } from '../utils/image-core.js';

self.onmessage = async (event) => {
  const { id, file, mime } = event.data;
  try {
    const buffer = await file.arrayBuffer();
    const hash = await sha256Hex(buffer);
    const captured = captureDateFromBytes(buffer, mime);

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      self.postMessage({ id, error: 'errors.decodeFailed' });
      return;
    }
    const { width, height } = bitmap;
    if (!width || !height) {
      bitmap.close();
      self.postMessage({ id, error: 'errors.decodeFailed' });
      return;
    }

    const g = thumbnailGeometry(width, height);
    const canvas = new OffscreenCanvas(g.targetWidth, g.targetHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, g.sourceWidth, g.sourceHeight, 0, 0, g.targetWidth, g.targetHeight);
    let thumb = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    if (thumb.type !== 'image/webp') thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });

    const small = new OffscreenCanvas(PHASH_SIZE, PHASH_SIZE);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(bitmap, 0, 0, PHASH_SIZE, PHASH_SIZE);
    const phash = pHashFromGray(rgbaToGray(sctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE).data));
    bitmap.close();

    self.postMessage({ id, result: { width, height, hash, phash, thumb, captured: captured ? captured.toISOString() : null } });
  } catch (error) {
    self.postMessage({ id, error: 'errors.processingFailed', detail: String(error?.message ?? error) });
  }
};
