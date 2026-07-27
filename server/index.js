// HTTP server: JSON API + static frontend + background scheduler.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { matchRoute } from './api.js';
import { startScheduler } from './scheduler.js';
import { DB_PATH } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, '..', 'public');
const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // Contain path traversal: resolve and verify the result stays under PUBLIC_DIR.
  const filePath = resolve(join(PUBLIC_DIR, normalize(rel)));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + '/')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) throw new Error('not a file');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    await serveStatic(req, res, pathname);
    return;
  }

  const route = matchRoute(req.method, pathname);
  if (!route) return sendJson(res, 404, { error: `No route for ${req.method} ${pathname}` });

  try {
    const body = req.method === 'GET' || req.method === 'DELETE' ? null : await readBody(req);
    const query = Object.fromEntries(url.searchParams.entries());
    const out = await route.handler({ body, query, params: route.params, req });
    sendJson(res, 200, out);
  } catch (err) {
    const status = err.status || (err.name === 'IntervalsError' ? err.status || 502 : 500);
    if (!err.status) console.error(`[api] ${req.method} ${pathname}:`, err);
    sendJson(res, status >= 400 && status < 600 ? status : 500, {
      error: err.message,
      detail: err.body || undefined,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`aicoach → http://${HOST}:${PORT}`);
  console.log(`database: ${DB_PATH}`);
  startScheduler();
});
