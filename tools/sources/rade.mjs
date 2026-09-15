/**
 * منبع: رده (rade.ir) — مرجع مقایسه وام و خدمات بانکی ایران.
 *
 * مزیت این منبع ساختار ماشین‌خوان است: صفحات وام یک جدول مشخصات با برچسب‌های
 * ثابت دارند («نرخ سود وام»، «سقف وام»، «نوع ضمانت»، …) و فهرست کامل صفحات از
 * loan-sitemap.xml قابل کشف است. بنابراین استخراج بر پایه «برچسب» انجام می‌شود
 * نه سلکتور CSS؛ این روش در برابر تغییر قالب سایت مقاوم است.
 */

import { get, pool, runSource } from '../lib/http.mjs';
import { normalizeText, stripTags, parseTomanAmount, parseRates, toNumber } from '../lib/parse.mjs';
import { parseJalaliDate } from '../lib/jalali.mjs';

export const BASE = 'https://www.rade.ir';
const SITEMAP = `${BASE}/loan-sitemap.xml`;

/** نگاشت نوع وام رده به دسته‌بندی سامانه */
const CATEGORY_MAP = {
  'loan-interest-free-loan': { category: 'loans', subcategory: 'qarz', label: 'قرض‌الحسنه' },
  'loan-cash-loan': { category: 'loans', subcategory: 'cash', label: 'وام نقدی' },
  'loan-instant-loan': { category: 'credit', subcategory: 'digital-loan', label: 'وام فوری' },
  'loan-no-guarantor-loans': { category: 'credit', subcategory: 'no-guarantor', label: 'بدون ضامن' },
  'loan-goods-loan': { category: 'credit', subcategory: 'bnpl', label: 'وام کالا' },
  'loan-car-loan': { category: 'loans', subcategory: 'car', label: 'وام خودرو' },
  'loan-home-repair-loans': { category: 'loans', subcategory: 'housing', label: 'تعمیر مسکن' },
  'loan-housing-loans': { category: 'loans', subcategory: 'mortgage', label: 'مسکن' },
};

/** برچسب‌های جدول مشخصات که باید استخراج شوند */
const LABELS = [
  'نام وام',
  'بانک',
  'نوع وام',
  'نرخ سود وام',
  'مجموع سود وام',
  'کف وام',
  'سقف وام',
  'مبلغ قسط',
  'مجموع وام و سود',
  'حداکثر زمان بازپرداخت',
  'نیاز به سپرده',
  'نیاز به سپرده جداگانه',
  'ثبت‌نام آنلاین',
  'ثبت نام آنلاین',
  'مسدودی سپرده',
  'مدت زمان مسدودی سپرده',
  'مدت زمان خواب سپرده',
  'حداقل مبلغ سپرده',
  'نرخ سود سپرده',
  'نرخ سود سپرده پس از وام',
  'نسبت مبلغ وام به میزان سپرده',
  'حساب سپرده لازم',
  'نوع ضمانت',
  'هزینه‌های جانبی',
  'وضعیت',
  'توضیحات',
];

/**
 * سطرهای جدول HTML را به نگاشت برچسب→مقدار تبدیل می‌کند.
 * @param {string} html
 * @returns {Record<string,string>}
 */
export function extractSpecTable(html) {
  const out = {};
  const rows = String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cells || cells.length < 2) continue;

    const label = normalizeText(stripTags(cells[0])).replace(/[:\s]+$/, '');
    if (!LABELS.includes(label)) continue;

    // مقدار اصلی = بخش قبل از <br>، توضیح = بقیه
    const valueHtml = cells.slice(1).join(' ');
    const [valuePart, ...restParts] = valueHtml.split(/<br\s*\/?>/i);
    const value = normalizeText(stripTags(valuePart ?? ''));
    const detail = normalizeText(stripTags(restParts.join(' ')));
    out[label] = detail ? `${value} — ${detail}` : value;
    out[`${label}__value`] = value;
    out[`${label}__detail`] = detail;
  }
  return out;
}

/**
 * استخراج عنوان صفحه از تگ h1
 * @param {string} html
 */
export function extractTitle(html) {
  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return normalizeText(stripTags(h1[1]));
  const og = String(html).match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  return og ? normalizeText(og[1]) : '';
}

/** تبدیل مقدار «حداکثر زمان بازپرداخت» به تعداد ماه */
export function parseTermMonths(text) {
  const t = normalizeText(text);
  const months = t.match(/(\d{1,3})\s*ماه/);
  if (months) return Number(months[1]);
  const years = t.match(/(\d{1,2})\s*(?:سال|ساله)/);
  if (years) return Number(years[1]) * 12;
  return null;
}

/**
 * حدس دسته‌بندی از مسیر URL
 * @param {string} url
 */
export function categoryFromUrl(url) {
  for (const [slug, meta] of Object.entries(CATEGORY_MAP)) {
    if (url.includes(`/${slug}/`)) return meta;
  }
  return { category: 'loans', subcategory: 'other', label: 'تسهیلات' };
}

/** محاسبه امتیاز «مزیت مالی» بر پایه نرخ و نوع محصول (۰ تا ۱۰۰) */
export function benefitFromRate(rate, category) {
  if (rate == null) return 50;
  // برای تسهیلات و اعتبار: نرخ کمتر = مزیت بیشتر نسبت به سقف ۲۳٪
  if (category === 'loans' || category === 'credit') {
    const capped = Math.min(rate, 30);
    return Math.round(Math.max(5, Math.min(100, 100 - (capped / 23) * 45)));
  }
  // برای سپرده: نرخ بیشتر = مزیت بیشتر نسبت به سقف ۲۳٪
  const capped = Math.min(rate, 30);
  return Math.round(Math.max(5, Math.min(100, (capped / 23) * 60)));
}

/**
 * تبدیل یک صفحه وام رده به رکورد استاندارد سامانه.
 * @param {string} url
 * @param {string} html
 * @returns {object|null}
 */
export function mapToProduct(url, html) {
  const spec = extractSpecTable(html);
  if (!spec['نام وام__value'] && !spec['بانک__value']) return null;

  const meta = categoryFromUrl(url);
  const title = spec['نام وام__value'] || extractTitle(html);
  const bank = spec['بانک__value'] || 'نامشخص';

  const rateList = parseRates(spec['نرخ سود وام'] || '');
  const rate = rateList.length ? rateList[0] : null;

  const maxAmount = parseTomanAmount(spec['سقف وام__value'] || '');
  const minAmount = parseTomanAmount(spec['کف وام__value'] || '');
  const installment = parseTomanAmount(spec['مبلغ قسط__value'] || '');
  const termMonths = parseTermMonths(spec['حداکثر زمان بازپرداخت'] || '');
  const depositRate = parseRates(spec['نرخ سود سپرده'] || '');

  const guarantee = spec['نوع ضمانت__value'] || '';
  const hasGuarantor = /ضامن/.test(guarantee);
  const needsDeposit = /بله|دارد|الزام/.test(spec['نیاز به سپرده__value'] || '');

  const updatedRaw = normalizeText(stripTags(html)).match(
    /آخرین\s*به\s*روز\s*رسانی\s*:?\s*([^|]{4,40})/,
  );
  const lastUpdated = parseJalaliDate(updatedRaw?.[1]) || parseJalaliDate(html) || null;

  const slug = url.replace(BASE, '').replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  const numericId = slug.match(/^(\d+)/)?.[1] || slug.slice(0, 24);
  const id = `rade-${numericId}`.replace(/[^a-z0-9-]/g, '-').toLowerCase();

  const descParts = [spec['توضیحات__detail'] || spec['توضیحات'] || '']
    .map(normalizeText)
    .filter(Boolean);

  return {
    id,
    bank,
    product: title,
    category: meta.category,
    subcategory: meta.subcategory,
    rate: rate ?? (depositRate[0] ?? 0),
    rateKind: meta.category === 'loans' && rate === 4 ? 'fee' : 'profit',
    rateLabel: rate != null ? `سود ${rate}٪` : 'نامشخص',
    benefit: benefitFromRate(rate, meta.category),
    minAmount,
    maxAmount,
    amountLabel: spec['سقف وام__value'] || 'نامشخص',
    termMonths,
    termLabel: spec['حداکثر زمان بازپرداخت__value'] || 'نامشخص',
    speed: 60,
    digital: /آنلاین|اپلیکیشن|غیرحضوری/.test(descParts.join(' ')) ? 85 : 60,
    friction: hasGuarantor ? 50 : needsDeposit ? 60 : 72,
    collateral: guarantee || spec['نوع ضمانت__detail'] || 'نامشخص',
    collateralKind: hasGuarantor ? 'guarantor' : needsDeposit ? 'deposit-block' : 'credit-score',
    audience: 'متقاضیان تسهیلات بانکی',
    desc: (descParts.join(' ') || title).slice(0, 700),
    tags: [meta.label, bank.replace(/^بانک\s*/, '')].filter(Boolean),
    requirements: [
      guarantee && `ضمانت: ${guarantee}`,
      needsDeposit && `نیاز به سپرده: ${spec['حداقل مبلغ سپرده__value'] || 'دارد'}`,
      spec['هزینه‌های جانبی__value'] && `هزینه جانبی: ${spec['هزینه‌های جانبی__value']}`,
      installment && `قسط تقریبی: ${installment.toLocaleString('en-US')} تومان`,
    ].filter(Boolean),
    confidence: 'medium',
    autoDiscovered: true,
    sourceKind: 'aggregator',
    lastUpdated: lastUpdated || null,
    source: {
      title: `رده — ${title}`,
      url,
      kind: 'aggregator',
      checked: new Date().toISOString().slice(0, 10),
    },
    extra: {
      loanType: spec['نوع وام__value'] || meta.label,
      installment,
      totalWithInterest: parseTomanAmount(spec['مجموع وام و سود__value'] || ''),
      totalInterest: parseTomanAmount(spec['مجموع سود وام__value'] || ''),
    },
  };
}

/**
 * فهرست همه صفحات وام از sitemap.
 * @returns {Promise<Array<{url:string, lastmod:string|null}>>}
 */
export async function fetchLoanIndex() {
  const xml = await get(SITEMAP, { timeout: 30_000, retries: 2 });
  const out = [];
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    if (url === `${BASE}/loan/` || url === `${BASE}/loan`) continue;
    if (!Object.keys(CATEGORY_MAP).some((slug) => url.includes(`/${slug}/`))) continue;
    out.push({ url, lastmod: m[2] ? m[2].slice(0, 10) : null });
  }
  return out;
}

/**
 * دریافت و تبدیل صفحات وام.
 * @param {{limit?:number, concurrency?:number, sinceMonths?:number, log?:Function}} [opts]
 */
export async function collect(opts = {}) {
  const { limit = 120, concurrency = 5, sinceMonths = 18, log = () => {} } = opts;
  const index = await fetchLoanIndex();
  log(`رده: ${index.length} صفحه وام در فهرست یافت شد`);

  const cutoff = new Date(Date.now() - sinceMonths * 30 * 86_400_000).toISOString().slice(0, 10);
  const fresh = index.filter((e) => !e.lastmod || e.lastmod >= cutoff);
  const selected = (fresh.length ? fresh : index)
    .sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)))
    .slice(0, limit);
  log(`رده: ${selected.length} صفحه برای واکشی انتخاب شد`);

  const tasks = selected.map((entry) => async () => {
    const result = await runSource(`rade:${entry.url}`, async () => {
      const html = await get(entry.url, { timeout: 25_000, retries: 1 });
      return mapToProduct(entry.url, html);
    });
    return { entry, ...result };
  });

  const results = await pool(tasks, concurrency);
  const products = results.filter((r) => r.ok && r.data).map((r) => r.data);
  const failed = results.filter((r) => !r.ok);

  return {
    source: 'rade.ir',
    discovered: index.length,
    attempted: selected.length,
    parsed: products.length,
    failures: failed.map((f) => ({ url: f.entry.url, error: f.error })),
    products,
  };
}
