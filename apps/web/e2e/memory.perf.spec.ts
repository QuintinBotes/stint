import { type Page, expect, test } from '@playwright/test';

const T0 = Date.parse('2026-10-26T14:00:00Z');

/** The panel's cap: the task and 59 neighbours, half on the task and half one hop out, recorded a minute apart. */
function bigGraph() {
  const types = [...Array(10).fill('decision'), ...Array(4).fill('skill'), ...Array(5).fill('finding'), ...Array(25).fill('file'), ...Array(15).fill('run')] as string[];
  const nodes = [
    { id: 'task:T-0042', type: 'task', label: 'T-0042', data: {} },
    ...types.map((type, i) => ({ id: type === 'decision' ? `decision:T-0042/D${i}` : type === 'run' ? `run:T-0042/r${i}` : `${type}:n${i}`, type, label: type === 'file' ? `src/lib/f${i}.ts` : `${type} ${i}`, data: {} })),
  ];
  const edges = nodes.slice(1).map((n, i) => ({
    id: `e${i}`,
    from: i % 2 === 0 ? 'task:T-0042' : (nodes[1 + Math.floor(i / 2)] as { id: string }).id,
    to: n.id,
    type: 'relates',
    recordedAt: new Date(T0 + (i + 1) * 60_000).toISOString(),
    validTo: null,
    eventId: `ev${i}`,
    data: {},
  }));
  return { nodes, edges, asOf: null, total: 74 };
}

/** Times the layout inside the page, from the graph response to the worker's last batch, so polling never counts. */
async function timeLayout(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __layout: { graphAt?: number; doneAt?: number } };
    w.__layout = {};
    const native = window.fetch;
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const res = await native(...args);
      if (w.__layout.graphAt === undefined && String(args[0]).endsWith('/api/tasks/T-0042/graph')) w.__layout.graphAt = performance.now();
      return res;
    }) as typeof fetch;
    new MutationObserver(() => {
      if (w.__layout.doneAt === undefined && document.querySelector('[data-testid="memory-graph"][data-layout="done"]')) w.__layout.doneAt = performance.now();
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-layout'] });
  });
}

test('A 60-node graph lays out within 1 s of arriving, every node inside the panel, and the panel says it was capped', async ({ page }) => {
  await timeLayout(page);
  await page.route('**/api/tasks/T-0042/graph', (r) => r.fulfill({ json: bigGraph() }));
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph).toHaveAttribute('data-layout', 'done');
  const t = await page.evaluate(() => (window as unknown as { __layout: { graphAt: number; doneAt: number } }).__layout);
  expect(t.doneAt - t.graphAt).toBeLessThan(1000);

  await expect(graph.locator('[data-node]')).toHaveCount(60);
  // the panel's own size, in the pixels the graph lays out in (its viewBox)
  const [W, H] = ((await graph.getAttribute('viewBox')) ?? '').split(' ').slice(2).map(Number) as [number, number];
  expect(W).toBeGreaterThan(200);
  expect(H).toBeGreaterThan(200);
  const spots = await graph.locator('[data-node]').evaluateAll((gs) => gs.map((g) => /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') ?? '')?.slice(1).map(Number) ?? [Number.NaN, Number.NaN]));
  for (const [x, y] of spots) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(W);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(H);
  }
  // spread out, not stacked on the centre
  expect(new Set(spots.map(([x, y]) => `${Math.round(x as number)},${Math.round(y as number)}`)).size).toBeGreaterThan(50);
  await expect(page.getByTestId('memory-count')).toHaveText('60 of 74 nodes, the closest to this task');
});

test('While the worker is still laying out, the moment moves and the graph answers: the main thread never waits on the layout', async ({ page }) => {
  await page.route('**/api/tasks/T-0042/graph', (r) => r.fulfill({ json: bigGraph() }));
  // hold the worker 400 ms after each batch it posts, as a far larger layout would
  await page.route('**/graph.worker*.js', async (r) => {
    const res = await r.fetch();
    const hold = 'const __post = self.postMessage.bind(self); self.postMessage = (m) => { __post(m); if (!m.done) { const until = Date.now() + 400; while (Date.now() < until); } };\n';
    await r.fulfill({ response: res, body: hold + (await res.text()) });
  });
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph.locator('[data-node]')).toHaveCount(60);
  await expect(graph).toHaveAttribute('data-layout', 'running');

  const now = await page.getByTestId('memory-asof').textContent();
  // move the view's moment to the graph's first edge without a reload, as the clock does: the URL's asOf
  await page.evaluate((asOf) => {
    history.replaceState(null, '', `/t/T-0042?memory=open&asOf=${encodeURIComponent(asOf)}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, new Date(T0 + 60_000).toISOString());
  await expect(page.getByTestId('memory-asof')).not.toHaveText(now ?? '');
  // at the first edge only the task and its first neighbour stand; the rest were not recorded yet
  await expect(graph.locator('[data-node]')).toHaveCount(2);
  await expect(graph).toHaveAttribute('data-layout', 'running');
  await expect(graph).toHaveAttribute('data-layout', 'done', { timeout: 5000 });
});
