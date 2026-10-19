// Help: short answers to the questions people actually ask.
import { h } from '../lib/dom.js';
import { t } from '../i18n/index.js';
import { hasRepo } from '../services/database.service.js';
import { kbd, modKey, pageHeader } from '../components/ui.js';

const TOPICS = ['import', 'search', 'ocr', 'categories', 'duplicates', 'trash', 'storage', 'devices', 'offline', 'backup', 'free', 'privacy'];

export function render(ctx) {
  ctx.setTitle(t('nav.help'));
  const el = h('div', { class: 'page page--narrow' },
    pageHeader({ title: t('help.title'), subtitle: t('help.sub'), back: hasRepo() ? null : { href: '#/', label: t('app.name') } }),
    h('p', { class: 'help-shortcut' }, t('help.paletteTip'), ' ', kbd(modKey, 'K')),
    h('div', { class: 'faq' }, TOPICS.map((k, i) => h('details', { class: 'faq__item', open: i === 0 },
      h('summary', { class: 'faq__q' }, t(`help.q.${k}`)),
      h('p', { class: 'faq__a' }, t(`help.a.${k}`))))));
  return { el, bare: !hasRepo() };
}
