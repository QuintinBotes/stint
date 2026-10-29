import { type Page, expect, test } from '@playwright/test';

// a route handler still serving a poll when a test ends would read a disposed response; drop them first
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

const ID = 'T-5000';
const N = 5000;
const T0 = Date.parse('2026-10-26T15:00:00Z');

function event(seq: number, type: string, payload: Record<string, unknown>, run: string | undefined = 'r1') {
  return { id: `ev-${seq}`, seq, ts: new Date(T0 + seq * 100).toISOString(), task: ID, ...(run ? { run, adapter: 'muse-code' } : {}), vendor: 'meta', type, payload, prev: '', hash: '' };
}

/** A live run of 5,000 events: every row is notable, so the collapsed rail shows them all. */
function events(from: number, to: number) {
  const out = [];
  for (let seq = from; seq <= to; seq++) {
    if (seq === 1) out.push(event(1, 'task.created', { title: 'A very long run' }, undefined));
    else if (seq === 2) out.push(event(2, 'run.started', { adapter: 'muse-code', role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' }));
    else out.push(seq % 2 ? event(seq, 'agent.tool_call', { tool: 'Read', args: { path: `src/file-${seq}.ts` } }) : event(seq, 'file.changed', { path: `src/file-${seq}.ts`, added: 1, removed: 0, run: 'r1' }));
  }
  return out;
}

/** Serves the synthetic task: its bundle is the replayed T-0042's with a live run, its events from memory, no stream. */
async function serveSynthetic(page: Page, more: { at: number; count: number }) {
  const real = await (await page.request.get('/api/tasks/T-0042')).json();
  const bundle = { ...real, task: { ...real.task, id: ID, title: 'A very long run', status: 'building' }, runs: [{ run: 'r1', adapter: 'muse-code', vendor: 'meta', role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli', startedAt: new Date(T0).toISOString(), endedAt: null, endedBy: null, cost: null, handoffFrom: null }], verification: null, review: null, merge: null };
  await page.route(`**/api/tasks/${ID}/**`, (r) => r.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'synthetic task' } } }));
  await page.route(`**/api/tasks/${ID}`, (r) => r.fulfill({ json: bundle }));
  let polls = 0;
  await page.route(`**/api/tasks/${ID}/events**`, (r) => {
    const since = Number(new URL(r.request().url()).searchParams.get('since') ?? 0);
    if (since === 0) return r.fulfill({ json: { events: events(1, N) } });
    // the stream is refused, so the page polls; after `more.at` polls the run writes a few more rows
    polls++;
    return r.fulfill({ json: { events: polls >= more.at && since < N + more.count ? events(N + 1, N + more.count) : [] } });
  });
}

test('A 5,000-event live run renders as a window: pinned to the newest row, a deep link renders its row, and scrolling keeps the frame budget', async ({ page }) => {
  await serveSynthetic(page, { at: Number.POSITIVE_INFINITY, count: 0 });
  await page.goto(`/t/${ID}`);
  const rail = page.locator('[data-testid="rail"][data-virtual="true"]');
  await expect(rail).toBeVisible();
  await expect(rail.locator(`[data-seq="${N}"]`)).toBeVisible();
  expect(await rail.getByTestId('event-row').count()).toBeLessThan(150);

  // scroll from the newest row to the first in one second of frames, and time each frame
  const frames = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="rail"]')?.parentElement as HTMLElement;
    const gaps: number[] = [];
    let last = performance.now();
    const start = el.scrollTop;
    const t0 = last;
    await new Promise<void>((done) => {
      const step = (now: number) => {
        gaps.push(now - last);
        last = now;
        const k = Math.min(1, (now - t0) / 1000);
        el.scrollTop = start * (1 - k);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return gaps.slice(1).sort((a, b) => a - b);
  });
  const p95 = frames[Math.floor(frames.length * 0.95)] as number;
  const median = frames[Math.floor(frames.length / 2)] as number;
  expect(median, `median frame ${median.toFixed(1)} ms`).toBeLessThan(20);
  expect(p95, `p95 frame ${p95.toFixed(1)} ms`).toBeLessThan(50);
  await expect(rail.locator('[data-seq="3"]')).toBeVisible();
  expect(await rail.getByTestId('event-row').count()).toBeLessThan(150);

  await page.goto(`/t/${ID}?ev=4000`);
  await expect(page.locator('[data-seq="4000"]')).toBeVisible();
});

test('Rows that arrive while the person has scrolled up raise "Jump to latest", which brings the newest row back', async ({ page }) => {
  await serveSynthetic(page, { at: 3, count: 3 });
  await page.goto(`/t/${ID}`);
  const rail = page.locator('[data-testid="rail"][data-virtual="true"]');
  await expect(rail.locator(`[data-seq="${N}"]`)).toBeVisible();
  await page.evaluate(() => {
    (document.querySelector('[data-testid="rail"]')?.parentElement as HTMLElement).scrollTop = 0;
  });
  await expect(page.getByTestId('jump-latest')).toBeVisible({ timeout: 10_000 });
  await expect(rail.locator(`[data-seq="${N + 3}"]`)).toHaveCount(0);
  await page.getByTestId('jump-latest').click();
  await expect(rail.locator(`[data-seq="${N + 3}"]`)).toBeVisible();
  await expect(page.getByTestId('jump-latest')).toHaveCount(0);
});
