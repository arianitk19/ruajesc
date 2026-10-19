// Settings: interface, library behaviour, storage, shortcuts, privacy and data.
// Resetting preferences and deleting the library are separate actions.
import { h, replace } from '../lib/dom.js';
import { getLanguage, t } from '../i18n/index.js';
import { getLastBackup } from '../services/backup.service.js';
import { cancelOcrQueue, ocrQueueLength, ocrWholeLibrary } from '../services/ocr.service.js';
import { getSettings, resetPreferences, updateSettings } from '../services/settings.service.js';
import { clearLibrary, requestPersistence, storageSummary } from '../services/storage.service.js';
import { listen, state } from '../state.js';
import { formatBytes, formatDate, formatNumber } from '../utils/formatting.js';
import { MAX_FILE_BYTES } from '../utils/validation.js';
import { confirmDialog } from '../components/dialog.js';
import { toast, toastError } from '../components/toast.js';
import { button, kbd, modKey, pageHeader, segmented, toggle } from '../components/ui.js';

const SECTIONS = ['general', 'gallery', 'ocr', 'organize', 'storage', 'shortcuts', 'privacy', 'data'];

function section(id, title, description, ...children) {
  return h('section', { class: 'settings-section', id: `settings-${id}`, aria: { labelledby: `settings-${id}-title` } },
    h('header', { class: 'settings-section__head' },
      h('h2', { class: 'section-title', id: `settings-${id}-title` }, title),
      description ? h('p', { class: 'muted small' }, description) : null),
    h('div', { class: 'settings-section__body' }, children));
}

function row(label, description, control) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 'setting-row__text' }, h('span', { class: 'setting-row__label' }, label), description ? h('p', { class: 'setting-row__desc' }, description) : null),
    h('div', { class: 'setting-row__control' }, control));
}

export function render(ctx) {
  ctx.setTitle(t('nav.settings'));
  const s = getSettings();
  const lang = getLanguage();

  const general = section('general', t('settings.general'), null,
    row(t('settings.language.label'), t('settings.language.hint'), segmented([
      { value: 'sq', label: 'Shqip' }, { value: 'en', label: 'English' },
    ], { value: lang, label: t('settings.language.label'), onChange: (v) => ctx.setLanguage(v) })),
    row(t('settings.theme.label'), null, segmented([
      { value: 'light', label: t('settings.theme.light'), icon: 'sun' },
      { value: 'dark', label: t('settings.theme.dark'), icon: 'moon' },
      { value: 'system', label: t('settings.theme.system'), icon: 'monitor' },
    ], { value: state.theme, label: t('settings.theme.label'), onChange: (v) => ctx.setTheme(v) })));

  const gallery = section('gallery', t('settings.galleryTitle'), null,
    row(t('gallery.layout'), null, segmented([
      { value: 'grid', label: t('gallery.grid'), icon: 'layout-grid' }, { value: 'list', label: t('gallery.list'), icon: 'list' },
    ], { value: s.galleryLayout, label: t('gallery.layout'), onChange: (v) => updateSettings({ galleryLayout: v }) })),
    row(t('settings.density.label'), null, segmented(['compact', 'comfortable', 'large'].map((v) => ({ value: v, label: t(`settings.density.${v}`) })),
      { value: s.density, label: t('settings.density.label'), onChange: (v) => updateSettings({ density: v }) })),
    row(t('settings.thumbFit.label'), t('settings.thumbFit.hint'), segmented(['top', 'contain'].map((v) => ({ value: v, label: t(`settings.thumbFit.${v}`) })),
      { value: s.thumbFit, label: t('settings.thumbFit.label'), onChange: (v) => updateSettings({ thumbFit: v }) })));

  const queueText = h('p', { class: 'muted small', aria: { live: 'polite' } });
  const updateQueueText = () => { queueText.textContent = t('ocr.queueLength', { count: ocrQueueLength() }); };
  updateQueueText();
  const langBoxes = h('div', { class: 'check-group', role: 'group', aria: { label: t('ocr.languages') } },
    ['sqi', 'eng'].map((code) => {
      const id = `ocr-lang-${code}`;
      return h('label', { class: 'check', for: id },
        h('input', { type: 'checkbox', class: 'checkbox', id, checked: s.ocrLangs.includes(code), onChange: (e) => {
          const next = new Set(getSettings().ocrLangs);
          if (e.target.checked) next.add(code); else next.delete(code);
          if (!next.size) { e.target.checked = true; return toast(t('ocr.needOneLanguage'), { kind: 'error' }); }
          updateSettings({ ocrLangs: [...next] });
        } }), h('span', null, t(`ocr.lang.${code}`)));
    }));
  const ocr = section('ocr', t('ocr.title'), t('ocr.settingsIntro'),
    toggle({ label: t('ocr.enable'), description: t('ocr.enableHint'), checked: s.ocrEnabled, onChange: (v) => { updateSettings({ ocrEnabled: v }); if (!v) cancelOcrQueue(); } }),
    toggle({ label: t('ocr.auto'), description: t('ocr.autoHint'), checked: s.ocrAuto, onChange: (v) => updateSettings({ ocrAuto: v }) }),
    row(t('ocr.languages'), t('ocr.languagesHint'), langBoxes),
    h('div', { class: 'setting-actions' },
      button(t('ocr.runLibrary'), { kind: 'secondary', iconName: 'scan-text', onClick: async () => {
        try {
          const n = await ocrWholeLibrary();
          toast(n ? t('ocr.queued', { count: n }) : t('ocr.nothingToDo'), { kind: 'info' });
          updateQueueText();
        } catch (error) { toastError(error); }
      } }),
      button(t('ocr.cancelQueue'), { kind: 'quiet', onClick: () => { cancelOcrQueue(); updateQueueText(); } }),
      queueText),
    h('p', { class: 'muted small' }, t('ocr.accuracyNote')));

  const thresholdValue = h('output', { class: 'range-value' }, formatNumber(s.similarThreshold, lang));
  const range = h('input', { type: 'range', class: 'range', min: 0, max: 24, step: 1, value: s.similarThreshold, aria: { label: t('settings.similarity.label') },
    onInput: (e) => { thresholdValue.textContent = formatNumber(e.target.value, lang); },
    onChange: (e) => updateSettings({ similarThreshold: Number(e.target.value) }) });
  const organize = section('organize', t('settings.organize'), null,
    toggle({ label: t('categories.auto'), description: t('categories.autoHint'), checked: s.autoCategorize, onChange: (v) => updateSettings({ autoCategorize: v }) }),
    row(t('settings.duplicates.label'), t('settings.duplicates.hint'), segmented([
      { value: 'skip', label: t('settings.duplicates.skip') }, { value: 'keep', label: t('settings.duplicates.keep') },
    ], { value: s.duplicateOnImport, label: t('settings.duplicates.label'), onChange: (v) => updateSettings({ duplicateOnImport: v }) })),
    row(t('settings.similarity.label'), t('settings.similarity.hint'), h('div', { class: 'range-wrap' }, range, thresholdValue)),
    h('p', { class: 'muted small' }, t('settings.importLimits', { max: formatBytes(MAX_FILE_BYTES, lang) })));

  const storageBody = h('div', { class: 'storage-body' }, h('p', { class: 'muted' }, t('common.loading')));
  const storage = section('storage', t('storage.title'), t('storage.intro'), storageBody);
  async function renderStorage() {
    try {
      const [sum, last] = await Promise.all([storageSummary(), getLastBackup()]);
      replace(storageBody,
        h('dl', { class: 'meta-list' },
          h('div', { class: 'meta-row' }, h('dt', null, t('storage.libraryTotal')), h('dd', null, formatBytes(sum.library, lang))),
          sum.device ? h('div', { class: 'meta-row' }, h('dt', null, t('storage.deviceUsage')), h('dd', null, t('storage.ofQuota', { used: formatBytes(sum.device.usage, lang), quota: formatBytes(sum.device.quota, lang) }))) : null,
          sum.device ? h('div', { class: 'meta-row' }, h('dt', null, t('storage.persistent')), h('dd', null, sum.device.persisted ? t('storage.persistentOn') : t('storage.persistentOff'))) : null,
          h('div', { class: 'meta-row' }, h('dt', null, t('backup.last')), h('dd', null, last ? formatDate(last.at, lang) : t('backup.never')))),
        sum.device && !sum.device.persisted ? h('div', { class: 'setting-actions' }, button(t('storage.requestPersistent'), { kind: 'secondary', size: 'sm', iconName: 'shield', onClick: async () => {
          const granted = await requestPersistence();
          toast(granted ? t('storage.persistentGranted') : t('storage.persistentDenied'), { kind: granted ? 'success' : 'info' });
          renderStorage();
        } })) : null,
        toggle({ label: t('backup.reminderToggle'), description: t('backup.reminderToggleHint'), checked: getSettings().backupReminder, onChange: (v) => updateSettings({ backupReminder: v }) }),
        h('div', { class: 'setting-actions' }, button(t('backup.open'), { kind: 'secondary', size: 'sm', iconName: 'archive', onClick: () => ctx.navigate('/backup') })));
    } catch (error) {
      replace(storageBody, h('p', { class: 'error-text' }, t(error?.i18nKey ?? 'errors.generic')));
    }
  }

  const shortcuts = section('shortcuts', t('shortcuts.title'), t('shortcuts.intro'),
    toggle({ label: t('shortcuts.enable'), checked: s.shortcutsEnabled, onChange: (v) => updateSettings({ shortcutsEnabled: v }) }),
    h('dl', { class: 'shortcut-list' }, [
      [[modKey, 'K'], 'shortcuts.palette'], [['/'], 'shortcuts.search'], [['I'], 'shortcuts.import'],
      [['G', 'H'], 'shortcuts.home'], [['G', 'A'], 'shortcuts.all'], [['G', 'F'], 'shortcuts.favorites'], [['G', 'C'], 'shortcuts.collections'],
      [['←', '→'], 'shortcuts.viewerNav'], [['F'], 'shortcuts.viewerFavorite'], [['+', '−', '0'], 'shortcuts.viewerZoom'],
      [['Esc'], 'shortcuts.close'], [[modKey, 'V'], 'shortcuts.paste'],
    ].map(([keys, label]) => h('div', { class: 'shortcut' }, h('dt', null, t(label)), h('dd', null, kbd(...keys))))),
    h('p', { class: 'muted small' }, t('shortcuts.touch')));

  const privacy = section('privacy', t('privacy.title'), null,
    h('ul', { class: 'bullet-list' }, ['storage', 'ocr', 'tracking', 'export', 'search'].map((k) => h('li', null, t(`privacy.points.${k}`)))));

  const data = section('data', t('settings.dataTitle'), null,
    h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' }, h('span', { class: 'setting-row__label' }, t('settings.resetPrefs')), h('p', { class: 'setting-row__desc' }, t('settings.resetPrefsHint'))),
      button(t('settings.resetPrefs'), { kind: 'secondary', size: 'sm', onClick: async () => {
        const ok = await confirmDialog({ title: t('settings.resetPrefs'), message: t('settings.resetPrefsHint'), confirmLabel: t('settings.resetPrefs') });
        if (ok) { resetPreferences(); toast(t('settings.prefsReset'), { kind: 'success' }); ctx.rerender(); }
      } })),
    h('div', { class: 'setting-row' },
      h('div', { class: 'setting-row__text' }, h('span', { class: 'setting-row__label' }, t('settings.deleteLibrary')), h('p', { class: 'setting-row__desc' }, t('settings.deleteLibraryHint'))),
      button(t('settings.deleteLibrary'), { kind: 'danger', size: 'sm', onClick: async () => {
        const ok = await confirmDialog({ title: t('settings.deleteLibraryTitle'), message: t('settings.deleteLibraryText'), confirmLabel: t('settings.deleteLibrary'), danger: true, requireText: t('settings.deleteWord') });
        if (!ok) return;
        try {
          await clearLibrary();
          toast(t('settings.libraryDeleted'), { kind: 'success' });
          renderStorage();
        } catch (error) { toastError(error); }
      } })));

  const nav = h('nav', { class: 'settings-nav', aria: { label: t('settings.sections') } },
    h('ul', { role: 'list' }, SECTIONS.map((id) => h('li', null, h('a', { href: `#/settings?section=${id}`, onClick: (e) => {
      e.preventDefault();
      document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } }, t(`settings.nav.${id}`))))));

  const el = h('div', { class: 'page page--settings' },
    pageHeader({ title: t('nav.settings'), subtitle: t('settings.sub') }),
    h('div', { class: 'settings-layout' }, nav, h('div', { class: 'settings-sections' }, general, gallery, ocr, organize, storage, shortcuts, privacy, data)));

  renderStorage();
  const offs = [listen('ocr:queue', updateQueueText), listen('backup:done', renderStorage), listen('library:changed', ({ reason }) => { if (reason === 'wipe') renderStorage(); })];
  if (ctx.query.section) setTimeout(() => document.getElementById(`settings-${ctx.query.section}`)?.scrollIntoView({ block: 'start' }), 50);
  return { el, destroy: () => offs.forEach((o) => o()) };
}
