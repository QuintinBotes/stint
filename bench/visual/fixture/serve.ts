// A tiny static server for visual checks: `bun serve.ts <port> [dir]` serves <dir>/<path>.html (index.html for /).
import { join } from 'node:path';

const port = Number(process.argv[2]);
const dir = process.argv[3] ?? join(import.meta.dir, 'site');
if (!Number.isInteger(port) || port <= 0) throw new Error('usage: bun serve.ts <port> [dir]');

Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/index';
    if (!/^\/[a-z0-9-]+$/.test(path)) return new Response('not found', { status: 404 });
    const file = Bun.file(join(dir, `${path.slice(1)}.html`));
    return (await file.exists()) ? new Response(file, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response('not found', { status: 404 });
  },
});
