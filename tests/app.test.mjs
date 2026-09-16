/**
 * آزمون یکپارچگی راه‌انداز سامانه.
 *
 * دو محافظ اصلی:
 *  ۱) قرارداد رویدادها — هر data-action که views.js تولید می‌کند باید در app.js
 *     مدیریت شده باشد؛ در غیر این صورت دکمه‌ای در سامانه بی‌اثر می‌ماند.
 *  ۲) راه‌اندازی واقعی — app.js روی یک DOM شبیه‌سازی‌شده اجرا می‌شود تا خطاهای
 *     زمان اجرا و شناسه‌های ناموجود پیش از انتشار گرفته شوند.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- ۱) قرارداد رویدادها (تحلیل ایستا) ---------- */

test('هر data-action تولیدشده در views.js در app.js مدیریت می‌شود', () => {
  const viewsSrc = read('assets/js/views.js');
  const appSrc = read('assets/js/app.js');

  const emitted = new Set(
    [...viewsSrc.matchAll(/data-action="([a-z-]+)"/g)].map((m) => m[1]),
  );
  const handled = new Set(
    [...appSrc.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]),
  );

  assert.ok(emitted.size >= 15, `تعداد اکشن‌ها کمتر از انتظار: ${emitted.size}`);

  const missing = [...emitted].filter((a) => !handled.has(a));
  assert.deepEqual(missing, [], `اکشن‌های بی‌مدیریت: ${missing.join(', ')}`);
});

test('هر data-filter تولیدشده با فیلترهای store هم‌خوان است', () => {
  const viewsSrc = read('assets/js/views.js');
  const storeSrc = read('assets/js/store.js');

  const emitted = new Set(
    [...viewsSrc.matchAll(/data-filter="([a-zA-Z]+)"/g)].map((m) => m[1]),
  );
  assert.ok(emitted.size >= 8, `تعداد فیلترها کمتر از انتظار: ${emitted.size}`);

  // فیلترها باید در شیء پیش‌فرض store.filters وجود داشته باشند
  const defaults = storeSrc.match(/filters:\s*\{([^}]*)\}/s)?.[1] ?? '';
  for (const key of emitted) {
    assert.ok(
      new RegExp(`\\b${key}\\s*:`).test(defaults),
      `فیلتر «${key}» در store.filters تعریف نشده است`,
    );
  }
});

test('نام همه کنش‌های data-action با خط تیره و بدون حرف بزرگ است', () => {
  const viewsSrc = read('assets/js/views.js');
  for (const m of viewsSrc.matchAll(/data-action="([^"]+)"/g)) {
    assert.ok(/^[a-z]+(-[a-z]+)*$/.test(m[1]), `نام کنش نامعتبر: ${m[1]}`);
  }
});

/* ---------- ۲) راه‌اندازی واقعی روی DOM شبیه‌سازی‌شده ---------- */

test('راه‌انداز سامانه روی پوسته واقعی بدون خطا اجرا می‌شود', async () => {
  const shim = await import('./domshim.mjs');
  const { doc, Element, installDOM, makeEvent } = shim;
  const timers = installDOM();

  const memory = new Map();
  globalThis.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };

  // داده درون‌خطی
  const bundleSource = read('data/bundle.js');
  const sandbox = {};
  new Function('window', `${bundleSource}; return window.__BANK_RADAR__;`)(sandbox);
  globalThis.__BANK_RADAR__ = sandbox.__BANK_RADAR__;

  // پوسته: همان شناسه‌هایی که index.html دارد
  const shellIds = [
    'hero', 'tabs', 'filters', 'toolbar', 'cards', 'rank', 'compare', 'charts',
    'footer', 'loading', 'result-count', 'nav-compare-count', 'boot-status',
    'global-search', 'drawer', 'drawer-backdrop', 'data-modal', 'method-modal', 'toast-stack',
  ];
  doc.body.innerHTML = '';
  for (const id of shellIds) {
    const el = new Element(id);
    el.id = id;
    doc.body.append(el);
  }
  globalThis.document = doc;

  // اجرای راه‌انداز
  const app = await import('../assets/js/app.js');
  await new Promise((r) => setTimeout(r, 30)); // اجازه به boot() برای تکمیل
  timers.flushTimers();

  // ۱) داده بارگذاری شده است
  assert.ok(app.store.products.length > 40, 'محصولات بارگذاری نشدند');
  const products = app.store.products.length;

  // ۲) بخش‌های اصلی رندر شده‌اند
  assert.ok(doc.getElementById('hero').innerHTML.includes('macro-cell'), 'بخش قهرمان رندر نشد');
  assert.ok(doc.getElementById('tabs').innerHTML.includes('data-key="deposits"'), 'برگه‌ها رندر نشدند');
  assert.ok(doc.getElementById('filters').innerHTML.includes('data-filter="bank"'), 'فیلترها رندر نشدند');
  assert.ok(doc.getElementById('cards').innerHTML.includes('class="card'), 'کارت‌ها رندر نشدند');
  assert.ok(doc.getElementById('charts').innerHTML.includes('<svg'), 'نمودارها رندر نشدند');
  assert.ok(doc.getElementById('footer').innerHTML.length > 100, 'پانویس رندر نشد');
  assert.equal(doc.getElementById('result-count').textContent.length > 0, true, 'شمارنده نتیجه پر نشد');

  // ۳) نوار ابزار باید کنترل مرتب‌سازی داشته باشد و پنل فیلتر همه فیلترهای پایه را
  const toolbarHTML = doc.getElementById('toolbar').innerHTML;
  assert.ok(toolbarHTML.includes('data-filter="sort"'), 'مرتب‌سازی در نوار ابزار نیست');
  for (const key of ['bank', 'minScore', 'channel', 'collateral', 'confidence', 'onlyFresh', 'onlyStale']) {
    assert.ok(
      doc.getElementById('filters').innerHTML.includes(`data-filter="${key}"`),
      `فیلتر «${key}» در پنل فیلترها رندر نشد`,
    );
  }

  // ۴) کلیک روی برگه «تسهیلات» از مسیر واقعی رویداد، داده را عوض می‌کند
  const depositsIds = app.filtered().map((p) => p.id).sort();

  // کلیک روی برگه «صندوق‌های درآمد ثابت» (دسته جدید)
  const fundsTab = new Element('button');
  fundsTab.setAttribute('data-action', 'category');
  fundsTab.setAttribute('data-key', 'funds');
  doc.body.append(fundsTab);

  fundsTab.dispatchEvent(makeEvent('click', { target: fundsTab }));
  timers.flushTimers();

  assert.equal(app.store.filters.category, 'funds', 'تغییر به دسته صندوق‌ها اعمال نشد');
  const fundRows = app.filtered();
  assert.ok(fundRows.length > 0, 'دسته صندوق‌های درآمد ثابت خالی است');
  assert.ok(fundRows.every((p) => p.category === 'funds'), 'نتایج باید همگی در دسته funds باشند');

  // عنصر دقیقاً مانند چیزی که views.js تولید می‌کند ساخته می‌شود
  const loansTab = new Element('button');
  loansTab.setAttribute('data-action', 'category');
  loansTab.setAttribute('data-key', 'loans');
  doc.body.append(loansTab);

  loansTab.dispatchEvent(makeEvent('click', { target: loansTab }));
  timers.flushTimers();

  assert.equal(app.store.filters.category, 'loans', 'تغییر دسته اعمال نشد');
  const loanRows = app.filtered();
  assert.ok(loanRows.length > 0, 'دسته تسهیلات خالی است');
  assert.ok(
    loanRows.every((p) => p.category === 'loans'),
    'نتایج شامل محصول خارج از دسته تسهیلات است',
  );
  const loanIds = loanRows.map((p) => p.id).sort();
  assert.notDeepEqual(loanIds, depositsIds, 'فهرست نتایج پس از تغییر دسته عوض نشد');

  // ۵) بازگشت به حالت اول و بررسی پایداری
  app.store.filters.category = 'deposits';
  assert.deepEqual(app.filtered().map((p) => p.id).sort(), depositsIds, 'بازگشت به دسته منابعی ناموفق بود');

  // ۶) شمارش کل محصولات تغییری نکرده است
  assert.equal(app.store.products.length, products, 'تعداد محصولات تغییر کرده است');
});
