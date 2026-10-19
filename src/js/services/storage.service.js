// Storage information. Figures shown to users come from real measurements:
// summed file sizes from the library, and the browser's own storage estimate.
import { requestPersistence, storageEstimate } from '../lib/db.js';
import { libraryChanged } from '../state.js';
import { repo } from './database.service.js';

export async function storageSummary() {
  const stats = await repo().stats();
  const device = await storageEstimate().catch(() => null);
  return {
    originals: stats.original_bytes,
    thumbnails: stats.thumbnail_bytes,
    library: stats.original_bytes + stats.thumbnail_bytes,
    device, // { usage, quota, persisted } — whole-origin estimate from the browser
  };
}

export { requestPersistence };

export async function clearLibrary() {
  await repo().wipe();
  libraryChanged('wipe');
}
