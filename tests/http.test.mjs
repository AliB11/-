/**
 * آزمون لایه شبکه.
 *
 * این آزمون‌ها روی یک سرور محلی اجرا می‌شوند تا رفتار تلاش مجدد، بازه زمانی
 * و کنترل هم‌زمانی با شرایط واقعی سنجیده شود — نه با شبیه‌سازی. سرور محلی
 * امکان می‌دهد عمداً ۵۰۳، قطع اتصال و پاسخ کند تولید کنیم و ببینیم لایه
 * شبکه درست واکنش می‌دهد.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { get, pool, fetchText, FetchError, describeError, poolMap, runSource } from '../tools/lib/http.mjs';
import { parseUrlset, isSitemapIndex, pickRecent, readSitemap } from '../tools/lib/sitemap.mjs';

/** سرور آزمایشی با شمارنده درخواست‌ها */
async function withServer(handler, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    handler(req, res, hits);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, hits);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('پاسخ موفق بدون تلاش مجدد خوانده می‌شود', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html>سلام دنیا</html>');
  }, async (base, hits) => {
    const text = await get(`${base}/ok`);
    assert.match(text, /سلام دنیا/);
    assert.equal(hits.length, 1, 'نباید درخواست تکراری بفرستد');

    const meta = await fetchText(`${base}/ok`);
    assert.equal(meta.status, 200);
    assert.ok(meta.bytes > 0, 'حجم پاسخ باید ثبت شود');
  });
});

test('خطای ۵۰۳ گذرا است و دوباره تلاش می‌شود', async () => {
  await withServer((req, res, hits) => {
    if (hits.length < 3) {
      res.writeHead(503);
      res.end('در دسترس نیست');
    } else {
      res.writeHead(200);
      res.end('بالاخره شد');
    }
  }, async (base, hits) => {
    const text = await get(`${base}/flaky`, { retries: 3 });
    assert.equal(text, 'بالاخره شد');
    assert.equal(hits.length, 3, 'باید تا موفق شدن تلاش کند');
  });
});

test('خطای ۴۰۴ دائمی است و دوباره تلاش نمی‌شود', async () => {
  await withServer((req, res) => {
    res.writeHead(404);
    res.end('پیدا نشد');
  }, async (base, hits) => {
    await assert.rejects(() => get(`${base}/missing`, { retries: 3 }), (err) => {
      assert.ok(err instanceof FetchError);
      assert.equal(err.status, 404);
      assert.equal(err.transient, false);
      return true;
    });
    // این مهم‌ترین بخش آزمون است: تلاش دوباره روی خطای دائمی، فقط
    // وقت و پهنای باند منبع را تلف می‌کند.
    assert.equal(hits.length, 1, 'خطای دائمی نباید تکرار شود');
  });
});

test('مهلت درخواست رعایت می‌شود و سایت کند اجرا را معلق نمی‌کند', async () => {
  await withServer((req, res) => {
    // هرگز پاسخ نمی‌دهد
    setTimeout(() => res.end('دیر شد'), 5_000).unref();
  }, async (base) => {
    const started = Date.now();
    await assert.rejects(() => get(`${base}/slow`, { timeout: 300, retries: 0 }), (err) => {
      assert.match(err.message, /پایان مهلت|timeout|abort/i);
      return true;
    });
    const took = Date.now() - started;
    assert.ok(took < 2_000, `مهلت باید سریع اعمال شود، طول کشید ${took}ms`);
  });
});

test('پاسخ JSON و پاسخ مخدوش درست مدیریت می‌شوند', async () => {
  await withServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ rate: 23, ok: true }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{ شکسته');
    }
  }, async (base) => {
    const data = await get(`${base}/json`, { as: 'json' });
    assert.deepEqual(data, { rate: 23, ok: true });

    await assert.rejects(() => get(`${base}/broken`, { as: 'json', retries: 0 }), /JSON/);
  });
});

test('یک کار خراب در صف موازی، بقیه را از بین نمی‌برد', async () => {
  const results = await pool([
    async () => 'الف',
    async () => {
      throw new Error('این یکی خراب است');
    },
    async () => 'پ',
  ], 2);

  assert.equal(results.length, 3, 'خروجی باید برای هر کار یک نتیجه داشته باشد');
  assert.equal(results[0].ok, true);
  assert.equal(results[0].data, 'الف');
  assert.equal(results[1].ok, false, 'کار خراب باید ok:false بدهد، نه استثنا');
  assert.match(results[1].error, /خراب/);
  assert.equal(results[2].ok, true);
  assert.equal(results[2].data, 'پ', 'ترتیب نتایج باید حفظ شود');
});

test('صف موازی، محدودیت هم‌زمانی را رعایت می‌کند', async () => {
  let active = 0;
  let peak = 0;
  const { results, errors } = await poolMap(
    Array.from({ length: 12 }, (_, i) => i),
    async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      if (n === 7) throw new Error('هفت خراب است');
      return n * 2;
    },
    { concurrency: 3 },
  );

  assert.ok(peak <= 3, `حداکثر هم‌زمانی باید ۳ باشد، بود ${peak}`);
  assert.ok(peak > 1, 'باید واقعاً موازی کار کند');
  assert.equal(results.length, 11, 'یازده کار سالم باید نتیجه بدهد');
  assert.equal(errors.length, 1, 'یک خطا باید جمع شده باشد');
  assert.equal(errors[0].item, 7);
  assert.deepEqual(results.slice(0, 3), [0, 2, 4], 'ترتیب حفظ شود');
});

test('runSource خطا را می‌گیرد و به وضعیت سلامت تبدیل می‌کند', async () => {
  const ok = await runSource('منبع سالم', async () => [1, 2, 3]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, [1, 2, 3]);
  assert.ok(ok.ms >= 0);

  const bad = await runSource('منبع خراب', async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'اتصال رد شد', 'خطا باید به پیام فارسی قابل فهم ترجمه شود');
});

test('پیام خطا نوع مشکل را می‌گوید، نه فقط «ناموفق»', () => {
  assert.equal(describeError(Object.assign(new Error('x'), { name: 'AbortError' })), 'پایان مهلت درخواست');
  assert.equal(describeError(new Error('getaddrinfo ENOTFOUND x')), 'خطای تفکیک نام دامنه');
  assert.equal(describeError(new Error('read ECONNRESET')), 'اتصال قطع شد');
  assert.equal(describeError(new Error('certificate has expired')), 'خطای گواهی TLS');
  assert.equal(describeError(new Error('fetch failed')), 'شبکه در دسترس نبود');
});

/* ------------------------- نقشه سایت ------------------------- */

test('نقشه سایت با بلوک‌های url روبه‌روی متن درست خوانده می‌شود', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/a/1</loc><lastmod>2026-09-10T00:00:00+00:00</lastmod></url>
      <url><loc>https://example.com/b/2?x=1&amp;y=2</loc><lastmod>2026-08-01</lastmod></url>
      <url><loc>https://example.com/c/3</loc></url>
    </urlset>`;

  const entries = parseUrlset(xml);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].url, 'https://example.com/a/1');
  assert.equal(entries[0].lastmod, '2026-09-10T00:00:00+00:00');
  assert.equal(entries[1].url, 'https://example.com/b/2?x=1&y=2', 'ارجاع‌های متنی رفع شوند');
  assert.equal(entries[2].lastmod, null, 'نبود lastmod نباید خطا بدهد');
});

test('نقشه سایتی که XML نامعتبر دارد هم خوانده می‌شود', () => {
  // کاراکتر & خام و بلوک به‌هم‌ریخته — خطای رایج نقشه‌های سایت واقعی
  const xml = '<urlset><url><loc>https://example.com/a?x=1&y=2</loc></url><url><loc>https://example.com/b</loc></urlset>';
  const entries = parseUrlset(xml);
  assert.ok(entries.length >= 2, `باید حداقل دو ورودی بدهد، داد ${entries.length}`);
  assert.ok(entries.some((e) => e.url.includes('/a?x=1')));
});

test('نمایه نقشه سایت از نقشه سایت تشخیص داده می‌شود', () => {
  assert.equal(isSitemapIndex('<sitemapindex xmlns="x"><sitemap><loc>a</loc></sitemap></sitemapindex>'), true);
  assert.equal(isSitemapIndex('<urlset><url><loc>a</loc></url></urlset>'), false);
  assert.equal(isSitemapIndex(''), false);
});

test('بریدن زمانی، تازه‌ترین‌ها را نگه می‌دارد و در نبود داده تازه محدودیت را نادیده می‌گیرد', () => {
  const entries = [
    { url: 'https://e/old', lastmod: '2020-01-01' },
    { url: 'https://e/new', lastmod: '2026-09-14' },
    { url: 'https://e/mid', lastmod: '2026-09-01' },
    { url: 'https://e/none', lastmod: null },
  ];
  const now = Date.parse('2026-09-15T00:00:00Z');

  const recent = pickRecent(entries, { sinceDays: 30, now });
  assert.deepEqual(recent.map((e) => e.url), ['https://e/new', 'https://e/mid'], 'فقط تازه‌ها و به ترتیب نزولی');

  const limited = pickRecent(entries, { limit: 2, now });
  assert.deepEqual(limited.map((e) => e.url), ['https://e/new', 'https://e/mid']);

  // اگر بریدن زمانی همه را حذف کند، باید به داده کهنه برگردیم نه فهرست خالی
  const fallback = pickRecent(entries, { sinceDays: 1, now });
  assert.ok(fallback.length > 0, 'نبود داده تازه نباید فهرست خالی بدهد');
});

test('readSitemap نمایه را باز می‌کند و زیرنقشه‌ها را می‌خواند', async () => {
  const index = '<sitemapindex><sitemap><loc>__BASE__/loan.xml</loc></sitemap><sitemap><loc>__BASE__/bank.xml</loc></sitemap></sitemapindex>';
  const child = (url, mod) => `<urlset><url><loc>${url}</loc><lastmod>${mod}</lastmod></url></urlset>`;

  await withServer((req, res, hits) => {
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    res.writeHead(200, { 'content-type': 'application/xml' });
    if (req.url === '/sitemap.xml') return res.end(index.replaceAll('__BASE__', base));
    if (req.url === '/loan.xml') return res.end(child(`${base}/loan/1`, '2026-09-14'));
    if (req.url === '/bank.xml') return res.end(child(`${base}/account/2`, '2026-09-10'));
    res.writeHead(404);
    res.end('');
  }, async (base) => {
    const { entries, children } = await readSitemap(`${base}/sitemap.xml`, { select: (u) => u.includes('loan') });
    assert.equal(children.length, 1, 'با select فقط زیرنقشه‌های خواسته‌شده');
    assert.ok(entries.some((e) => e.url.endsWith('/loan/1')));
    assert.ok(!entries.some((e) => e.url.endsWith('/account/2')), 'زیرنقشه فیلترشده نباید خوانده شود');
  });
});

test('خرابی یک زیرنقشه، بقیه را از کار نمی‌اندازد', async () => {
  const index = '<sitemapindex><sitemap><loc>__BASE__/bad.xml</loc></sitemap><sitemap><loc>__BASE__/good.xml</loc></sitemap></sitemapindex>';
  await withServer((req, res) => {
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(index.replaceAll('__BASE__', base));
    }
    if (req.url === '/bad.xml') {
      res.writeHead(500);
      return res.end('خراب');
    }
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(`<urlset><url><loc>${base}/ok/1</loc></url></urlset>`);
  }, async (base) => {
    const { entries } = await readSitemap(`${base}/sitemap.xml`);
    assert.ok(entries.some((e) => e.url.endsWith('/ok/1')), 'زیرنقشه سالم باید خوانده شود');
  });
});
