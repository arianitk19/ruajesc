// Tiny DOM toolkit. Every string child becomes a text node, so user data
// (filenames, OCR text, notes) can never be interpreted as HTML.

const BOOL_ATTRS = new Set(['disabled', 'checked', 'hidden', 'selected', 'required', 'readonly', 'multiple', 'open', 'inert', 'autofocus']);

/** h('button', { class: 'btn', onClick: fn, aria: { label: 'Close' } }, 'Text', childNode) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  append(el, children);
  return el;
}

export function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) {
      if (BOOL_ATTRS.has(key) && key in el) el[key] = false;
      continue;
    }
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'aria') for (const [k, v] of Object.entries(value)) { if (v != null) el.setAttribute(`aria-${k}`, String(v)); }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' && 'value' in el) el.value = value;
    else if (BOOL_ATTRS.has(key)) { el.setAttribute(key, ''); if (key in el) el[key] = true; }
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replaces all children. Unlike replaceChildren(), skips null/false so conditionals never render "null". */
export function replace(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return append(el, children);
}

/** Delegated event listener: on(list, 'click', '[data-action]', (e, target) => …) */
export function on(root, type, selector, handler, options) {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

export function debounce(fn, wait = 200) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/** True while focus is in a text field, so global shortcuts stay out of the way. */
export function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Download a Blob with a filename, cleaning up the object URL afterwards. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function pickFiles({ accept, multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    }, { once: true });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}
