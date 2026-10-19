// Application state: a small observable store plus an event bus.
// UI modules subscribe to keys they care about and re-render themselves.

const listeners = new Map(); // key -> Set<fn>
const bus = new EventTarget();

export const state = {
  lang: 'sq',
  theme: 'system',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  route: { name: 'landing', params: {}, query: {} },
  selection: new Set(),
  selecting: false,
  libraryVersion: 0,
  ocrActive: null, // { id, progress, queued } while OCR runs
  viewerContext: null, // ids the viewer can step through
  inspectorId: null,
};

export function setState(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed.push(key);
    }
  }
  for (const key of changed) {
    for (const fn of listeners.get(key) ?? []) fn(state[key], key);
  }
}

export function subscribe(keys, fn) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const key of list) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
  }
  return () => list.forEach((key) => listeners.get(key)?.delete(fn));
}

/** Signals that library data changed so views can refresh. */
export function libraryChanged(reason = 'update') {
  setState({ libraryVersion: state.libraryVersion + 1 });
  emit('library:changed', { reason });
}

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function listen(type, fn) {
  const handler = (event) => fn(event.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}

export function toggleSelection(id, force) {
  const next = new Set(state.selection);
  const on = force ?? !next.has(id);
  if (on) next.add(id);
  else next.delete(id);
  state.selection = next;
  emit('selection:changed', { size: next.size });
}

export function clearSelection() {
  state.selection = new Set();
  setState({ selecting: false });
  emit('selection:changed', { size: 0 });
}
