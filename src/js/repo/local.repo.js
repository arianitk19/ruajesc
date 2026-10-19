// The library, stored in IndexedDB. Metadata is held in memory for fast
// filtering and search; image bytes stay in IndexedDB and are only read when
// a thumbnail scrolls into view or an original is opened.
import { getDatabase } from '../lib/db.js';
import { getAll, request, transaction } from '../lib/idb.js';
import { buildFields, documentText, scoreFields } from '../services/search.service.js';
import { fold, tokenize } from '../utils/text.js';

const URL_LIMIT = 800;
const nowIso = () => new Date().toISOString();

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last regardless of direction
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export class LocalRepository {
  constructor() {
    this.kind = 'local';
    this.db = null;
    this.shots = new Map();
    this.collections = new Map();
    this.tags = new Map();
    this.shotCollections = new Map(); // screenshot_id -> Set(collection_id)
    this.shotTags = new Map(); // screenshot_id -> Set(tag_id)
    this.reviews = new Set(); // "a|b"
    this.docs = new Map(); // screenshot_id -> { fields, doc }
    this.urls = new Map(); // `${id}:${kind}` -> object URL (LRU by insertion order)
  }

  async init() {
    if (this.db) return this;
    this.db = await getDatabase();
    const [shots, collections, tags, sc, st, reviews] = await transaction(
      this.db,
      ['screenshots', 'collections', 'tags', 'screenshot_collections', 'screenshot_tags', 'duplicate_reviews'],
      'readonly',
      (s) => Promise.all([
        getAll(s.screenshots), getAll(s.collections), getAll(s.tags),
        getAll(s.screenshot_collections), getAll(s.screenshot_tags), getAll(s.duplicate_reviews),
      ]),
    );
    for (const s of shots) this.shots.set(s.id, s);
    for (const c of collections) this.collections.set(c.id, c);
    for (const t of tags) this.tags.set(t.id, t);
    for (const link of sc) this.#link(this.shotCollections, link.screenshot_id, link.collection_id);
    for (const link of st) this.#link(this.shotTags, link.screenshot_id, link.tag_id);
    for (const r of reviews) this.reviews.add(`${r.screenshot_a}|${r.screenshot_b}`);
    return this;
  }

  #link(map, a, b) {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  }

  #tagsOf(id) {
    return [...(this.shotTags.get(id) ?? [])]
      .map((tid) => this.tags.get(tid))
      .filter(Boolean)
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  }

  #decorate(item) {
    return { ...item, tags: this.#tagsOf(item.id), collection_ids: [...(this.shotCollections.get(item.id) ?? [])] };
  }

  #doc(item) {
    const cached = this.docs.get(item.id);
    if (cached && cached.updated_at === item.updated_at) return cached;
    const fields = buildFields(
      item,
      this.#tagsOf(item.id).map((t) => t.name),
      [...(this.shotCollections.get(item.id) ?? [])].map((cid) => this.collections.get(cid)?.name ?? ''),
    );
    const entry = { fields, doc: documentText(fields), updated_at: item.updated_at };
    this.docs.set(item.id, entry);
    return entry;
  }

  #invalidate(ids) {
    for (const id of ids) this.docs.delete(id);
  }

  // --- Queries ------------------------------------------------------------

  #matchesView(item, opts) {
    const view = opts.view ?? 'all';
    if (view === 'trash' ? !item.is_trashed : item.is_trashed) return false;
    if (view === 'recent' && Date.parse(item.imported_at) < Date.now() - 30 * 86400_000) return false;
    if (view === 'favorites' && !item.is_favorite) return false;
    if (view === 'uncollected' && this.shotCollections.get(item.id)?.size) return false;
    if (view === 'ocr' && !(item.ocr_status === 'done' && item.ocr_text)) return false;
    if (view === 'large' && item.file_size < (opts.largeBytes ?? 3 * 1024 * 1024)) return false;
    if (opts.collectionId && !this.shotCollections.get(item.id)?.has(opts.collectionId)) return false;
    if (opts.tagId && !this.shotTags.get(item.id)?.has(opts.tagId)) return false;
    if (opts.category && (item.category ?? 'other') !== opts.category) return false;
    if (opts.favorite != null && item.is_favorite !== opts.favorite) return false;
    return true;
  }

  async list(opts = {}) {
    const tokens = tokenize(opts.query ?? '');
    const rows = [];
    for (const item of this.shots.values()) {
      if (!this.#matchesView(item, opts)) continue;
      let rank = 0;
      if (tokens.length) {
        const { fields, doc } = this.#doc(item);
        rank = scoreFields(fields, tokens, doc);
        if (rank === null) continue;
      }
      rows.push({ item, rank });
    }
    const dir = opts.dir === 'asc' ? 1 : -1;
    const sort = opts.sort === 'relevance' && !tokens.length ? 'imported_at' : (opts.sort ?? 'imported_at');
    const key = {
      relevance: (r) => r.rank,
      captured_at: (r) => r.item.captured_at,
      original_filename: (r) => fold(r.item.original_filename),
      title: (r) => fold(r.item.title),
      file_size: (r) => r.item.file_size,
      dimensions: (r) => r.item.width * r.item.height,
      trashed_at: (r) => r.item.trashed_at,
      imported_at: (r) => r.item.imported_at,
    }[sort] ?? ((r) => r.item.imported_at);
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = ka == null || kb == null ? compareValues(ka, kb) : compareValues(ka, kb) * dir;
      if (c) return c;
      return compareValues(b.item.imported_at, a.item.imported_at) || compareValues(a.item.id, b.item.id);
    });
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(Math.max(opts.limit ?? 60, 1), 1000);
    return {
      items: rows.slice(offset, offset + limit).map((r) => ({ ...this.#decorate(r.item), rank: r.rank })),
      total: rows.length,
    };
  }

  async get(id) {
    const item = this.shots.get(id);
    return item ? this.#decorate(item) : null;
  }

  async findByHash(hash) {
    if (!hash) return [];
    return [...this.shots.values()].filter((s) => s.content_hash === hash).map((s) => this.#decorate(s));
  }

  async duplicateCandidates() {
    return [...this.shots.values()]
      .filter((s) => !s.is_trashed)
      .map(({ id, content_hash, phash, file_size, width, height, imported_at, original_filename, title, mime_type }) =>
        ({ id, content_hash, phash, file_size, width, height, imported_at, original_filename, title, mime_type }));
  }

  async listDuplicateReviews() {
    return [...this.reviews].map((k) => {
      const [screenshot_a, screenshot_b] = k.split('|');
      return { screenshot_a, screenshot_b };
    });
  }

  async addDuplicateReviews(pairs) {
    const rows = pairs.map(([x, y]) => (x < y ? { screenshot_a: x, screenshot_b: y } : { screenshot_a: y, screenshot_b: x }));
    await transaction(this.db, 'duplicate_reviews', 'readwrite', (s) => {
      for (const r of rows) s.duplicate_reviews.put({ ...r, decision: 'keep_both', created_at: nowIso() });
    });
    for (const r of rows) this.reviews.add(`${r.screenshot_a}|${r.screenshot_b}`);
  }

  async needingOcr(limit = 20) {
    return [...this.shots.values()]
      .filter((s) => !s.is_trashed && ['pending', 'processing', 'none'].includes(s.ocr_status))
      .sort((a, b) => compareValues(b.imported_at, a.imported_at))
      .slice(0, limit)
      .map((s) => this.#decorate(s));
  }

  // --- Writes -------------------------------------------------------------

  /** Saves metadata, original and thumbnail in one atomic transaction. */
  async create({ record, original, thumb }) {
    const now = nowIso();
    const item = {
      title: '', description: '', notes: '', is_favorite: false, is_trashed: false, trashed_at: null,
      ocr_status: 'none', ocr_text: null, ocr_lang: null, ocr_error: null, ocr_updated_at: null,
      category: null, category_source: null, category_evidence: [],
      ...record,
      imported_at: record.imported_at ?? now,
      updated_at: now,
    };
    await transaction(this.db, ['screenshots', 'blobs'], 'readwrite', (s) => {
      s.screenshots.add(item);
      s.blobs.put({ key: `${item.id}:original`, blob: original });
      s.blobs.put({ key: `${item.id}:thumb`, blob: thumb });
    });
    this.shots.set(item.id, item);
    return this.#decorate(item);
  }

  async update(id, patch) {
    const current = this.shots.get(id);
    if (!current) throw Object.assign(new Error('not_found'), { i18nKey: 'details.notFound' });
    const clean = { ...patch };
    for (const k of ['id', 'tags', 'collection_ids', 'rank']) delete clean[k];
    const next = { ...current, ...clean, id, updated_at: nowIso() };
    await transaction(this.db, 'screenshots', 'readwrite', (s) => { s.screenshots.put(next); });
    this.shots.set(id, next);
    this.#invalidate([id]);
    return this.#decorate(next);
  }

  async #updateMany(ids, patchFn) {
    const updates = [];
    for (const id of ids) {
      const current = this.shots.get(id);
      if (!current) continue;
      updates.push({ ...current, ...patchFn(current), id, updated_at: nowIso() });
    }
    await transaction(this.db, 'screenshots', 'readwrite', (s) => { for (const u of updates) s.screenshots.put(u); });
    for (const u of updates) this.shots.set(u.id, u);
    this.#invalidate(updates.map((u) => u.id));
    return updates.length;
  }

  setFavorite(ids, value) {
    return this.#updateMany(ids, () => ({ is_favorite: Boolean(value) }));
  }

  trash(ids) {
    const at = nowIso();
    return this.#updateMany(ids.filter((id) => !this.shots.get(id)?.is_trashed), () => ({ is_trashed: true, trashed_at: at }));
  }

  restore(ids) {
    return this.#updateMany(ids, () => ({ is_trashed: false, trashed_at: null }));
  }

  restoreAll() {
    return this.restore([...this.shots.values()].filter((s) => s.is_trashed).map((s) => s.id));
  }

  async deleteForever(ids) {
    const existing = ids.filter((id) => this.shots.has(id));
    const gone = new Set(existing);
    await transaction(
      this.db,
      ['screenshots', 'blobs', 'screenshot_collections', 'screenshot_tags', 'duplicate_reviews'],
      'readwrite',
      (s) => {
        for (const id of existing) {
          s.screenshots.delete(id);
          s.blobs.delete(`${id}:original`);
          s.blobs.delete(`${id}:thumb`);
          for (const cid of this.shotCollections.get(id) ?? []) s.screenshot_collections.delete([id, cid]);
          for (const tid of this.shotTags.get(id) ?? []) s.screenshot_tags.delete([id, tid]);
        }
        for (const key of this.reviews) {
          const [a, b] = key.split('|');
          if (gone.has(a) || gone.has(b)) s.duplicate_reviews.delete([a, b]);
        }
      },
    );
    for (const id of existing) {
      this.shots.delete(id);
      this.shotCollections.delete(id);
      this.shotTags.delete(id);
      this.docs.delete(id);
      this.#revoke(id);
    }
    for (const key of [...this.reviews]) {
      const [a, b] = key.split('|');
      if (gone.has(a) || gone.has(b)) this.reviews.delete(key);
    }
    return { deleted: existing, failed: [] };
  }

  emptyTrash() {
    return this.deleteForever([...this.shots.values()].filter((s) => s.is_trashed).map((s) => s.id));
  }

  // --- Images -------------------------------------------------------------

  async #blob(id, kind) {
    const row = await transaction(this.db, 'blobs', 'readonly', (s) => request(s.blobs.get(`${id}:${kind}`)));
    return row?.blob ?? null;
  }

  #revoke(id) {
    for (const kind of ['thumb', 'original']) {
      const key = `${id}:${kind}`;
      const url = this.urls.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        this.urls.delete(key);
      }
    }
  }

  async #url(id, kind) {
    const key = `${id}:${kind}`;
    const cached = this.urls.get(key);
    if (cached) {
      this.urls.delete(key);
      this.urls.set(key, cached);
      return cached;
    }
    const blob = await this.#blob(id, kind);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    if (this.urls.size > URL_LIMIT) {
      const [oldestKey, oldestUrl] = this.urls.entries().next().value;
      URL.revokeObjectURL(oldestUrl);
      this.urls.delete(oldestKey);
    }
    return url;
  }

  getThumbUrl(item) {
    return this.#url(item.id, 'thumb');
  }

  getOriginalUrl(item) {
    return this.#url(item.id, 'original');
  }

  getOriginalBlob(item) {
    return this.#blob(item.id, 'original');
  }

  getThumbBlob(item) {
    return this.#blob(item.id, 'thumb');
  }

  // --- Collections ----------------------------------------------------------

  #membersOf(cid) {
    return [...this.shotCollections]
      .filter(([sid, set]) => set.has(cid) && this.shots.get(sid) && !this.shots.get(sid).is_trashed)
      .map(([sid]) => this.shots.get(sid));
  }

  async listCollections() {
    return [...this.collections.values()]
      .map((c) => {
        const members = this.#membersOf(c.id).sort((a, b) => compareValues(b.imported_at, a.imported_at));
        return { ...c, screenshot_count: members.length, previews: members.slice(0, 3).map((s) => ({ id: s.id })) };
      })
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  }

  async getCollection(id) {
    const c = this.collections.get(id);
    return c ? { ...c, screenshot_count: this.#membersOf(id).length } : null;
  }

  #nameTaken(map, name, exceptId) {
    const f = fold(name.trim());
    for (const v of map.values()) if (v.id !== exceptId && fold(v.name) === f) return true;
    return false;
  }

  async createCollection({ name, description = '', color = '#10B981', icon = 'folder' }) {
    if (this.#nameTaken(this.collections, name)) throw Object.assign(new Error('duplicate'), { i18nKey: 'errors.collectionExists' });
    const now = nowIso();
    const c = { id: crypto.randomUUID(), name: name.trim(), description, color, icon, created_at: now, updated_at: now };
    await transaction(this.db, 'collections', 'readwrite', (s) => { s.collections.add(c); });
    this.collections.set(c.id, c);
    return { ...c, screenshot_count: 0, previews: [] };
  }

  async updateCollection(id, patch) {
    const current = this.collections.get(id);
    if (!current) throw new Error('not_found');
    if (patch.name && this.#nameTaken(this.collections, patch.name, id)) {
      throw Object.assign(new Error('duplicate'), { i18nKey: 'errors.collectionExists' });
    }
    const next = { ...current, ...patch, id, updated_at: nowIso() };
    await transaction(this.db, 'collections', 'readwrite', (s) => { s.collections.put(next); });
    this.collections.set(id, next);
    this.#invalidate([...this.shotCollections].filter(([, set]) => set.has(id)).map(([sid]) => sid));
    return next;
  }

  async deleteCollection(id) {
    const members = [...this.shotCollections].filter(([, set]) => set.has(id)).map(([sid]) => sid);
    await transaction(this.db, ['collections', 'screenshot_collections'], 'readwrite', (s) => {
      s.collections.delete(id);
      for (const sid of members) s.screenshot_collections.delete([sid, id]);
    });
    this.collections.delete(id);
    for (const sid of members) this.shotCollections.get(sid)?.delete(id);
    this.#invalidate(members);
  }

  async addToCollection(ids, collectionId) {
    if (!this.collections.has(collectionId)) throw new Error('not_found');
    const valid = ids.filter((id) => this.shots.has(id));
    await transaction(this.db, 'screenshot_collections', 'readwrite', (s) => {
      for (const id of valid) s.screenshot_collections.put({ screenshot_id: id, collection_id: collectionId, created_at: nowIso() });
    });
    for (const id of valid) this.#link(this.shotCollections, id, collectionId);
    this.#invalidate(valid);
    return valid.length;
  }

  async removeFromCollection(ids, collectionId) {
    await transaction(this.db, 'screenshot_collections', 'readwrite', (s) => {
      for (const id of ids) s.screenshot_collections.delete([id, collectionId]);
    });
    for (const id of ids) this.shotCollections.get(id)?.delete(collectionId);
    this.#invalidate(ids);
  }

  // --- Tags -----------------------------------------------------------------

  async listTags() {
    const counts = new Map();
    for (const [sid, set] of this.shotTags) {
      if (this.shots.get(sid)?.is_trashed) continue;
      for (const tid of set) counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }
    return [...this.tags.values()]
      .map((t) => ({ ...t, screenshot_count: counts.get(t.id) ?? 0 }))
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  }

  #ensureTags(names, s) {
    const ids = [];
    for (const raw of names) {
      const name = String(raw).replace(/\s+/g, ' ').trim().slice(0, 50);
      if (!name) continue;
      const f = fold(name);
      let tag = [...this.tags.values()].find((t) => fold(t.name) === f);
      if (!tag) {
        tag = { id: crypto.randomUUID(), name, created_at: nowIso() };
        s.tags.add(tag);
        this.tags.set(tag.id, tag);
      }
      if (!ids.includes(tag.id)) ids.push(tag.id);
    }
    return ids;
  }

  async setTags(screenshotId, names) {
    if (!this.shots.has(screenshotId)) throw new Error('not_found');
    const before = new Set(this.shotTags.get(screenshotId) ?? []);
    let after = [];
    await transaction(this.db, ['tags', 'screenshot_tags'], 'readwrite', (s) => {
      after = this.#ensureTags(names, s);
      for (const tid of before) if (!after.includes(tid)) s.screenshot_tags.delete([screenshotId, tid]);
      for (const tid of after) if (!before.has(tid)) s.screenshot_tags.put({ screenshot_id: screenshotId, tag_id: tid, created_at: nowIso() });
    });
    this.shotTags.set(screenshotId, new Set(after));
    this.#invalidate([screenshotId]);
    return this.#tagsOf(screenshotId);
  }

  async addTags(ids, names) {
    const valid = ids.filter((id) => this.shots.has(id));
    let tagIds = [];
    await transaction(this.db, ['tags', 'screenshot_tags'], 'readwrite', (s) => {
      tagIds = this.#ensureTags(names, s);
      for (const id of valid) for (const tid of tagIds) s.screenshot_tags.put({ screenshot_id: id, tag_id: tid, created_at: nowIso() });
    });
    for (const id of valid) for (const tid of tagIds) this.#link(this.shotTags, id, tid);
    this.#invalidate(valid);
    return valid.length * tagIds.length;
  }

  async renameTag(tagId, name) {
    const tag = this.tags.get(tagId);
    if (!tag) throw new Error('not_found');
    const clean = String(name).replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!clean) throw Object.assign(new Error('empty'), { i18nKey: 'errors.nameRequired' });
    if (this.#nameTaken(this.tags, clean, tagId)) throw Object.assign(new Error('duplicate'), { i18nKey: 'errors.tagExists' });
    const next = { ...tag, name: clean };
    await transaction(this.db, 'tags', 'readwrite', (s) => { s.tags.put(next); });
    this.tags.set(tagId, next);
    this.#invalidate([...this.shotTags].filter(([, set]) => set.has(tagId)).map(([sid]) => sid));
    return next;
  }

  async deleteTag(tagId) {
    const members = [...this.shotTags].filter(([, set]) => set.has(tagId)).map(([sid]) => sid);
    await transaction(this.db, ['tags', 'screenshot_tags'], 'readwrite', (s) => {
      s.tags.delete(tagId);
      for (const sid of members) s.screenshot_tags.delete([sid, tagId]);
    });
    this.tags.delete(tagId);
    for (const sid of members) this.shotTags.get(sid)?.delete(tagId);
    this.#invalidate(members);
  }

  // --- Statistics -----------------------------------------------------------

  async stats() {
    const all = [...this.shots.values()];
    const live = all.filter((s) => !s.is_trashed);
    const since = (days) => Date.now() - days * 86400_000;
    const categories = {};
    for (const s of live) categories[s.category ?? 'other'] = (categories[s.category ?? 'other'] ?? 0) + 1;
    const months = new Map();
    const first = new Date();
    first.setDate(1);
    first.setHours(0, 0, 0, 0);
    first.setMonth(first.getMonth() - 11);
    for (const s of live) {
      const d = new Date(s.imported_at);
      if (d < first) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.set(key, (months.get(key) ?? 0) + 1);
    }
    const hashCounts = new Map();
    for (const s of live) if (s.content_hash) hashCounts.set(s.content_hash, (hashCounts.get(s.content_hash) ?? 0) + 1);
    return {
      total: live.length,
      trashed: all.length - live.length,
      favorites: live.filter((s) => s.is_favorite).length,
      collections: this.collections.size,
      tags: this.tags.size,
      original_bytes: all.reduce((n, s) => n + (s.file_size ?? 0), 0),
      thumbnail_bytes: all.reduce((n, s) => n + (s.thumbnail_size ?? 0), 0),
      recent_7d: live.filter((s) => Date.parse(s.imported_at) >= since(7)).length,
      recent_30d: live.filter((s) => Date.parse(s.imported_at) >= since(30)).length,
      unorganized: live.filter((s) => !this.shotCollections.get(s.id)?.size && !this.shotTags.get(s.id)?.size).length,
      ocr: {
        done: live.filter((s) => s.ocr_status === 'done').length,
        pending: live.filter((s) => s.ocr_status === 'pending' || s.ocr_status === 'processing').length,
        failed: live.filter((s) => s.ocr_status === 'failed').length,
        none: live.filter((s) => s.ocr_status === 'none' || s.ocr_status === 'skipped').length,
      },
      categories,
      imports_by_month: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count })),
      exact_duplicate_groups: [...hashCounts.values()].filter((n) => n > 1).length,
      reviewed_duplicate_pairs: this.reviews.size,
    };
  }

  // --- Export ---------------------------------------------------------------

  async exportItems(ids = null, { includeTrashed = true } = {}) {
    const source = ids ? ids.map((id) => this.shots.get(id)).filter(Boolean) : [...this.shots.values()];
    return source.filter((s) => includeTrashed || !s.is_trashed).map((s) => this.#decorate(s));
  }

  async allCollections() {
    return [...this.collections.values()];
  }

  async count() {
    return this.shots.size;
  }

  /** Removes everything in the library. */
  async wipe() {
    await transaction(
      this.db,
      ['screenshots', 'blobs', 'collections', 'tags', 'screenshot_collections', 'screenshot_tags', 'duplicate_reviews'],
      'readwrite',
      (s) => { for (const store of Object.values(s)) store.clear(); },
    );
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.shots.clear();
    this.collections.clear();
    this.tags.clear();
    this.shotCollections.clear();
    this.shotTags.clear();
    this.reviews.clear();
    this.docs.clear();
  }
}
