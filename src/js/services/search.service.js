// Search ranking for the library: every query word must appear somewhere;
// weights are title 8, tags 6, filename 5, collections 3, description/notes 2,
// OCR text 1, ×1.5 when a word starts at that position. Accent-insensitive.
import { fold, startsWord, tokenize } from '../utils/text.js';

const RECENT_KEY = 'so.recentSearches';
const RECENT_MAX = 8;

export const WEIGHTS = { title: 8, tags: 6, file: 5, cols: 3, desc: 2, ocr: 1 };

export function buildFields(item, tagNames = [], collectionNames = []) {
  return {
    title: fold(item.title),
    file: fold(item.original_filename),
    desc: fold(`${item.description ?? ''} ${item.notes ?? ''}`),
    ocr: fold(item.ocr_text),
    tags: fold(tagNames.join(' ')),
    cols: fold(collectionNames.join(' ')),
  };
}

export function documentText(fields) {
  return [fields.title, fields.file, fields.desc, fields.ocr, fields.tags, fields.cols].join(' ');
}

export function fieldScore(field, tok, weight) {
  if (!field || !field.includes(tok)) return 0;
  return startsWord(field, tok) ? weight * 1.5 : weight;
}

/** @returns {number|null} null when the item does not match every token */
export function scoreFields(fields, tokens, doc = documentText(fields)) {
  if (!tokens.length) return 0;
  let score = 0;
  for (const tok of tokens) {
    if (!doc.includes(tok)) return null;
    score += fieldScore(fields.title, tok, WEIGHTS.title)
      + fieldScore(fields.tags, tok, WEIGHTS.tags)
      + fieldScore(fields.file, tok, WEIGHTS.file)
      + fieldScore(fields.cols, tok, WEIGHTS.cols)
      + fieldScore(fields.desc, tok, WEIGHTS.desc)
      + fieldScore(fields.ocr, tok, WEIGHTS.ocr);
  }
  return score;
}

export { tokenize };

export function getRecentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query) {
  const q = String(query ?? '').trim().slice(0, 100);
  if (q.length < 2) return;
  const list = [q, ...getRecentSearches().filter((s) => fold(s) !== fold(q))].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}

/** Suggestions while typing: matching tags, collections and recent searches. */
export function suggest(query, { tags = [], collections = [] } = {}) {
  const q = fold(query).trim();
  const out = [];
  const recent = getRecentSearches();
  if (!q) return recent.map((text) => ({ kind: 'recent', text }));
  for (const tag of tags) if (fold(tag.name).includes(q)) out.push({ kind: 'tag', text: tag.name, id: tag.id });
  for (const col of collections) if (fold(col.name).includes(q)) out.push({ kind: 'collection', text: col.name, id: col.id });
  for (const text of recent) if (fold(text).includes(q) && fold(text) !== q) out.push({ kind: 'recent', text });
  return out
    .sort((a, b) => Number(fold(b.text).startsWith(q)) - Number(fold(a.text).startsWith(q)))
    .slice(0, 8);
}
