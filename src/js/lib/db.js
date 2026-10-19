// The browser database: the whole library (metadata and image bytes) plus a
// small key-value store for job records and backup bookkeeping.
import { openDatabase, request, transaction } from './idb.js';

export const DB_NAME = 'screenshot-organizer';
export const DB_VERSION = 1;

let dbPromise = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const shots = db.createObjectStore('screenshots', { keyPath: 'id' });
    shots.createIndex('content_hash', 'content_hash');
    db.createObjectStore('blobs', { keyPath: 'key' });
    db.createObjectStore('collections', { keyPath: 'id' });
    db.createObjectStore('tags', { keyPath: 'id' });
    const sc = db.createObjectStore('screenshot_collections', { keyPath: ['screenshot_id', 'collection_id'] });
    sc.createIndex('collection_id', 'collection_id');
    const st = db.createObjectStore('screenshot_tags', { keyPath: ['screenshot_id', 'tag_id'] });
    st.createIndex('tag_id', 'tag_id');
    db.createObjectStore('duplicate_reviews', { keyPath: ['screenshot_a', 'screenshot_b'] });
    db.createObjectStore('kv', { keyPath: 'key' });
  }
}

export function getDatabase() {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    dbPromise = openDatabase(DB_NAME, DB_VERSION, upgrade).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function kvGet(key) {
  const db = await getDatabase();
  const row = await transaction(db, 'kv', 'readonly', (s) => request(s.kv.get(key)));
  return row?.value;
}

export async function kvSet(key, value) {
  const db = await getDatabase();
  await transaction(db, 'kv', 'readwrite', (s) => { s.kv.put({ key, value }); });
}

export async function kvDelete(key) {
  const db = await getDatabase();
  await transaction(db, 'kv', 'readwrite', (s) => { s.kv.delete(key); });
}

/** Closes the connection (used by tests). */
export async function closeDatabase() {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

/** Asks the browser not to evict the library under storage pressure. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage, quota, persisted };
}
