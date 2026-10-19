// Opens the library. All data lives in this browser's IndexedDB; pages only
// ever call repo(), so a different storage backend could be added later
// behind the same interface without touching the UI.
import { LocalRepository } from '../repo/local.repo.js';

let active = null;

export async function openLibrary() {
  if (!active) active = await new LocalRepository().init();
  return active;
}

export function repo() {
  if (!active) throw new Error('The library is not open');
  return active;
}

export function hasRepo() {
  return Boolean(active);
}
