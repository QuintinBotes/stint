// Serves apps/web/dist-judge the way GitHub Pages will: under /stint/, a folder answers with its index.html, and any
// other unknown path with 404.html and status 404. The landing page is at /stint/ and the board at /stint/demo/. Usage, from the repository root, after bun run build:judge:
//   bun run serve:judge   (STINT_JUDGE_PORT picks the port, 4321 by default)
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { BASE, SITE } from './build-judge';

const dir = join(import.meta.dir, '..', 'dist-judge');
if (!existsSync(join(dir, 'demo', 'snapshot.json'))) throw new Error('no judge copy to serve: run bun run build:judge first');
const port = Number(process.env.STINT_JUDGE_PORT ?? 4321);

Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === '/' || path === SITE.slice(0, -1)) return Response.redirect(SITE, 302);
    if (path === BASE.slice(0, -1)) return Response.redirect(BASE, 302);
    if (!path.startsWith(SITE)) return new Response('Not found', { status: 404 });
    const file = normalize(join(dir, path.slice(SITE.length)));
    if (!file.startsWith(dir)) return new Response('Not found', { status: 404 });
    const target = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file;
    if (existsSync(target) && statSync(target).isFile()) return new Response(Bun.file(target));
    return new Response(Bun.file(join(dir, '404.html')), { status: 404, headers: { 'Content-Type': 'text/html' } });
  },
});
process.stdout.write(`The site: http://127.0.0.1:${port}${SITE} (the board at ${BASE})\n`);
