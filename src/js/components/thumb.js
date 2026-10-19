// Lazily loaded thumbnails. Only thumbnails near the viewport are read from
// IndexedDB; originals are never loaded to render the gallery.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { repo } from '../services/database.service.js';

let observer = null;
const targets = new WeakMap();

function getObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const load = targets.get(entry.target);
      targets.delete(entry.target);
      load?.();
    }
  }, { rootMargin: '600px 0px' });
  return observer;
}

/** @param {{id: string}} item */
export function thumbImage(item, { alt = '', className = '', eager = false } = {}) {
  const img = h('img', { class: ['thumb-img', className], alt, decoding: 'async', draggable: 'false' });
  const frame = h('span', { class: 'thumb-frame is-loading' }, img);
  const load = async () => {
    try {
      const url = await repo().getThumbUrl(item);
      if (!url) throw new Error('no_url');
      img.addEventListener('load', () => frame.classList.remove('is-loading'), { once: true });
      img.addEventListener('error', () => markBroken(frame), { once: true });
      img.src = url;
    } catch {
      markBroken(frame);
    }
  };
  if (eager || typeof IntersectionObserver === 'undefined') load();
  else {
    targets.set(frame, load);
    getObserver().observe(frame);
  }
  return frame;
}

function markBroken(frame) {
  frame.classList.remove('is-loading');
  frame.classList.add('is-broken');
  frame.append(h('span', { class: 'thumb-broken' }, icon('image-plus', { size: 20 })));
}

/** The fanned stack of up to three screenshots used on collection and category cards. */
export function screenshotStack(previews, { iconName = 'images' } = {}) {
  const cards = previews.slice(0, 3);
  return h('div', { class: ['stack', `stack--${cards.length || 0}`], aria: { hidden: 'true' } },
    cards.length
      ? cards.map((p, i) => h('div', { class: `stack__card stack__card--${i}` }, thumbImage(p)))
      : h('div', { class: 'stack__card stack__card--empty' }, icon(iconName, { size: 26 })));
}
