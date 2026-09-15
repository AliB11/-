import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProducts, sortDeep } from '../tools/collect.mjs';
import {
  mapToProduct, extractSpecTable, specSel, tidyLabel,
  parseTermMonths, categoryFromUrl, benefitFromRate, isFeeBased,
} from '../tools/sources/rade.mjs';

test('رکورد جدید افزوده می‌شود', () => {
  const existing = [{ id: 'a', bank: 'بانک الف', product: 'محصول ۱', category: 'loans' }];
  const incoming = [{ id: 'b', bank: 'بانک ب', product: 'محصول ۲', category: 'loans', lastSeen: '2026-09-15' }];
  const { merged, stats } = mergeProducts(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(stats.added, 1);
});

test('رکورد دست‌نویس با منبع خودکار بازنویسی نمی‌شود', () => {
  const existing = [
    {
      id: 'a',
      bank: 'بانک الف',
      product: 'محصول ۱',
      category: 'loans',
      benefit: 90,
      confidence: 'high',
      source: { title: 'منبع دست‌نویس', url: 'https://example.com/original' },
    },
  ];
  const incoming = [
    {
      id: 'a',
      bank: 'بانک الف',
      product: 'محصول ۱',
      category: 'deposits',
      benefit: 10,
      confidence: 'low',
      source: { title: 'منبع خودکار', url: 'https://example.com/auto' },
      rate: 23,
      lastSeen: '2026-09-15',
    },
  ];
  const { merged } = mergeProducts(existing, incoming);
  assert.equal(merged[0].benefit, 90, 'امتیاز دست‌نویس حفظ می‌شود');
  assert.equal(merged[0].category, 'loans', 'دسته دست‌نویس حفظ می‌شود');
  assert.equal(merged[0].source.url, 'https://example.com/original', 'منبع اصلی حفظ می‌شود');
  assert.equal(merged[0].rate, 23, 'نرخ تازه از منبع خودکار اعمال می‌شود');
  assert.ok(merged[0].lastVerified, 'زمان آخرین تأیید ثبت می‌شود');
});

test('رکورد خودکارِ قدیمی حذف نمی‌شود بلکه stale می‌شود', () => {
  const existing = [
    { id: 'auto-1', bank: 'بانک ب', product: 'محصول قدیمی', category: 'loans', autoDiscovered: true, lastSeen: '2026-01-01' },
  ];
  const { merged } = mergeProducts(existing, []);
  assert.equal(merged.length, 1, 'رکورد حذف نمی‌شود');
  assert.equal(merged[0].stale, true, 'علامت stale می‌گیرد');
});

test('رکورد خودکار با تطبیق نام/بانک به‌روزرسانی می‌شود نه تکرار', () => {
  const existing = [
    { id: 'rade-100', bank: 'بانک سامان', product: 'وام نمونه', category: 'loans', autoDiscovered: true, rate: 20 },
  ];
  const incoming = [
    { id: 'rade-999', bank: 'بانک سامان', product: 'وام نمونه', category: 'loans', rate: 23, lastSeen: '2026-09-15' },
  ];
  const { merged, stats } = mergeProducts(existing, incoming);
  assert.equal(merged.length, 1, 'تکراری ساخته نمی‌شود');
  assert.equal(stats.added, 0);
  assert.equal(merged[0].rate, 23, 'نرخ به‌روز می‌شود');
});

test('مرتب‌سازی عمیق کلیدها برای diff پایدار', () => {
  const sorted = sortDeep({ b: 1, a: { d: 2, c: 3 } });
  assert.deepEqual(Object.keys(sorted), ['a', 'b']);
  assert.deepEqual(Object.keys(sorted.a), ['c', 'd']);
});

test('استخراج جدول مشخصات رده', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام به‌جا بلوبانک</td></tr>
      <tr><td>بانک</td><td>بانک سامان</td></tr>
      <tr><td>نرخ سود وام</td><td>20 ٪<br>نرخ سود این وام 20 درصد و کارمزد آن 4 درصد است.</td></tr>
      <tr><td>سقف وام</td><td>400میلیون تومان<br>سقف براساس امتیاز است.</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>12ماه<br>قابل انتخاب</td></tr>
      <tr><td>نوع ضمانت</td><td>ضامن رسمی, اعتبارسنجی</td></tr>
    </table>`;
  const spec = extractSpecTable(html);
  assert.equal(spec['نام وام__value'], 'وام به‌جا بلوبانک');
  assert.equal(spec['بانک__value'], 'بانک سامان');
  assert.equal(spec['سقف وام__value'], '400میلیون تومان');
  assert.match(spec['نرخ سود وام__detail'], /کارمزد/);
});

test('نگاشت صفحه رده به محصول استاندارد', () => {
  const html = `
    <h1>وام نمونه بانک</h1>
    <table>
      <tr><td>نام وام</td><td>وام نمونه بانک</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>نرخ سود وام</td><td>23 درصد</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>کف وام</td><td>10 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>36 ماه</td></tr>
      <tr><td>نوع ضمانت</td><td>ضامن رسمی</td></tr>
    </table>
    <div>آخرین به روز رسانی: 15 شهریور 1405</div>`;
  const p = mapToProduct('https://www.rade.ir/loan-cash-loan/704659-وام-نمونه/', html);
  assert.ok(p, 'محصول ساخته می‌شود');
  assert.equal(p.bank, 'بانک رفاه کارگران');
  assert.equal(p.rate, 23);
  assert.equal(p.maxAmount, 200_000_000);
  assert.equal(p.minAmount, 10_000_000);
  assert.equal(p.termMonths, 36);
  assert.equal(p.category, 'loans');
  assert.equal(p.collateralKind, 'guarantor');
  assert.equal(p.lastUpdated, '2026-09-06');
  assert.equal(p.autoDiscovered, true);
  assert.match(p.id, /^rade-/);
});

test('دسته‌بندی از مسیر URL', () => {
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-interest-free-loan/1-x/').category, 'loans');
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-goods-loan/1-x/').category, 'credit');
  assert.equal(categoryFromUrl('https://www.rade.ir/loan-instant-loan/1-x/').category, 'credit');
});

test('تبدیل مدت بازپرداخت به ماه', () => {
  assert.equal(parseTermMonths('12ماه'), 12);
  assert.equal(parseTermMonths('تا ۵ سال'), 60);
  assert.equal(parseTermMonths('نامشخص'), null);
});

test('امتیاز مزیت مالی با نرخ همسو است', () => {
  const low = benefitFromRate(4, 'loans');
  const mid = benefitFromRate(23, 'loans');
  assert.ok(low > mid, 'نرخ کمتر برای وام مزیت بیشتری دارد');
  const depHigh = benefitFromRate(23, 'deposits');
  const depLow = benefitFromRate(5, 'deposits');
  assert.ok(depHigh > depLow, 'نرخ بیشتر برای سپرده مزیت بیشتری دارد');
});

/* ---------- ناوابستگی به نیم‌فاصله ----------
 *
 * صفحه‌های رده در جای نیم‌فاصله (U+200C) ناسازگارند. اگر برچسب‌ها عیناً
 * جست‌وجو شوند، داده بی‌سروصدا از دست می‌رود و رکورد با مقدار خالی ذخیره
 * می‌شود — بدترین نوع خرابی، چون خطا نمی‌دهد.
 */

test('تاریخ به‌روزرسانی با نیم‌فاصله هم خوانده می‌شود', () => {
  const table = `<table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
    </table>`;
  const withZwnj = `${table}<div>آخرین به‌روز رسانی:24 شهریور 1405|انتشار: 24 شهریور 1405</div>`;
  const withoutZwnj = `${table}<div>آخرین به روز رسانی: 15 شهریور 1405</div>`;

  const a = mapToProduct('https://www.rade.ir/loan-cash-loan/1-وام/', withZwnj);
  const b = mapToProduct('https://www.rade.ir/loan-cash-loan/2-وام/', withoutZwnj);

  assert.equal(a.lastUpdated, '2026-09-15', '۲۴ شهریور ۱۴۰۵ → ۲۰۲۶-۰۹-۱۵');
  assert.equal(b.lastUpdated, '2026-09-06', '۱۵ شهریور ۱۴۰۵ → ۲۰۲۶-۰۹-۰۶');
});

test('برچسب جدول با نیم‌فاصله یا فاصله یکسان خوانده می‌شود', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک گردشگری</td></tr>
      <tr><td>هزینه های جانبی</td><td>کارمزد متداول</td></tr>
      <tr><td>ثبت نام آنلاین</td><td>بله</td></tr>
    </table>`;
  const spec = extractSpecTable(html);

  // جست‌وجو با نیم‌فاصله، در حالی که صفحه فاصله ساده دارد
  assert.equal(specSel(spec, 'هزینه‌های جانبی'), 'کارمزد متداول');
  assert.equal(specSel(spec, 'ثبت‌نام آنلاین'), 'بله');
});

test('برچسب ناشناخته مقدار خالی می‌دهد، نه خطا', () => {
  const spec = extractSpecTable('<table><tr><td>نام وام</td><td>وام</td></tr></table>');
  assert.equal(specSel(spec, 'برچسب ناموجود'), '');
  assert.equal(specSel(spec, 'برچسب ناموجود', 'detail'), '');
});

test('فاصله عدد و یکا در برچسب نمایشی مرتب می‌شود', () => {
  assert.equal(tidyLabel('100میلیون تومان'), '100 میلیون تومان');
  assert.equal(tidyLabel('12ماه'), '12 ماه');
  // normalizeText ارقام فارسی را برای تجزیه به ASCII تبدیل می‌کند و لایه نمایش
  // با fa() دوباره آن‌ها را فارسی می‌کند.
  assert.equal(tidyLabel('۲۰۰میلیارد'), '200 میلیارد');
  assert.equal(tidyLabel('  ', ), '');
});

test('سقف وابسته به رتبه اعتباری به‌عنوان سقف مشروط علامت می‌خورد', () => {
  const page = (ceilingDetail) => `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک گردشگری</td></tr>
      <tr><td>سقف وام</td><td>100میلیون تومان<br>${ceilingDetail}</td></tr>
    </table>`;

  const contingent = mapToProduct(
    'https://www.rade.ir/loan-goods-loan/1-وام/',
    page('سقف مبلغ وام بر اساس رتبه اعتباری متقاضی تعیین می‌گردد.'),
  );
  const fixed = mapToProduct(
    'https://www.rade.ir/loan-goods-loan/2-وام/',
    page('سقف ثابت برای همه متقاضیان واجد شرایط.'),
  );

  assert.equal(contingent.ceilingContingent, true, 'سقف وابسته به رتبه → مشروط');
  assert.equal(fixed.ceilingContingent, false, 'سقف ثابت → قطعی');
});

test('توضیح محصول همه پاراگراف‌های صفحه را نگه می‌دارد', () => {
  const html = `
    <table>
      <tr><td>نام وام</td><td>وام آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>توضیحات</td><td>پاراگراف اول.<br>پاراگراف دوم.<br>پاراگراف سوم.</td></tr>
    </table>`;
  const p = mapToProduct('https://www.rade.ir/loan-cash-loan/9-وام/', html);

  assert.match(p.desc, /پاراگراف اول/, 'پاراگراف اول حفظ شود');
  assert.match(p.desc, /پاراگراف دوم/, 'پاراگراف دوم حفظ شود');
  assert.match(p.desc, /پاراگراف سوم/, 'پاراگراف سوم حفظ شود');
});

test('کارمزد یک‌بار در محصولات وام به‌درستی تشخیص داده می‌شود', () => {
  const qarz = mapToProduct('https://www.rade.ir/loan-interest-free-loan/5-وام/', `
    <table>
      <tr><td>نام وام</td><td>وام قرض‌الحسنه آزمون</td></tr>
      <tr><td>بانک</td><td>بانک قرض‌الحسنه رسالت</td></tr>
      <tr><td>نرخ سود وام</td><td>4 ٪</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>60 ماه</td></tr>
    </table>`);
  const bank = mapToProduct('https://www.rade.ir/loan-cash-loan/6-وام/', `
    <table>
      <tr><td>نام وام</td><td>تسهیلات مرابحه آزمون</td></tr>
      <tr><td>بانک</td><td>بانک رفاه کارگران</td></tr>
      <tr><td>نرخ سود وام</td><td>23 ٪</td></tr>
      <tr><td>سقف وام</td><td>200 میلیون تومان</td></tr>
      <tr><td>حداکثر زمان بازپرداخت</td><td>60 ماه</td></tr>
    </table>`);

  assert.equal(qarz.rateKind, 'fee', 'نرخ ۴٪ در وام قرض‌الحسنه کارمزد یک‌بار است');
  assert.equal(bank.rateKind, 'profit', 'نرخ ۲۳٪ سود سالانه است');
});

test('تشخیص کارمزد یک‌بار در برابر سود سالانه', () => {
  const loans = { category: 'loans' };
  const deposits = { category: 'deposits' };

  // کارمزد یک‌بار
  assert.equal(isFeeBased('https://www.rade.ir/loan-interest-free-loan/1-وام-قرض‌الحسنه/', 'وام قرض‌الحسنه اصناف', loans, 4), true);
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/2-وام-ازدواج/', 'وام ازدواج', loans, 4), true);
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/3-وام-حمایتی/', 'وام حمایتی بازنشستگان', loans, 4), true);

  // سود سالانه
  assert.equal(isFeeBased('https://www.rade.ir/loan-cash-loan/4-مرابحه/', 'تسهیلات مرابحه خرد', loans, 23), false);
  assert.equal(isFeeBased('https://www.rade.ir/loan-instant-loan/5-به‌جا/', 'وام به‌جا', loans, 20), false);
  assert.equal(isFeeBased('https://www.rade.ir/loan-goods-loan/6-کارت/', 'کارت اعتباری کالا', loans, 24), false);

  // سپرده‌ها هرگز کارمزد یک‌بار نیستند
  assert.equal(isFeeBased('https://www.rade.ir/bank-account/7-سپرده/', 'سپرده بلندمدت', deposits, 4), false);
});
