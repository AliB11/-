import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  stripTags,
  parseTomanAmount,
  parseRates,
  parseAllAmounts,
  toNumber,
  daysSince,
  slugify,
  foldForMatch,
} from '../tools/lib/parse.mjs';

test('ارقام فارسی و عربی به لاتین تبدیل می‌شوند', () => {
  assert.equal(normalizeText('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  assert.equal(normalizeText('١٢٣'), '123');
  assert.equal(normalizeText('بانك ملي'), 'بانک ملی');
});

test('نیم‌فاصله در متن اصلی حفظ می‌شود', () => {
  // نیم‌فاصله معناساز است و نباید به فاصله تبدیل شود
  assert.equal(normalizeText('می‌خواهم'), 'می‌خواهم');
  assert.equal(normalizeText('وام به‌جا'), 'وام به‌جا');
  assert.equal(normalizeText('  الف   ب  '), 'الف ب');
});

test('foldForMatch نیم‌فاصله و علائم را برای تطبیق حذف می‌کند', () => {
  assert.equal(foldForMatch('می‌خواهم'), 'می خواهم');
  assert.equal(foldForMatch('وام به‌جا'), 'وام به جا');
  // «به‌جا» و «به جا» باید یکسان تطبیق داده شوند
  assert.equal(foldForMatch('وام به‌جا بلوبانک'), foldForMatch('وام به جا بلوبانک'));
  assert.equal(foldForMatch('سپرده (بلندمدت)'), 'سپرده بلندمدت');
});

test('مبالغ تومانی با واحد فارسی پارس می‌شوند', () => {
  assert.equal(parseTomanAmount('300 میلیون تومان'), 300_000_000);
  assert.equal(parseTomanAmount('۴۰۰ میلیون تومان'), 400_000_000);
  assert.equal(parseTomanAmount('۱.۵ میلیارد تومان'), 1_500_000_000);
  assert.equal(parseTomanAmount('225 هزار تومان'), 225_000);
  assert.equal(parseTomanAmount('3,000,000 تومان'), 3_000_000);
  assert.equal(parseTomanAmount('بدون سقف'), null);
});

test('نرخ‌های درصدی استخراج می‌شوند', () => {
  assert.deepEqual(parseRates('نرخ سود این وام 20 درصد و کارمزد آن 4 درصد است.'), [20, 4]);
  assert.deepEqual(parseRates('سود ۲۳٪'), [23]);
  assert.deepEqual(parseRates('بدون نرخ'), []);
  // مقادیر خارج از بازه ۰ تا ۱۰۰ نادیده گرفته می‌شوند
  assert.deepEqual(parseRates('سال 1405 و نرخ 23 درصد'), [23]);
});

test('همه مبالغ یک متن استخراج می‌شوند', () => {
  const amounts = parseAllAmounts('کف 3 میلیون و سقف 400 میلیون تومان');
  assert.ok(amounts.includes(3_000_000));
  assert.ok(amounts.includes(400_000_000));
});

test('حذف تگ‌های HTML', () => {
  assert.equal(stripTags('<p>سلام <b>دنیا</b></p>'), 'سلام دنیا');
  assert.equal(stripTags('<script>alert(1)</script>متن'), 'متن');
});

test('تبدیل اعداد اعشاری', () => {
  assert.equal(toNumber('۶۹.۹'), 69.9);
  assert.equal(toNumber('24/5'), 24.5);
  assert.equal(toNumber('نامعتبر'), null);
});

test('محاسبه فاصله روزها', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  assert.equal(daysSince('2026-09-15', now), 0);
  assert.equal(daysSince('2026-09-01', now), 14);
  assert.equal(daysSince('2026-01-01', now), 257);
  assert.equal(daysSince('نامعتبر', now), Infinity);
});

test('شناسه‌سازی نام بانک‌ها', () => {
  assert.equal(slugify('بانک ملت'), 'mellat');
  assert.equal(slugify('بلوبانک'), 'blubank');
  assert.equal(slugify('بانک ناشناخته نمونه'), 'بانک-ناشناخته-نمونه');
});
