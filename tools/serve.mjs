#!/usr/bin/env node
/**
 * سرور ایستا برای پیش‌نمایش محلی.
 * بدون وابستگی خارجی؛ برای توسعه و بررسی سریع سامانه.
 *
 * استفاده:
 *   node tools/serve.mjs           # پورت 4173
 *   PORT=8080 node tools/serve.mjs
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = decodeURIComponent(url.pathname);
    if (filePath.endsWith('/')) filePath += 'index.html';

    const absolute = path.join(ROOT, filePath);
    // جلوگیری از خروج از ریشه پروژه
    if (!absolute.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('یافت نشد');
      return;
    }

    const target = stat.isDirectory() ? path.join(absolute, 'index.html') : absolute;
    const body = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();

    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`خطای سرور: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`بانک‌رادار روی http://localhost:${PORT} در حال اجراست`);
  console.log(`ریشه: ${ROOT}`);
});
