// First-run onboarding: three short steps, then straight into importing.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { t } from '../i18n/index.js';
import { openImport } from '../components/import-dialog.js';
import { button } from '../components/ui.js';

const ONBOARDED_KEY = 'so.onboarded';

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* ignore */ }
}

export function isOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { return true; }
}

export function render(ctx) {
  ctx.setTitle(t('welcome.title'));
  const finish = (importNow) => {
    markOnboarded();
    ctx.navigate('/home');
    if (importNow) setTimeout(() => openImport(), 50);
  };
  const el = h('div', { class: 'page page--narrow welcome' },
    h('h1', { class: 'page-title', tabindex: '-1' }, t('welcome.title')),
    h('p', { class: 'page-sub' }, t('welcome.sub')),
    h('ol', { class: 'welcome-steps' }, [['upload', 'import'], ['scan-text', 'ocr'], ['search', 'search']].map(([ic, k], i) => h('li', { class: 'welcome-step' },
      h('span', { class: 'welcome-step__icon' }, icon(ic, { size: 18 })),
      h('div', null,
        h('h2', { class: 'welcome-step__title' }, `${i + 1}. ${t(`welcome.steps.${k}.title`)}`),
        h('p', { class: 'welcome-step__text' }, t(`welcome.steps.${k}.text`)))))),
    h('p', { class: 'notice notice--info' }, icon('hard-drive', { size: 16 }), h('span', null, t('welcome.localNote'))),
    h('div', { class: 'hero__actions' },
      button(t('welcome.importNow'), { kind: 'primary', size: 'lg', iconName: 'upload', onClick: () => finish(true) }),
      button(t('welcome.later'), { kind: 'secondary', size: 'lg', onClick: () => finish(false) })));
  return { el };
}
