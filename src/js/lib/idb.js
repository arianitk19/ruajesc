// Minimal promise wrapper around IndexedDB.

export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (event) => upgrade(req.result, event.oldVersion, req.transaction);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'));
  });
}

/**
 * Runs `fn` inside one transaction and resolves with its return value once the
 * transaction commits. Rejects (and rolls back) if anything fails.
 */
export function transaction(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    Promise.resolve()
      .then(() => fn(stores, tx))
      .then((value) => { result = value; })
      .catch((error) => {
        try { tx.abort(); } catch { /* already finished */ }
        reject(error);
      });
  });
}

export function getAll(store, query) {
  return request(store.getAll(query));
}

export function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message ?? ''));
}
