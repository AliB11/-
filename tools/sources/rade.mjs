/**
 * منبع: رده (rade.ir) — مرجع مقایسه وام و خدمات بانکی ایران.
 *
 * مزیت این منبع ساختار ماشین‌خوان است: صفحات وام یک جدول مشخصات با برچسب‌های
 * ثابت دارند («نرخ سود وام»، «سقف وام»، «نوع ضمانت»، …) و فهرست کامل صفحات از
 * loan-sitemap.xml قابل کشف است. بنابراین استخراج بر پایه «برچسب» انجام می‌شود
 * نه سلکتور CSS؛ این روش در برابر تغییر قالب سایت مقاوم است.
 */

import { get, pool, runSource } from '../lib/http.mjs';
import { foldForMatch, normalizeText, parseRates, parseTomanAmount, stripTags, toNumber } from '../lib/parse.mjs';
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
  'نرخ سود سپرده پس از وام',
  'هزینه فرصت مسدودی',
  'نسبت مبلغ وام به میزان سپرده',
  'حساب سپرده لازم',
  'مدت زمان مسدودی سپرده',
  'مدت زمان خواب سپرده',
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

/** مجموعه برچسب‌های مجاز به شکل تاشده (نیم‌فاصله‌ناوابسته) */
const LABEL_SET = new Set(LABELS.map((l) => foldForMatch(l)));

/**
 * سطرهای جدول HTML را به نگاشت برچسب→مقدار تبدیل می‌کند.
 * @param {string} html
 * @returns {Record<string,string>}
 */
/**
 * خواندن یک ردیف از جدول مشخصات، مستقل از نیم‌فاصله.
 *
 * صفحه‌های رده در جای نیم‌فاصله (U+200C) ناسازگارند؛ «هزینه‌های جانبی» در یک
 * صفحه و «هزینه های جانبی» در صفحه دیگر. اگر برچسب را عیناً جست‌وجو کنیم،
 * بی‌سروصدا داده از دست می‌رود. این تابع هر دو حالت را یکی می‌کند.
 *
 * @param {Record<string,string>} spec خروجی extractSpecTable
 * @param {string} label نام برچسب
 * @param {'value'|'detail'|'raw'} [part]
 */
export function specSel(spec, label, part = 'value') {
  const key = part === 'raw' ? foldForMatch(label) : `${foldForMatch(label)}__${part === 'detail' ? 'detail' : 'value'}`;
  return spec[key] ?? '';
}

export function extractSpecTable(html) {
  const out = {};
  const rows = String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cells || cells.length < 2) continue;

    // کلید با foldForMatch نرمال می‌شود تا تفاوت نیم‌فاصله و فاصله در برچسب
    // (مثلاً «هزینه‌های جانبی» در برابر «هزینه های جانبی») باعث حذف ردیف نشود.
    const label = foldForMatch(stripTags(cells[0]));
    if (!LABEL_SET.has(label)) continue;

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

/**
 * مرتب‌سازی فاصله در متنی که برای نمایش به کاربر می‌رود.
 * صفحه‌های رده عدد و یکا را بی‌فاصله می‌نویسند («100میلیون تومان»).
 */
export function tidyLabel(text) {
  return normalizeText(String(text ?? ''))
    // ارقام فارسی هم پشتیبانی می‌شوند؛ صفحه‌ها یکدست نیستند
    .replace(/([\d۰-۹])(?=(?:میلیون|میلیارد|هزار|ماه|ماهه|٪|%))/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
 * آیا هزینه این محصول «کارمزد یک‌بار» است یا «سود سالانه»؟
 *
 * وام‌های قرض‌الحسنه کارمزد یک‌باری می‌گیرند که روی کل اصل بسته می‌شود؛ وام‌های
 * سودمحور نرخ سالانه دارند. تفکیک این دو برای محاسبه قسط حیاتی است، چون
 * تفسیر نادرست کارمزد ۴٪ به‌عنوان نرخ سالانه، هزینه وام ده‌ساله را حدود ده
 * برابر واقعیت نشان می‌دهد.
 *
 * @param {string} url نشانی صفحه
 * @param {string} title عنوان محصول
 * @param {{category:string}} meta دسته‌بندی
 * @param {number|null} rate نرخ استخراج‌شده
 */
export function isFeeBased(url, title, meta, rate) {
  if (meta.category !== 'loans') return false;
  // نرخ‌های ۲۳٪ و ۲۴٪ سقف مصوب سود هستند، نه کارمزد
  if (rate == null || rate >= 20) return false;

  const text = `${url} ${title}`;

  // ۱) صریح‌ترین نشانه: مسیر یا عنوان قرض‌الحسنه
  if (/قرض‌الحسنه|قرض الحسنه|interest-free-loan/i.test(text)) return true;

  // ۲) وام‌های حمایتی (ازدواج، فرزندآوری، ایثارگران، بازنشستگان) کارمزد ثابت
  //    کم و غیرمرکب دارند و نرخ آن‌ها یک‌بار روی اصل بسته می‌شود
  if (rate <= 10 && /حمایتی|ازدواج|فرزندآوری|ایثارگر|بازنشست/.test(text)) return true;

  // ۳) نرخ‌های بسیار پایین در هر عنوان دیگری هم کارمزد یک‌بار است، چون هیچ
  //    تسهیلات سودمحوری زیر ۶٪ عرضه نمی‌شود
  return rate <= 6;
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
  if (!specSel(spec, 'نام وام') && !specSel(spec, 'بانک')) return null;

  const meta = categoryFromUrl(url);
  const title = specSel(spec, 'نام وام') || extractTitle(html);
  const bank = specSel(spec, 'بانک') || 'نامشخص';

  const rateList = parseRates(specSel(spec, 'نرخ سود وام', 'raw'));
  const rate = rateList.length ? rateList[0] : null;

  const maxAmount = parseTomanAmount(specSel(spec, 'سقف وام'));
  const minAmount = parseTomanAmount(specSel(spec, 'کف وام'));
  const installment = parseTomanAmount(specSel(spec, 'مبلغ قسط'));
  const termMonths = parseTermMonths(specSel(spec, 'حداکثر زمان بازپرداخت'));
  const depositRate = parseRates(specSel(spec, 'نرخ سود سپرده', 'raw'));

  const maxDetail = specSel(spec, 'سقف وام', 'detail');
  const guarantee = specSel(spec, 'نوع ضمانت');
  const hasGuarantor = /ضامن/.test(guarantee);
  const needsDeposit = /بله|دارد|الزام/.test(specSel(spec, 'نیاز به سپرده'));

  // سقف مشروط: اگر خود صفحه بگوید سقف بر پایه رتبه اعتباری، میانگین حساب یا
  // نسبت سپرده تعیین می‌شود، سقف یک «حق قطعی» نیست.
  const ratio = normalizeText(specSel(spec, 'نسبت مبلغ وام به میزان سپرده', 'raw'));
  const ceilingContingent =
    /رتبه\s*اعتباری|اعتبارسنجی|میانگین\s*حساب|سابقه\s*حساب|میزان\s*سپرده|ضوابط/.test(maxDetail) ||
    (ratio !== '' && !/۱۰۰|100/.test(ratio));

  // «آخرین به‌روز رسانی» و «آخرین به روز رسانی» هر دو دیده می‌شوند؛
  // [\s\u200c\u200d]* نیم‌فاصله و نیم‌فاصله مجازی را هم می‌پذیرد.
  const updatedRaw = normalizeText(stripTags(html)).match(
    /آخرین[\s\u200c\u200d]*به[\s\u200c\u200d]*روز[\s\u200c\u200d]*رسانی[\s\u200c\u200d]*:?[\s\u200c\u200d]*([^|]{4,40})/,
  );
  const lastUpdated = parseJalaliDate(updatedRaw?.[1]) || parseJalaliDate(html) || null;

  const slug = url.replace(BASE, '').replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  const numericId = slug.match(/^(\d+)/)?.[1] || slug.slice(0, 24);
  const id = `rade-${numericId}`.replace(/[^a-z0-9-]/g, '-').toLowerCase();

  // توضیحات صفحه چند پاراگراف جداشده با <br> است. اگر فقط بخش «detail» را
  // برداریم، متن از میان می‌رود و توضیح ناقص می‌ماند؛ پس هر دو بخش با هم
  // ترکیب می‌شوند.
  const descParts = [specSel(spec, 'توضیحات', 'value'), specSel(spec, 'توضیحات', 'detail')]
    .map(normalizeText)
    .filter(Boolean);

  return {
    id,
    bank,
    product: title,
    category: meta.category,
    subcategory: meta.subcategory,
    rate: rate ?? (depositRate[0] ?? 0),
    // کارمزد در برابر سود سالانه.
    //
    // این تفکیک تعیین می‌کند که موتور مالی عدد rate را سالانه مرکب حساب کند یا
    // کارمزد یک‌بار روی کل اصل. تشخیص بر پایه سه نشانه است، نه فقط عدد نرخ:
    // مسیر قرض‌الحسنه در نشانی، واژه قرض‌الحسنه در عنوان، و نرخ پایین غیرمتعارف.
    rateKind: isFeeBased(url, title, meta, rate) ? 'fee' : 'profit',
    rateLabel: rate != null ? `سود ${rate}٪` : 'نامشخص',
    regulatory: false,
    benefit: benefitFromRate(rate, meta.category),
    minAmount,
    maxAmount,
    amountLabel: tidyLabel(specSel(spec, 'سقف وام')) || 'نامشخص',
    termMonths,
    termLabel: tidyLabel(specSel(spec, 'حداکثر زمان بازپرداخت')) || 'نامشخص',
    ceilingContingent,
    speed: 60,
    digital: /آنلاین|اپلیکیشن|غیرحضوری/.test(descParts.join(' ')) ? 85 : 60,
    friction: hasGuarantor ? 50 : needsDeposit ? 60 : 72,
    collateral: guarantee || specSel(spec, 'نوع ضمانت', 'detail') || 'نامشخص',
    collateralKind: hasGuarantor ? 'guarantor' : needsDeposit ? 'deposit-block' : 'credit-score',
    audience: 'متقاضیان تسهیلات بانکی',
    desc: (descParts.join(' ') || title).slice(0, 700),
    tags: [meta.label, bank.replace(/^بانک\s*/, '')].filter(Boolean),
    requirements: [
      guarantee && `ضمانت: ${guarantee}`,
      needsDeposit && `نیاز به سپرده: ${specSel(spec, 'حداقل مبلغ سپرده') || 'دارد'}`,
      specSel(spec, 'هزینه‌های جانبی') && `هزینه جانبی: ${specSel(spec, 'هزینه‌های جانبی')}`,
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
      loanType: specSel(spec, 'نوع وام') || meta.label,
      installment,
      totalWithInterest: parseTomanAmount(specSel(spec, 'مجموع وام و سود')),
      totalInterest: parseTomanAmount(specSel(spec, 'مجموع سود وام')),
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
