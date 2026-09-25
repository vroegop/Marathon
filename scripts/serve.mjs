#!/usr/bin/env node
// Tiny static server for local development: serves site/ at / and data/ at /data/.
//   node scripts/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown' };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
    let file = u.pathname.startsWith('/data/') ? path.join(DATA_DIR, u.pathname.slice(6)) : path.join(ROOT, 'site', u.pathname);
    if (file.endsWith('/')) file += 'index.html';
    file = path.normalize(file);
    if (!file.startsWith(ROOT) && !file.startsWith(DATA_DIR)) return res.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}/`));
