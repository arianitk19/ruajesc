// Locale-aware formatting. "sq" uses Albanian conventions (12 345,5),
// "en" uses English ones (12,345.5).

const LOCALES = { sq: 'sq-AL', en: 'en-GB' };

// Some browsers (minimal-ICU builds, older Android WebViews) ship without
// Albanian locale data and would silently format in English. Detect that and
// use built-in Albanian conventions instead.
const SQ_SUPPORTED = (() => {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(['sq']).length > 0 && Intl.NumberFormat.supportedLocalesOf(['sq']).length > 0;
  } catch {
    return false;
  }
})();
const SQ_MONTHS = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];
const SQ_MONTHS_SHORT = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj'];

export function localeTag(lang) {
  return LOCALES[lang] ?? LOCALES.sq;
}

export function formatNumber(value, lang, options = {}) {
  const n = Number(value) || 0;
  if (lang === 'sq' && !SQ_SUPPORTED) {
    const parts = new Intl.NumberFormat('en-US', { ...options, useGrouping: false }).formatToParts(n);
    let out = '';
    for (const p of parts) {
      if (p.type === 'integer') out += p.value.length >= 5 ? p.value.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : p.value;
      else if (p.type === 'decimal') out += ',';
      else if (p.type === 'percentSign') out += ' %';
      else out += p.value;
    }
    return out;
  }
  return new Intl.NumberFormat(localeTag(lang), options).format(n);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Binary-prefix file sizes (1 KB = 1024 B), the convention file managers use. */
export function formatBytes(bytes, lang = 'sq') {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${formatNumber(n, lang)} ${UNITS[0]}`;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${formatNumber(value, lang, { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

export function formatDate(value, lang = 'sq', style = 'medium') {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (lang === 'sq' && !SQ_SUPPORTED) {
    const day = date.getDate();
    const pad = (x) => String(x).padStart(2, '0');
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (style === 'short') return `${day} ${SQ_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
    if (style === 'long') return `${day} ${SQ_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${time}`;
    return `${day} ${SQ_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}, ${time}`;
  }
  const opts =
    style === 'short'
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : style === 'long'
        ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(localeTag(lang), opts).format(date);
}

export function formatMonth(yyyyMm, lang = 'sq', { withYear = true } = {}) {
  const [y, m] = String(yyyyMm).split('-').map(Number);
  if (!y || !m) return String(yyyyMm);
  if (lang === 'sq' && !SQ_SUPPORTED) return withYear ? `${SQ_MONTHS_SHORT[m - 1]} ${y}` : SQ_MONTHS_SHORT[m - 1];
  const opts = withYear ? { month: 'short', year: 'numeric' } : { month: 'short' };
  return new Intl.DateTimeFormat(localeTag(lang), opts).format(new Date(y, m - 1, 1));
}

export function formatDimensions(width, height, lang = 'sq') {
  return `${formatNumber(width, lang)} × ${formatNumber(height, lang)}`;
}

export function formatPercent(part, total, lang = 'sq') {
  if (!total) return formatNumber(0, lang, { style: 'percent' });
  return formatNumber(part / total, lang, { style: 'percent', maximumFractionDigits: 0 });
}
