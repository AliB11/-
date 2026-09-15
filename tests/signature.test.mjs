/**
 * آزمون ابزار امضای داده.
 *
 * این امضا در جریان کاری به‌روزرسانی خودکار تعیین می‌کند که آیا کامیت ساخته
 * شود یا نه؛ پس دو ویژگی آن حیاتی است:
 *   ۱) به فیلدهای فرار (مهر زمانی ساخت فایل، گزارش اجرا) حساس نباشد
 *   ۲) به هر تغییر محتوایی — حتی یک عدد — حساس باشد
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { signatureOf, canonicalize, dataSignature } from '../tools/data-signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

const baseDataset = () => ({
  products: [
    { id: 'a', bank: 'بانک آ', product: 'سپرده', rate: 23, lastSeen: '2026-09-15' },
    { id: 'b', bank: 'بانک ب', product: 'وام', rate: 4, rateKind: 'fee', lastSeen: '2026-09-15' },
  ],
  indicators: {
    indicators: { inflationAnnual: { value: 69.9, unit: '%' } },
    ranges: { depositCaps: [{ label: 'یک‌ساله', rate: 23 }] },
    derived: { realDepositReturnAnnual: -46.9 },
    period: 'مرداد ۱۴۰۵',
  },
  banks: [{ id: 'a', name: 'بانک آ' }],
});

test('امضا قطعی است و شکل ثابت دارد', () => {
  const first = signatureOf(baseDataset());
  const second = signatureOf(baseDataset());
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{16}$/);
});

test('ترتیب کلیدها روی امضا اثر ندارد', () => {
  const shuffled = baseDataset();
  shuffled.products[0] = {
    lastSeen: '2026-09-15',
    rate: 23,
    product: 'سپرده',
    bank: 'بانک آ',
    id: 'a',
  };
  assert.equal(signatureOf(shuffled), signatureOf(baseDataset()));
});

test('مهر زمانی ساخت فایل و گزارش اجرا امضا را تغییر نمی‌دهد', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-'));
  const dataset = baseDataset();

  const write = async (generatedAt, lastRun) => {
    await fs.writeFile(
      path.join(dir, 'products.json'),
      `${JSON.stringify({ generatedAt, counts: { total: 2 }, products: dataset.products }, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(path.join(dir, 'indicators.json'), JSON.stringify(dataset.indicators, null, 2), 'utf8');
    await fs.writeFile(path.join(dir, 'banks.json'), JSON.stringify({ banks: dataset.banks }, null, 2), 'utf8');
    await fs.writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ lastRun, sources: [{ name: 'rade.ir', ok: true, ms: 1234 }] }, null, 2),
      'utf8',
    );
  };

  await write('2026-09-15T03:30:00.000Z', '2026-09-15T03:31:00.000Z');
  const first = await dataSignature(dir);

  await write('2026-09-16T03:30:00.000Z', '2026-09-16T03:35:12.000Z');
  const second = await dataSignature(dir);

  assert.equal(first.signature, second.signature, 'فقط مهرهای زمانی عوض شده‌اند؛ امضا باید ثابت بماند');
  assert.deepEqual(first.counts, { products: 2, banks: 1, indicators: 1 });
});

test('هر تغییر محتوایی امضا را عوض می‌کند', () => {
  const original = signatureOf(baseDataset());

  const cases = {
    'تغییر نرخ یک محصول': (d) => { d.products[0].rate = 22.5; },
    'افزودن یک محصول': (d) => { d.products.push({ id: 'c', bank: 'بانک پ', product: 'کارت اعتباری' }); },
    'حذف یک محصول': (d) => { d.products.pop(); },
    'تغییر lastSeen (بازبینی خط لوله)': (d) => { d.products[0].lastSeen = '2026-09-16'; },
    'علامت‌گذاری رکورد به‌عنوان stale': (d) => { d.products[1].stale = true; },
    'تغییر شاخص تورم': (d) => { d.indicators.indicators.inflationAnnual.value = 70.2; },
    'تغییر بازه مصوب': (d) => { d.indicators.ranges.depositCaps[0].rate = 24; },
    'تغییر فهرست بانک‌ها': (d) => { d.banks[0].name = 'بانک آ (نئوبانک)'; },
  };

  for (const [title, mutate] of Object.entries(cases)) {
    const next = baseDataset();
    mutate(next);
    assert.notEqual(signatureOf(next), original, `${title} باید امضا را تغییر دهد`);
  }
});

test('داده خالی امضا نمی‌گیرد (شکست صریح بهتر از کامیت اشتباه است)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-empty-'));
  await fs.writeFile(path.join(dir, 'products.json'), JSON.stringify({ products: [] }), 'utf8');
  await assert.rejects(() => dataSignature(dir), /هیچ محصولی/);
});

test('رابط خط فرمان امضا و تک‌مقدارها را چاپ می‌کند', async () => {
  const tool = path.join(ROOT, 'tools/data-signature.mjs');
  const productsFile = JSON.parse(await fs.readFile(path.join(ROOT, 'data/products.json'), 'utf8'));
  const banksFile = JSON.parse(await fs.readFile(path.join(ROOT, 'data/banks.json'), 'utf8'));
  const indicatorsFile = JSON.parse(await fs.readFile(path.join(ROOT, 'data/indicators.json'), 'utf8'));

  const { stdout } = await run(process.execPath, [tool]);
  assert.match(stdout.trim(), /^[0-9a-f]{16}$/);

  const detailed = await run(process.execPath, [tool, '--json']);
  const parsed = JSON.parse(detailed.stdout);
  assert.equal(parsed.signature, stdout.trim());

  // شمارش‌ها باید با خودِ فایل‌ها بخواند (عدد ثابت نمی‌کنیم؛ داده روزانه رشد می‌کند)
  assert.deepEqual(parsed.counts, {
    products: productsFile.products.length,
    banks: banksFile.banks.length,
    indicators: Object.keys(indicatorsFile.indicators).length,
  });

  // حالت تک‌مقداری که جریان کاری استفاده می‌کند
  const fieldSig = await run(process.execPath, [tool, '--field=signature']);
  assert.equal(fieldSig.stdout.trim(), stdout.trim());
  const fieldCount = await run(process.execPath, [tool, '--field=products']);
  assert.equal(Number(fieldCount.stdout.trim()), productsFile.products.length);

  await assert.rejects(
    () => run(process.execPath, [tool, '--field=نامعتبر']),
    /فیلد ناشناخته/,
    'فیلد ناشناخته باید با کد خطا خارج شود',
  );
});

test('canonicalize ساختار تودرتو را پایدار می‌کند', () => {
  const value = { b: 1, a: { d: [3, { f: 1, e: 2 }], c: 2 } };
  assert.deepEqual(Object.keys(canonicalize(value)), ['a', 'b']);
  assert.deepEqual(Object.keys(canonicalize(value).a), ['c', 'd']);
  assert.deepEqual(Object.keys(canonicalize(value).a.d[1]), ['e', 'f']);
});
