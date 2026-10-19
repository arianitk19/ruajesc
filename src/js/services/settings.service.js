// Preferences, stored in localStorage on this device.
import { emit } from '../state.js';

export const DEFAULTS = Object.freeze({
  galleryLayout: 'grid', // grid | list
  density: 'comfortable', // compact | comfortable | large
  thumbFit: 'top', // top | contain
  sort: 'imported_at',
  dir: 'desc',
  ocrEnabled: true,
  ocrAuto: true,
  ocrLangs: ['sqi', 'eng'],
  autoCategorize: true,
  duplicateOnImport: 'skip', // skip | keep
  similarThreshold: 10, // max Hamming distance between 64-bit pHashes
  shortcutsEnabled: true,
  backupReminder: true,
  sidebarCollapsed: false,
});

const STORAGE_KEY = 'so.settings';
let current = load();

function sanitize(input) {
  const out = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return out;
  for (const [key, def] of Object.entries(DEFAULTS)) {
    const v = input[key];
    if (v === undefined) continue;
    if (Array.isArray(def)) {
      if (Array.isArray(v)) out[key] = v.filter((x) => ['sqi', 'eng'].includes(x));
    } else if (typeof v === typeof def) out[key] = v;
  }
  if (!['grid', 'list'].includes(out.galleryLayout)) out.galleryLayout = DEFAULTS.galleryLayout;
  if (!['compact', 'comfortable', 'large'].includes(out.density)) out.density = DEFAULTS.density;
  if (!['top', 'contain'].includes(out.thumbFit)) out.thumbFit = DEFAULTS.thumbFit;
  if (!['skip', 'keep'].includes(out.duplicateOnImport)) out.duplicateOnImport = DEFAULTS.duplicateOnImport;
  out.similarThreshold = Math.min(24, Math.max(0, Math.round(out.similarThreshold)));
  if (!out.ocrLangs.length) out.ocrLangs = [...DEFAULTS.ocrLangs];
  return out;
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* ignore */ }
}

export function getSettings() {
  return current;
}

export function updateSettings(patch) {
  current = sanitize({ ...current, ...patch });
  persist();
  emit('settings:changed', { patch, settings: current });
}

export function resetPreferences() {
  current = { ...DEFAULTS };
  persist();
  emit('settings:changed', { patch: { ...DEFAULTS }, settings: current });
}

// --- Theme --------------------------------------------------------------------
const THEME_KEY = 'so.theme';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return ['light', 'dark', 'system'].includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#111315' : '#F7F7F5');
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  return resolved;
}
