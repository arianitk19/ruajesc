// Duplicate detection. Exact duplicates: identical SHA-256. Similar: pHash
// Hamming distance at or below the user's threshold, among images with the
// same aspect ratio. Nothing is ever deleted automatically — the user chooses
// what to keep, and the rest goes to Trash (recoverable).
import { libraryChanged } from '../state.js';
import { repo } from './database.service.js';
import { getSettings } from './settings.service.js';

function popcount32(n) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hashParts(hex) {
  return [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8, 16), 16) >>> 0];
}

export function distance(a, b) {
  return popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0);
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

class UnionFind {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) { const next = this.parent.get(x); this.parent.set(x, root); x = next; }
    return root;
  }
  union(a, b) { this.parent.set(this.find(a), this.find(b)); }
}

/** Groups duplicates. Pure function over candidate rows; exported for tests. */
export async function groupDuplicates(items, reviewedPairs, { threshold = 10, similar = true, signal, onProgress } = {}) {
  const reviewed = new Set(reviewedPairs.map((r) => pairKey(r.screenshot_a, r.screenshot_b)));
  const byId = new Map(items.map((it) => [it.id, it]));
  const groups = [];
  const exactOf = new Map();

  const byHash = new Map();
  for (const it of items) {
    if (!it.content_hash) continue;
    if (!byHash.has(it.content_hash)) byHash.set(it.content_hash, []);
    byHash.get(it.content_hash).push(it);
  }
  for (const [hash, list] of byHash) {
    if (list.length < 2) continue;
    for (const it of list) exactOf.set(it.id, hash);
    groups.push({ key: `exact:${hash}`, kind: 'exact', items: list, distance: 0 });
  }

  if (similar) {
    const withHash = items.filter((it) => /^[0-9a-f]{16}$/.test(it.phash ?? ''));
    const parts = withHash.map((it) => hashParts(it.phash));
    const uf = new UnionFind();
    const maxDist = new Map();
    const total = (withHash.length * (withHash.length - 1)) / 2;
    let done = 0;
    for (let i = 0; i < withHash.length; i++) {
      for (let j = i + 1; j < withHash.length; j++) {
        const a = withHash[i];
        const b = withHash[j];
        if (exactOf.has(a.id) && exactOf.get(a.id) === exactOf.get(b.id)) continue;
        // Similar images share an aspect ratio; a phone capture never matches a desktop one.
        if (Math.abs((a.width / a.height) / (b.width / b.height) - 1) > 0.08) continue;
        const d = distance(parts[i], parts[j]);
        if (d <= threshold) {
          uf.union(a.id, b.id);
          const root = uf.find(a.id);
          maxDist.set(root, Math.max(maxDist.get(root) ?? 0, d));
        }
      }
      done += withHash.length - i - 1;
      if (i % 200 === 0) {
        onProgress?.(total ? done / total : 1);
        await new Promise((r) => setTimeout(r, 0));
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
    }
    const clusters = new Map();
    for (const id of uf.parent.keys()) {
      const root = uf.find(id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(byId.get(id));
    }
    for (const [root, list] of clusters) {
      if (list.length < 2) continue;
      if (new Set(list.map((it) => exactOf.get(it.id) ?? it.id)).size < 2) continue; // already an exact group
      groups.push({ key: `similar:${list.map((x) => x.id).sort()[0]}`, kind: 'similar', items: list, distance: maxDist.get(root) ?? 0 });
    }
  }

  for (const g of groups) {
    g.items.sort((a, b) => String(a.imported_at).localeCompare(String(b.imported_at)));
    let allReviewed = true;
    for (let i = 0; i < g.items.length && allReviewed; i++) {
      for (let j = i + 1; j < g.items.length; j++) {
        if (!reviewed.has(pairKey(g.items[i].id, g.items[j].id))) { allReviewed = false; break; }
      }
    }
    g.reviewed = allReviewed;
  }
  onProgress?.(1);
  groups.sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || (a.kind === b.kind ? b.items.length - a.items.length : a.kind === 'exact' ? -1 : 1));
  return { groups, scanned: items.length };
}

export async function findDuplicates({ signal, onProgress, similar = true } = {}) {
  const [items, reviews] = await Promise.all([repo().duplicateCandidates(), repo().listDuplicateReviews()]);
  return groupDuplicates(items, reviews, { threshold: getSettings().similarThreshold, similar, signal, onProgress });
}

/** Keeps `keepIds`, moves the rest of the group to Trash, records the review. */
export async function resolveGroup(group, keepIds) {
  const keep = new Set(keepIds);
  if (!keep.size) throw Object.assign(new Error('keep_one'), { i18nKey: 'duplicates.keepAtLeastOne' });
  const toTrash = group.items.filter((it) => !keep.has(it.id)).map((it) => it.id);
  if (toTrash.length) await repo().trash(toTrash);
  const kept = [...keep];
  const pairs = [];
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) pairs.push([kept[i], kept[j]]);
  if (pairs.length) await repo().addDuplicateReviews(pairs);
  libraryChanged('duplicates');
  return { trashed: toTrash.length };
}

export function keepAll(group) {
  return resolveGroup(group, group.items.map((it) => it.id));
}
