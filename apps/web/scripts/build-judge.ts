// The judge copy (R-069): a read-only board for GitHub Pages that plays the recorded story with no daemon and no keys.
// Usage, from the repository root: bun run build:judge   (writes apps/web/dist-judge)
// It plays the replay into a daemon as `stint demo` does, drives the real UI through every page, task and view on it
// while recording each GET to /api (so a new panel is covered without a list of endpoints to keep), and builds the UI
// in judge mode around that snapshot.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, chromium } from '@playwright/test';
import { startDaemon } from '@stint-dev/daemon';
import { seedDemoConfig } from '../../../packages/cli/src/demo/seed';

export const BASE = '/stint/';
const web = join(import.meta.dir, '..');
const out = join(web, 'dist-judge');
type Snapshot = Record<string, { status: number; type: string; body: string }>;

function vite(...args: string[]): void {
  const r = Bun.spawnSync([process.execPath, 'x', 'vite', 'build', ...args], { cwd: web, stdout: 'ignore', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`vite build ${args.join(' ')} failed`);
}

/** Waits until no /api read is in flight and none has finished for a moment; the streams never finish, so they are left out. */
function quiet(page: Page): () => Promise<void> {
  let inflight = 0;
  let last = Date.now();
  const counts = (r: { url: () => string; resourceType: () => string }) => new URL(r.url()).pathname.startsWith('/api/') && r.resourceType() !== 'eventsource';
  page.on('request', (r) => {
    if (counts(r)) inflight++;
  });
  const done = (r: { url: () => string; resourceType: () => string }) => {
    if (!counts(r)) return;
    inflight--;
    last = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return async () => {
    await page.waitForTimeout(300);
    while (inflight > 0 || Date.now() - last < 500) await page.waitForTimeout(100);
  };
}

/** What changes the view without changing anything: tabs, toggles not yet pressed (such as h1 or 30d), closed disclosures (such as Memory). */
const VIEWS = '[role="tab"], button[aria-pressed="false"], button[aria-expanded="false"]';

/** Opens a page, then every view control on it, and every one those controls show, once each. */
async function visit(page: Page, path: string, settle: () => Promise<void>): Promise<void> {
  await page.goto(path);
  await settle();
  const seen = new Set<string>();
  for (let round = 0; round < 120; round++) {
    let clicked = false;
    // last in the page first, so what a tab shows is opened before the next tab hides it
    for (const control of (await page.locator(VIEWS).all()).reverse()) {
      if (!(await control.isVisible())) continue;
      const key = await control.evaluate((el) => `${el.closest('[aria-label]')?.getAttribute('aria-label') ?? ''}/${el.getAttribute('role') ?? ''}/${el.textContent?.trim() ?? ''}`);
      if (seen.has(key)) continue;
      seen.add(key);
      // a control under an open panel cannot be clicked; it is skipped, not waited on
      await control.click({ timeout: 2000 }).catch(() => undefined);
      await settle();
      clicked = true;
      break; // a click can change which controls exist, so look again
    }
    if (!clicked) return;
  }
}

async function crawl(): Promise<Snapshot> {
  const root = mkdtempSync(join(tmpdir(), 'stint-judge-'));
  const clone = Bun.spawnSync(['git', 'clone', '-q', join(web, '..', '..', 'demo', 'repo.bundle'), root]);
  if (clone.exitCode !== 0) throw new Error('cannot clone the fixture');
  await seedDemoConfig(root);
  const d = await startDaemon({ root, quiet: true });
  const browser = await chromium.launch();
  try {
    const play = await fetch(`${d.url}/api/demo/play`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 0 }) });
    if (play.status !== 202) throw new Error(`replay did not start: ${await play.text()}`);
    while (((await (await fetch(`${d.url}/api/demo/status`)).json()) as { playing: boolean }).playing) await Bun.sleep(50);

    const page = await browser.newPage({ baseURL: d.url, viewport: { width: 1440, height: 900 } });
    // the crawl only reads: a click that would change something never reaches the daemon
    await page.route('**/api/**', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
    const snapshot: Snapshot = {};
    const bodies: Array<Promise<void>> = [];
    page.on('response', (res) => {
      const url = new URL(res.url());
      const type = res.headers()['content-type'] ?? 'text/plain';
      if (res.request().method() !== 'GET' || !url.pathname.startsWith('/api/') || type.includes('text/event-stream')) return;
      bodies.push(
        res
          .text()
          .then((body) => {
            snapshot[url.pathname + url.search] = { status: res.status(), type, body };
          })
          .catch(() => undefined),
      );
    });
    const settle = quiet(page);
    const tasks = ((await (await fetch(`${d.url}/api/tasks`)).json()) as { tasks: Array<{ task: { id: string } }> }).tasks;
    const goals = ((await (await fetch(`${d.url}/api/goals`)).json()) as { goals: Array<{ goal: { id: string } }> }).goals;
    for (const path of ['/', ...tasks.map((t) => `/t/${t.task.id}`), '/goals', ...goals.map((g) => `/goals/${g.goal.id}`), '/factory', '/skills']) await visit(page, path, settle);
    await Promise.all(bodies);
    return scrub(snapshot, [realpathSync(root), root]);
  } finally {
    await browser.close();
    await d.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The snapshot is published, so the fixture copy's temporary path (the real one first, since it contains the other on
 * macOS) becomes the fixture's name, and neither the home folder nor the git email of the machine may remain.
 */
function scrub(snapshot: Snapshot, roots: string[]): Snapshot {
  let text = JSON.stringify(snapshot);
  for (const r of roots) text = text.replaceAll(JSON.stringify(r).slice(1, -1), 'webhook-service');
  const email = Bun.spawnSync(['git', 'config', 'user.email'], { stdout: 'pipe' }).stdout.toString().trim();
  for (const [what, own] of [['the home folder', homedir()], ['the git email', email]] as const) {
    if (own.length > 3 && text.includes(own)) throw new Error(`the snapshot still holds ${what} of this machine; not writing it`);
  }
  return JSON.parse(text) as Snapshot;
}

if (import.meta.main) {
  vite();
  const snapshot = await crawl();
  vite('--mode', 'judge', '--base', BASE);
  writeFileSync(join(out, 'snapshot.json'), JSON.stringify(snapshot));
  // GitHub Pages answers an unknown path with 404.html, so a deep link boots the app and the router takes it from there
  writeFileSync(join(out, '404.html'), readFileSync(join(out, 'index.html')));
  const manifest = join(out, 'manifest.webmanifest');
  writeFileSync(manifest, readFileSync(manifest, 'utf8').replaceAll('"/', `"${BASE}`));
  process.stdout.write(`Wrote ${out}: ${Object.keys(snapshot).length} recorded reads. Look at it with: bun run serve:judge\n`);
}
