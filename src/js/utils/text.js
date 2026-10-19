// Accent- and case-insensitive text helpers. Folding is only ever used for
// comparison — original text is never changed. "Faturë" and "fature" match,
// as do "Çështje" and "ceshtje".

const COMBINING = /[̀-ͯ]/g;
const SPECIAL = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ı: 'i' };

export function fold(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[ßæœøđłı]/g, (c) => SPECIAL[c] ?? c);
}

export function tokenize(query, max = 8) {
  const seen = new Set();
  const out = [];
  for (const raw of fold(query).trim().split(/\s+/)) {
    const tok = raw.slice(0, 64);
    if (!tok || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Splits `text` into segments marking where any of the folded `tokens` match,
 * without altering the original characters. Safe to render with text nodes.
 */
export function highlightSegments(text, tokens) {
  const source = String(text ?? '');
  if (!source || !tokens?.length) return [{ text: source, match: false }];

  let folded = '';
  const map = [];
  for (let i = 0; i < source.length; i++) {
    const f = fold(source[i]);
    for (let k = 0; k < f.length; k++) {
      folded += f[k];
      map.push(i);
    }
  }
  map.push(source.length);

  const marks = new Array(source.length).fill(false);
  for (const tok of tokens) {
    if (!tok) continue;
    let from = 0;
    while (from <= folded.length - tok.length) {
      const at = folded.indexOf(tok, from);
      if (at === -1) break;
      const start = map[at];
      const end = map[at + tok.length - 1] + 1;
      for (let i = start; i < end; i++) marks[i] = true;
      from = at + tok.length;
    }
  }

  const segments = [];
  let current = { text: '', match: marks[0] };
  for (let i = 0; i < source.length; i++) {
    if (marks[i] !== current.match) {
      if (current.text) segments.push(current);
      current = { text: '', match: marks[i] };
    }
    current.text += source[i];
  }
  if (current.text) segments.push(current);
  return segments;
}

/** Returns a short excerpt of `text` around the first token match. */
export function excerpt(text, tokens, radius = 60) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const folded = fold(source);
  let at = -1;
  for (const tok of tokens ?? []) {
    const i = folded.indexOf(tok);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return source.length > radius * 2 ? `${source.slice(0, radius * 2)}…` : source;
  const start = Math.max(0, at - radius);
  const end = Math.min(source.length, at + radius);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

/** True when `field` (already folded) contains `tok` at the start of a word. */
export function startsWord(field, tok) {
  return (' ' + field.replace(/[^\p{L}\p{N}]+/gu, ' ')).includes(' ' + tok);
}
