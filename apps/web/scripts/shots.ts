// Screenshots of every screen from a replay daemon, at 1600x1000 (deviceScaleFactor 2) and at 390x844, to compare with the design.
// Usage, from the repository root, with a replay daemon serving the built UI (STINT_E2E_PORT=4601 bun apps/web/e2e/serve.ts):
//   bun apps/web/scripts/shots.ts [--url http://127.0.0.1:4601] [--out .loop/ui-shots] [--theme pitwall] [--assets]
// --assets also writes assets/screenshot-task.png and assets/screenshot-factory.png.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Page, chromium } from '@playwright/test';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const root = resolve(import.meta.dir, '..', '..', '..');
const url = arg('url', 'http://127.0.0.1:4601');
const theme = arg('theme', 'pitwall');
const out = resolve(arg('out', join(root, '.loop', 'ui-shots')));
mkdirSync(out, { recursive: true });

type Event = { seq: number; ts: string; type: string; run?: string; payload: Record<string, unknown> };
const events = ((await (await fetch(`${url}/api/tasks/T-0042/events`)).json()) as { events: Event[] }).events;
// just after the red flag: the killed run has ended and its packet is built, before the next driver goes out
const kill = events.findIndex((e) => e.type === 'run.finished' && e.payload.endedBy === 'killed');
const killed = events.slice(kill).find((e) => e.type === 'handoff.created') ?? events[kill];
// at pins the exact event, since replayed events can share a timestamp
const killedAt = `${encodeURIComponent(killed?.ts ?? '')}&at=${killed?.seq ?? ''}`;

const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(600);
};
const graphDone = (page: Page) => page.locator('[data-testid="memory-graph"][data-layout="done"]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);

const browser = await chromium.launch();
for (const [size, viewport, scale] of [
  ['1600', { width: 1600, height: 1000 }, 2],
  ['390', { width: 390, height: 844 }, 2],
] as const) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await context.addInitScript((t) => localStorage.setItem('stint.theme', t), theme);
  const page = await context.newPage();
  const shot = async (name: string, path: string, full = true, before?: () => Promise<void>) => {
    await page.goto(`${url}${path}`);
    // the page has loaded its data once the views show something the daemon sent
    await page.locator('[data-testid="task-card"], [data-testid="stint-chart"], [data-testid="kpis"], [data-testid="skill-row"]').first().waitFor({ timeout: 20_000 });
    await settle(page);
    await before?.();
    // the app scrolls inside main; let it grow so a full-page capture holds the whole screen
    if (full) await page.addStyleTag({ content: '#root,#root>div{height:auto!important}main{overflow:visible!important;flex:none!important}' });
    await page.screenshot({ path: join(out, `${name}-${size}.png`), fullPage: full });
    process.stdout.write(`${name}-${size}.png\n`);
  };
  await shot('board', '/');
  await shot('task', '/t/T-0042');
  await shot('kill', `/t/T-0042?tab=terminal&asOf=${killedAt}`);
  await shot('handoff', '/t/T-0042?tab=packet&packet=h1');
  await shot('memory', '/t/T-0042?tab=memory', true, () => graphDone(page));
  await shot('gate', '/t/T-0043');
  await shot('palette', '/t/T-0042', false, async () => {
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(300);
  });
  await shot('factory', '/factory', true, () => graphDone(page));
  await shot('skills', '/skills');
  if (size === '1600' && process.argv.includes('--assets')) {
    await page.goto(`${url}/t/T-0042`);
    await settle(page);
    await graphDone(page);
    await page.screenshot({ path: join(root, 'assets', 'screenshot-task.png') });
    await page.goto(`${url}/factory`);
    await settle(page);
    await graphDone(page);
    await page.screenshot({ path: join(root, 'assets', 'screenshot-factory.png') });
    process.stdout.write('assets/screenshot-task.png assets/screenshot-factory.png\n');
  }
  await context.close();
}
await browser.close();
