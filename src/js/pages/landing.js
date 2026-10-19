// Public landing page: what the app does, and one way in.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { getLanguage, t } from '../i18n/index.js';
import { button } from '../components/ui.js';

function mockShot(kind) {
  // Abstract, hand-built screenshot illustrations (no third-party imagery).
  const lines = (n) => Array.from({ length: n }, (_, i) => h('span', { class: 'mock__line', style: { width: `${92 - ((i * 17) % 40)}%` } }));
  const content = {
    chat: [h('span', { class: 'mock__bubble mock__bubble--in' }, t('landing.mock.chatIn')), h('span', { class: 'mock__bubble mock__bubble--out' }, t('landing.mock.chatOut')), h('span', { class: 'mock__bubble mock__bubble--in mock__bubble--short' }, '👍')],
    receipt: [h('span', { class: 'mock__title' }, t('landing.mock.receipt')), ...lines(4), h('span', { class: 'mock__total' }, h('span', null, t('landing.mock.total')), h('strong', null, '42,10 €'))],
    notes: [h('span', { class: 'mock__title' }, t('landing.mock.notes')), ...['a', 'b', 'c'].map((k) => h('span', { class: 'mock__todo' }, h('span', { class: 'mock__box' }), t(`landing.mock.todo.${k}`)))],
  }[kind];
  return h('div', { class: `mock mock--${kind}` }, h('span', { class: 'mock__status' }, h('span', null, '9:41'), h('span', { class: 'mock__dots' })), content);
}

export function render(ctx) {
  ctx.setTitle(null);
  const lang = getLanguage();
  const start = () => button(t('landing.cta'), { kind: 'primary', size: 'lg', onClick: () => ctx.start() });
  const features = [['search', 'search'], ['scan-text', 'ocr'], ['folder', 'collections'], ['layers', 'duplicates'], ['archive', 'backup'], ['wifi-off', 'offline']];
  const el = h('div', { class: 'landing' },
    h('header', { class: 'landing__nav' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand__mark', aria: { hidden: 'true' } }, h('span'), h('span'), h('span')), h('span', { class: 'brand__name' }, t('app.name'))),
      h('div', { class: 'landing__nav-actions' },
        h('button', { type: 'button', class: 'btn btn--quiet lang-btn', onClick: () => ctx.setLanguage(lang === 'sq' ? 'en' : 'sq'), aria: { label: t('settings.language.label') } },
          icon('globe', { size: 17 }), h('span', null, lang === 'sq' ? 'English' : 'Shqip')))),
    h('main', { class: 'landing__main', id: 'main', tabindex: '-1' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero__copy' },
          h('h1', { class: 'hero__title', tabindex: '-1' }, h('span', { class: 'hero__line' }, t('landing.titleA')), h('span', { class: 'hero__line hero__line--soft' }, t('landing.titleB'))),
          h('p', { class: 'hero__lead' }, t('landing.lead')),
          h('div', { class: 'hero__actions' }, start()),
          h('p', { class: 'hero__note' }, icon('shield-check', { size: 16 }), h('span', null, t('landing.freeNote')))),
        h('div', { class: 'hero__visual', aria: { hidden: 'true' } },
          h('div', { class: 'hero-stack' }, mockShot('notes'), mockShot('receipt'), mockShot('chat')),
          h('div', { class: 'hero-search' }, icon('search', { size: 16 }), h('span', { class: 'hero-search__q' }, 'fatura keds'), h('span', { class: 'hero-search__hit' }, t('landing.mock.found'))))),
      h('section', { class: 'landing-section', aria: { labelledby: 'how-title' } },
        h('h2', { class: 'landing-section__title', id: 'how-title' }, t('landing.howTitle')),
        h('ol', { class: 'steps' }, ['import', 'read', 'find'].map((k, i) => h('li', { class: 'step' },
          h('span', { class: 'step__n' }, String(i + 1)),
          h('h3', { class: 'step__title' }, t(`landing.steps.${k}.title`)),
          h('p', { class: 'step__text' }, t(`landing.steps.${k}.text`)))))),
      h('section', { class: 'landing-section', aria: { labelledby: 'features-title' } },
        h('h2', { class: 'landing-section__title', id: 'features-title' }, t('landing.featuresTitle')),
        h('ul', { class: 'features', role: 'list' }, features.map(([ic, k]) => h('li', { class: 'feature' },
          h('span', { class: 'feature__icon' }, icon(ic, { size: 18 })),
          h('h3', { class: 'feature__title' }, t(`landing.features.${k}.title`)),
          h('p', { class: 'feature__text' }, t(`landing.features.${k}.text`)))))),
      h('section', { class: 'landing-free', aria: { labelledby: 'free-title' } },
        h('h2', { class: 'landing-section__title', id: 'free-title' }, t('landing.freeTitle')),
        h('p', null, t('landing.freeText')),
        h('p', { class: 'muted small' }, t('landing.freeLimits'))),
      h('section', { class: 'landing-cta' },
        h('h2', { class: 'landing-section__title' }, t('app.tagline')),
        h('div', { class: 'hero__actions' }, start()))),
    h('footer', { class: 'landing__footer' },
      h('span', null, t('app.name')),
      h('a', { href: '#/help' }, t('nav.help'))));
  return { el, bare: true };
}
