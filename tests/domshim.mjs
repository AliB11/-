/**
 * حداقل شبیه‌ساز DOM برای آزمون راه‌انداز سامانه در محیط Node.
 *
 * هدف، پوشش کامل استاندارد نیست؛ تنها بخشی که app.js و views.js به‌کار می‌برند.
 * این شبیه‌ساز خطاهای زمان اجرا (شناسه اشتباه، تابع ناموجود، ویژگی نامعتبر) را
 * پیش از انتشار می‌گیرد، چون در این محیط مرورگر واقعی در دسترس نیست.
 */

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) { names.forEach((n) => this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this.sync(); }
  contains(name) { return this.set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  sync() { this.el._className = [...this.set].join(' '); }
  get value() { return this.el._className; }
  set value(v) {
    this.set = new Set(String(v).split(/\s+/).filter(Boolean));
    this.sync();
  }
}

class Style {
  constructor() { this._props = {}; }
  setProperty(k, v) { this._props[k] = v; }
  getPropertyValue(k) { return this._props[k] ?? ''; }
}

export class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = new Style();
    this.classList = new ClassList(this);
    this._className = '';
    this._innerHTML = '';
    this._textContent = '';
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.id = '';
    this.type = '';
    this.focused = false;
  }

  get className() { return this._className; }
  set className(v) { this.classList.value = v ?? ''; }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v ?? '');
    // پاک‌سازی فرزندان؛ محتوای متنی برای جست‌وجوی selector نگه داشته می‌شود
    this.children = [];
  }

  get textContent() { return this._textContent || stripTags(this._innerHTML); }
  set textContent(v) { this._textContent = String(v ?? ''); }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = value;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }

  append(...nodes) {
    for (const n of nodes) {
      if (n && typeof n === 'object') { n.parentNode = this; this.children.push(n); }
      else this._textContent += String(n);
    }
  }
  appendChild(node) { this.append(node); return node; }
  prepend(...nodes) { this.children.unshift(...nodes.filter((n) => n && typeof n === 'object')); }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  /** اجرای شنونده‌های یک رویداد؛ در صورت نبود، به والدها حباب می‌کند */
  dispatchEvent(event) {
    event.target ??= this;
    let node = this;
    while (node) {
      for (const fn of node.listeners[event.type] ?? []) {
        fn.call(node, event);
        if (event._stopped) return !event.defaultPrevented;
      }
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  focus() { this.focused = true; if (doc.activeElement) doc.activeElement.focused = false; doc.activeElement = this; }
  blur() { this.focused = false; }
  scrollIntoView() { this.scrolledIntoView = true; }
  select() { this.selected = true; }
  click() { return this.dispatchEvent(makeEvent('click', { target: this })); }
  closest(selector) { return closestFrom(this, selector); }

  querySelector(sel) { return queryAll(this, sel, 1)[0] ?? null; }
  querySelectorAll(sel) { return queryAll(this, sel); }

  /** جست‌وجوی ساده در مارک‌آپ درون‌خطی این عنصر */
  find(sel) { return queryAll(this, sel, 1)[0] ?? null; }
}

function stripTags(html) { return String(html).replace(/<[^>]*>/g, ''); }

const SELECTOR_RE = /^([a-z0-9-]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i;

export function matchesSelector(el, selector) {
  // پشتیبانی از گروه‌های ساده: «a, b»
  if (selector.includes(',')) return selector.split(',').some((s) => matchesSelector(el, s.trim()));
  // پشتیبانی از نسل: «a b» → فقط آخرین جزء بررسی می‌شود (کافی برای نیاز این آزمون)
  const parts = selector.trim().split(/\s+/);
  const last = parts[parts.length - 1];

  const m = SELECTOR_RE.exec(last);
  if (!m) return false;
  const [, tag, rest] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;

  for (const token of rest.match(/[.#][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (token.startsWith('.')) {
      if (!el.classList.contains(token.slice(1))) return false;
    } else if (token.startsWith('#')) {
      if (el.id !== token.slice(1)) return false;
    } else {
      const inner = token.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) {
        if (!el.hasAttribute(inner)) return false;
      } else {
        const name = inner.slice(0, eq);
        let want = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (!el.hasAttribute(name)) return false;
        if (el.getAttribute(name) !== want) return false;
      }
    }
  }
  return true;
}

function queryAll(root, selector, limit = Infinity) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (out.length >= limit) return;
      if (matchesSelector(child, selector)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function closestFrom(el, selector) {
  let node = el;
  while (node) {
    if (node.tagName && matchesSelector(node, selector)) return node;
    node = node.parentNode;
  }
  return null;
}

function makeEvent(type, props = {}) {
  return {
    type,
    target: null,
    key: '',
    shiftKey: false,
    defaultPrevented: false,
    _stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    ...props,
  };
}

class Document extends Element {
  constructor() {
    super('#document');
    this.readyState = 'complete';
    this.activeElement = null;
    this.body = new Element('body');
    this.body.style = new Style();
    this.append(this.body);
    this.documentElement = new Element('html');
  }
  createElement(tag) { return new Element(tag); }
  getElementById(id) { return queryAll(this, `#${id}`, 1)[0] ?? null; }
}

export const doc = new Document();

/**
 * ساخت یک درخت عناصر از مارک‌آپ — پشتیبانی محدود و کافی برای آزمون.
 * صفت‌ها و ساختار تگ‌ها خوانده می‌شوند؛ متن نادیده گرفته می‌شود.
 */
export function parseHTML(html, rootTag = 'div') {
  const root = new Element(rootTag);
  const stack = [root];
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)\/?>/g;
  let m;
  while ((m = TAG_RE.exec(html))) {
    const [, closing, tag, attrStr] = m;
    const tagLower = tag.toLowerCase();
    if (['br', 'hr', 'input', 'meta', 'link', 'img', 'path', 'circle', 'rect', 'line', 'polyline'].includes(tagLower)) {
      const el = new Element(tagLower);
      applyAttrs(el, attrStr);
      stack[stack.length - 1].append(el);
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new Element(tagLower);
    applyAttrs(el, attrStr);
    stack[stack.length - 1].append(el);
    stack.push(el);
  }
  return root;
}

function applyAttrs(el, attrStr) {
  if (!attrStr) return;
  for (const m of attrStr.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    el.setAttribute(name, value);
  }
}

/** نصب شبیه‌ساز روی globalThis تا ماژول‌های سامانه آن را ببینند */
export function installDOM() {
  const timers = [];
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.HTMLElement = Element;
  globalThis.Node = Element;
  globalThis.Event = Object;
  globalThis.CustomEvent = Object;
  globalThis.requestAnimationFrame = (fn) => { timers.push(fn); return timers.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.scrollTo = () => {};
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
  globalThis.location = { reload: () => { globalThis.__reloaded = true; } };
  return { flushTimers: () => { while (timers.length) timers.shift()(); } };
}

export { makeEvent };
