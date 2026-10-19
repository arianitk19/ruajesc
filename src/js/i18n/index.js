// Framework-free i18n. Albanian (sq) is the default; English (en) is complete.
// Keys are dotted paths into the dictionaries. Values may be strings with
// {placeholders} or plural objects { one, other } chosen with Intl.PluralRules.
import { translations } from './translations.js';
import { formatNumber, localeTag } from '../utils/formatting.js';

export const LANGUAGES = ['sq', 'en'];
const STORAGE_KEY = 'so.lang';
const listeners = new Set();
let current = 'sq';

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (params[name] != null ? String(params[name]) : match));
}

export function t(key, params) {
  let value = lookup(translations[current], key);
  if (value === undefined) value = lookup(translations.sq, key);
  if (value === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (typeof value === 'object') {
    const count = Number(params?.count ?? 0);
    const rule = new Intl.PluralRules(localeTag(current)).select(count);
    value = value[rule] ?? value.other ?? '';
    params = { ...params, count: formatNumber(count, current) };
  }
  return interpolate(String(value), params);
}

export function getLanguage() {
  return current;
}

export function detectInitialLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch { /* storage unavailable */ }
  return 'sq'; // Albanian is the default regardless of browser language.
}

export function setLanguage(lang, { persist = true } = {}) {
  if (!LANGUAGES.includes(lang)) return;
  const changed = lang !== current;
  current = lang;
  document.documentElement.lang = lang;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }
  if (changed) for (const fn of listeners) fn(lang);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
