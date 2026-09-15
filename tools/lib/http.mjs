/**
 * لایه شبکه مقاوم برای جمع‌آوری داده.
 *
 * سایت بانک‌های ایرانی اغلب کند، ناپایدار یا محافظت‌شده هستند؛ این ماژول
 * timeout، retry با backoff، محدودیت نرخ درخواست و هدرهای واقع‌گرایانه را
 * فراهم می‌کند تا یک منبع خراب کل خط لوله را متوقف نکند.
 */

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; BankRadarBot/2.0; +https://github.com/AliB11/-)';

/** تأخیر ساده */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * یک درخواست GET با timeout و retry.
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:Record<string,string>, as?:'text'|'json', accept?:string}} [opts]
 * @returns {Promise<string|any>}
 */
export async function get(url, opts = {}) {
  const {
    timeout = 20_000,
    retries = 2,
    headers = {},
    as = 'text',
    accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  } = opts;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1) + Math.random() * 300);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: accept,
          'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const text = buf.toString('utf8');
      if (as === 'json') {
        try {
          return JSON.parse(text);
        } catch {
          throw new Error('پاسخ JSON نامعتبر بود');
        }
      }
      return text;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`دریافت ${url} ناموفق بود پس از ${retries + 1} تلاش: ${lastError?.message}`);
}

/**
 * اجرای امن یک منبع؛ خطا را می‌گیرد و وضعیت سلامت برمی‌گرداند.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<{name:string, ok:boolean, data?:T, error?:string, ms:number}>}
 */
export async function runSource(name, fn) {
  const started = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, data, ms: Date.now() - started };
  } catch (err) {
    return { name, ok: false, error: String(err?.message || err), ms: Date.now() - started };
  }
}

/**
 * اجرای محدودشده موازی.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} limit
 */
export async function pool(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}
