/**
 * وضعیت مرکزی سامانه: بارگذاری داده، فیلترها، مرتب‌سازی و ماندگاری انتخاب‌ها.
 *
 * راهبرد بارگذاری داده:
 *   ۱. data/bundle.js از طریق تگ script بارگذاری می‌شود → روی file:// هم کار می‌کند
 *   ۲. در محیط وب، data/products.json تازه‌تر از بسته بررسی و در صورت تفاوت جایگزین می‌شود
 *   ۳. در نبود هر دو، پیام خطای قابل‌فهم نمایش داده می‌شود (نه صفحه سفید)
 */

import { storage, daysSince, clamp } from './util.js';
import { DEFAULT_WEIGHTS, scoreProduct, PRESETS, mostRecent } from './score.js';

const CATEGORY_META = {
  deposits: { title: 'منابعی و سپرده', short: 'سپرده', icon: '💰', color: '#2fe0a8', desc: 'سپرده‌ها، گواهی‌ها و طرح‌های سرمایه‌گذاری' },
  credit: { title: 'اعتباری و کارت', short: 'اعتبار', icon: '💳', color: '#7c8cff', desc: 'کارت اعتباری، خرید اقساطی و وام دیجیتال' },
  loans: { title: 'تسهیلاتی و وام', short: 'تسهیلات', icon: '🏦', color: '#f6c66b', desc: 'وام‌های حمایتی، قرض‌الحسنه و تسهیلات خرد' },
  loyalty: { title: 'امتیازی و باشگاه', short: 'امتیاز', icon: '⭐', color: '#ff8fb0', desc: 'باشگاه مشتریان، پاداش و خدمات دیجیتال' },
};

export { CATEGORY_META };

export const store = {
  products: [],
  banks: [],
  indicators: {},
  ranges: {},
  derived: {},
  meta: {},
  period: '',

  filters: {
    query: '',
    bank: 'all',
    minScore: 0,
    channel: 'all',
    collateral: 'all',
    confidence: 'all',
    category: 'deposits',
    sort: 'score',
    onlyFresh: false,
    onlyStale: false,
  },

  weights: { ...DEFAULT_WEIGHTS },
  activePreset: 'balanced',
  compare: new Set(),
  scored: new Map(),
  lastError: null,
};

/* ---------- بارگذاری داده ---------- */

function normalizeProduct(raw, index) {
  return {
    id: raw.id || `product-${index}`,
    bank: raw.bank || 'نامشخص',
    bankId: raw.bankId || null,
    product: raw.product || 'محصول بدون نام',
    category: CATEGORY_META[raw.category] ? raw.category : 'loans',
    subcategory: raw.subcategory || 'other',
    rate: Number(raw.rate) || 0,
    rateKind: raw.rateKind || 'profit',
    rateLabel: raw.rateLabel || '',
    benefit: numOr(raw.benefit, 55),
    minAmount: raw.minAmount ?? null,
    maxAmount: raw.maxAmount ?? null,
    amountLabel: raw.amountLabel || '',
    termMonths: raw.termMonths ?? null,
    termLabel: raw.termLabel || '',
    speed: numOr(raw.speed, 55),
    digital: numOr(raw.digital, 55),
    friction: numOr(raw.friction, 55),
    collateral: raw.collateral || 'نامشخص',
    collateralKind: raw.collateralKind || 'mixed',
    audience: raw.audience || '',
    desc: raw.desc || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    requirements: Array.isArray(raw.requirements) ? raw.requirements : [],
    confidence: raw.confidence || 'medium',
    regulatory: raw.regulatory === true,
    ceilingContingent: raw.ceilingContingent === true,
    multiPlan: raw.multiPlan === true,
    autoDiscovered: raw.autoDiscovered === true,
    stale: raw.stale === true,
    lastUpdated: raw.lastUpdated || null,
    lastSeen: raw.lastSeen || null,
    source: raw.source || null,
    extra: raw.extra || {},
  };
}

const numOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** داده درون‌خطی bundle.js */
function fromBundle() {
  const b = globalThis.__BANK_RADAR__;
  if (!b || !Array.isArray(b.products)) return null;
  return {
    products: b.products,
    banks: b.banks ?? [],
    indicators: b.indicators ?? {},
    ranges: b.ranges ?? {},
    derived: b.derived ?? {},
    period: b.period ?? '',
    meta: b.meta ?? {},
  };
}

/**
 * تلاش برای دریافت داده تازه‌تر از JSON (فقط در محیط وب).
 * در file:// این فراخوانی شکست می‌خورد و بی‌صدا نادیده گرفته می‌شود.
 */
async function fetchFresh(baseGeneratedAt) {
  try {
    const res = await fetch('data/products.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.products?.length) return null;
    if (baseGeneratedAt && json.generatedAt && json.generatedAt <= baseGeneratedAt) return null;
    return json;
  } catch {
    return null;
  }
}

/** بارگذاری کامل داده سامانه */
export async function loadData() {
  const bundled = fromBundle();
  let productsRaw = bundled?.products ?? [];
  let source = bundled ? 'bundle' : 'none';

  const fresh = await fetchFresh(bundled?.meta?.generatedAt);
  if (fresh) {
    productsRaw = fresh.products;
    source = 'json';
  }

  if (!productsRaw.length) {
    store.lastError = 'هیچ داده‌ای بارگذاری نشد. فایل data/bundle.js یا data/products.json در دسترس نیست.';
    return false;
  }

  store.products = productsRaw.map(normalizeProduct);
  store.banks = bundled?.banks ?? [];
  store.indicators = (fresh ? null : bundled?.indicators) ?? bundled?.indicators ?? {};
  store.ranges = bundled?.ranges ?? {};
  store.derived = bundled?.derived ?? {};
  store.period = bundled?.period ?? '';
  store.meta = { ...(bundled?.meta ?? {}), loadSource: source };

  // بازیابی تنظیمات کاربر
  const savedWeights = storage.get('weights');
  if (savedWeights && typeof savedWeights === 'object') {
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      if (typeof savedWeights[k] === 'number') store.weights[k] = savedWeights[k];
    }
  }
  const savedCompare = storage.get('compare');
  if (Array.isArray(savedCompare)) store.compare = new Set(savedCompare);
  const savedFilters = storage.get('filters');
  if (savedFilters && typeof savedFilters === 'object') {
    Object.assign(store.filters, savedFilters);
    if (!CATEGORY_META[store.filters.category]) store.filters.category = 'deposits';
  }

  recalculate();
  return true;
}

export function saveFilters() {
  storage.set('filters', store.filters);
}

export function saveWeights() {
  storage.set('weights', store.weights);
}

export function saveCompare() {
  storage.set('compare', [...store.compare]);
}

/* ---------- امتیازدهی ---------- */

/** بازمحاسبه امتیاز همه محصولات با وزن‌های جاری */
export function recalculate() {
  const ctx = {
    inflation: store.indicators?.inflationAnnual?.value ?? null,
    interbankRate: store.indicators?.interbankRate?.value ?? null,
  };
  store.scored = new Map();
  for (const p of store.products) {
    store.scored.set(p.id, scoreProduct(p, store.weights, ctx));
  }
}

export const scoreOf = (id) => store.scored.get(id)?.score ?? 0;
export const resultOf = (id) => store.scored.get(id) ?? { score: 0, parts: {}, realRate: null, adjustment: 0 };

/* ---------- فیلتر و مرتب‌سازی ---------- */

const normSearch = (s) =>
  String(s ?? '')
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .toLowerCase()
    .trim();

function matchesQuery(p, q) {
  if (!q) return true;
  const haystack = normSearch(
    [p.bank, p.product, p.desc, p.audience, p.collateral, (p.tags || []).join(' ')].join(' '),
  );
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/**
 * اعمال فیلترها و مرتب‌سازی روی محصولات دسته فعال.
 * @param {{ignoreCategory?:boolean}} [opts]
 */
export function filtered(opts = {}) {
  const f = store.filters;
  const q = normSearch(f.query);

  let rows = store.products.filter((p) => {
    if (!opts.ignoreCategory && p.category !== f.category) return false;
    if (!matchesQuery(p, q)) return false;
    if (f.bank !== 'all' && p.bank !== f.bank) return false;
    if (f.minScore > 0 && scoreOf(p.id) < f.minScore) return false;
    if (f.channel === 'online' && p.digital < 75) return false;
    if (f.channel === 'branch' && p.digital >= 75) return false;
    if (f.collateral === 'none' && !['none', 'credit-score'].includes(p.collateralKind)) return false;
    if (f.collateral === 'no-guarantor' && p.collateralKind === 'guarantor') return false;
    if (f.confidence !== 'all' && p.confidence !== f.confidence) return false;
    if (f.onlyFresh && daysSince(p.lastUpdated) > 60) return false;
    if (f.onlyStale && !p.stale) return false;
    return true;
  });

  const sorters = {
    score: (a, b) => scoreOf(b.id) - scoreOf(a.id),
    fresh: (a, b) => daysSince(a.lastUpdated) - daysSince(b.lastUpdated),
    rate: (a, b) => (b.rate || 0) - (a.rate || 0),
    speed: (a, b) => b.speed - a.speed,
    digital: (a, b) => b.digital - a.digital,
    ceiling: (a, b) => (b.maxAmount || 0) - (a.maxAmount || 0),
    name: (a, b) => a.bank.localeCompare(b.bank, 'fa'),
  };

  rows = [...rows].sort(sorters[f.sort] ?? sorters.score);
  return rows;
}

/** فهرست بانک‌های موجود در داده فعلی */
export function availableBanks() {
  const set = new Set(store.products.map((p) => p.bank));
  return [...set].sort((a, b) => a.localeCompare(b, 'fa'));
}

/** بانک‌های موجود فقط در یک دسته */
export function availableBanksIn(category) {
  const set = new Set(store.products.filter((p) => p.category === category).map((p) => p.bank));
  return [...set].sort((a, b) => a.localeCompare(b, 'fa'));
}

/* ---------- آمار کلی ---------- */

export function summary() {
  const products = store.products;
  const byCategory = Object.keys(CATEGORY_META).reduce((a, k) => {
    a[k] = products.filter((p) => p.category === k).length;
    return a;
  }, {});

  const scores = products.map((p) => scoreOf(p.id));

  // دو سنجه مستقل:
  //   verified30 — رکوردهایی که خط لوله در ۳۰ روز گذشته بازبینی کرده است
  //   sourceFresh30 — رکوردهایی که خود منبع در ۳۰ روز گذشته به‌روز شده است
  // تفکیک این دو مهم است: داده‌ای می‌تواند «تازه کنترل‌شده» ولی «منبع کهنه»
  // باشد، و برعکس. نمایش یک عدد به‌جای هر دو، تصویر نادرست می‌دهد.
  const verified30 = products.filter(
    (p) => daysSince(mostRecent(p.lastUpdated, p.lastSeen)) <= 30,
  ).length;
  const sourceFresh30 = products.filter((p) => daysSince(p.lastUpdated) <= 30).length;
  const fresh30 = verified30;
  const stale = products.filter((p) => p.stale).length;
  const auto = products.filter((p) => p.autoDiscovered).length;
  const missingDate = products.filter((p) => !p.lastUpdated).length;

  return {
    total: products.length,
    banks: new Set(products.map((p) => p.bank)).size,
    byCategory,
    fresh30,
    verified30,
    sourceFresh30,
    stale,
    auto,
    missingDate,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    maxScore: scores.length ? Math.max(...scores) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
    confidence: {
      high: products.filter((p) => p.confidence === 'high').length,
      medium: products.filter((p) => p.confidence === 'medium').length,
      low: products.filter((p) => p.confidence === 'low').length,
    },
    /** امتیاز سلامت کل داده: ترکیب تازگی، اطمینان و پوشش */
    /**
     * امتیاز سلامت مجموعه داده.
     *
     * پوشش بازبینی مهم‌ترین عامل است (۴۵) چون نشان می‌دهد خط لوله کار می‌کند.
     * تازگی خودِ منبع وزن سبک‌تری دارد (۲۰) چون به رفتار بانک‌ها بستگی دارد
     * و در اختیار این سامانه نیست. اطمینان منبع ۲۰ و نبود رکورد منقضی ۱۵.
     */
    health: Math.round(
      clamp(
        (verified30 / Math.max(1, products.length)) * 45 +
          (sourceFresh30 / Math.max(1, products.length)) * 20 +
          (products.filter((p) => p.confidence === 'high').length / Math.max(1, products.length)) * 20 +
          (1 - stale / Math.max(1, products.length)) * 15,
        0,
        100,
      ),
    ),
  };
}

/** اعمال یک پروفایل وزن */
export function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  store.weights = { ...preset.w };
  store.activePreset = key;
  saveWeights();
  recalculate();
}

export { PRESETS };
