// HTTP server: JSON API + static frontend + background scheduler.
// Local/self-hosted entry point. For the Vercel deployment, see api/index.js
// (same route table via requestHandler.js; no background scheduler there —
// Vercel Cron hits /api/cron on a schedule instead).

import { createServer } from 'node:http';

import { handleApiRequest } from './requestHandler.js';
import { serveStatic } from './staticFiles.js';
import { isAuthenticated } from './auth.js';
import { startScheduler } from './scheduler.js';
import { DB_PATH } from './db.js';

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (pathname !== '/login.html' && !isAuthenticated(req)) {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
    await serveStatic(req, res, pathname);
    return;
  }

  await handleApiRequest(req, res, { pathname, searchParams: url.searchParams });
});

server.listen(PORT, HOST, () => {
  console.log(`aicoach → http://${HOST}:${PORT}`);
  console.log(`database: ${DB_PATH}`);
  startScheduler();
});
