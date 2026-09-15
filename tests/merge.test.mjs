import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProducts, sortDeep } from '../tools/collect.mjs';
import { mapToProduct, extractSpecTable, parseTermMonths, categoryFromUrl, benefitFromRate } from '../tools/sources/rade.mjs';

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
