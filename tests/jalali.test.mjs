import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jalaliToGregorian,
  gregorianToJalali,
  isLeapJalali,
  parseJalaliDate,
  formatJalali,
} from '../tools/lib/jalali.mjs';

const iso = ({ gy, gm, gd }) =>
  `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;

test('نوروز در سال‌های مرجع درست تبدیل می‌شود', () => {
  const nowruz = {
    1399: '2020-03-20',
    1400: '2021-03-21',
    1401: '2022-03-21',
    1402: '2023-03-21',
    1403: '2024-03-20',
    1404: '2025-03-21',
    1405: '2026-03-21',
    1406: '2027-03-21',
    1407: '2028-03-20',
    1408: '2029-03-20',
  };
  for (const [jy, expected] of Object.entries(nowruz)) {
    assert.equal(iso(jalaliToGregorian(Number(jy), 1, 1)), expected, `نوروز ${jy}`);
  }
});

test('تبدیل رفت‌وبرگشت برای ۱۰۰۰ روز متوالی پایدار است', () => {
  const start = jalaliToGregorian(1400, 1, 1);
  const base = Date.UTC(start.gy, start.gm - 1, start.gd);
  for (let i = 0; i < 1000; i++) {
    const d = new Date(base + i * 86_400_000);
    const j = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    const back = jalaliToGregorian(j.jy, j.jm, j.jd);
    assert.equal(iso(back), d.toISOString().slice(0, 10), `روز ${i}`);
  }
});

test('سال‌های کبیسه شمسی شناسایی می‌شوند', () => {
  assert.equal(isLeapJalali(1403), true);
  assert.equal(isLeapJalali(1404), false);
  assert.equal(isLeapJalali(1408), true);
});

test('تاریخ شمسی داخل متن استخراج می‌شود', () => {
  assert.equal(parseJalaliDate('آخرین به روز رسانی:15 شهریور 1405'), '2026-09-06');
  assert.equal(parseJalaliDate('انتشار: 04 خرداد 1405'), '2026-05-25');
  assert.equal(parseJalaliDate('1405/06/24'), '2026-09-15');
  assert.equal(parseJalaliDate('1405-06-01'), '2026-08-23');
  assert.equal(parseJalaliDate('2026-09-15'), '2026-09-15');
  assert.equal(parseJalaliDate('متنی بدون تاریخ'), null);
});

test('قالب‌بندی خوانا', () => {
  assert.equal(formatJalali(1405, 6, 24), '24 شهریور 1405');
});
