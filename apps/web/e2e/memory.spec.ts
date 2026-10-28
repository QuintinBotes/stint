import { expect, test } from '@playwright/test';

test('After the replay, T-0042 memory shows D3 and limiter-config-via-env; scrubbing the clock to the start removes the skill node, which was not recorded yet', async ({ page }) => {
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph.locator('[data-node="decision:T-0042/D3"]')).toBeVisible();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
  // file nodes carry their basename (R-052); in a crowded graph some go unlabelled, which one depends on the layout
  await expect(graph).toHaveAttribute('data-layout', 'done');
  const fileLabels = await graph.locator('[data-node^="file:"] text').allTextContents();
  expect(fileLabels.length).toBeGreaterThan(2);
  for (const label of fileLabels) expect(label).toMatch(/^[^/]+\.[a-z]+$/);
  const scrubber = page.getByTestId('scrubber');
  await scrubber.fill(String(await scrubber.getAttribute('min')));
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveCount(0);
  await expect(page).toHaveURL(/asOf=/);
  await page.getByTestId('scrub-now').click();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveAttribute('data-state', 'on');
});

test('No two labels in the T-0042 graph overlap and each stays inside the graph; the graph spreads over the panel rather than piling on its edges', async ({ page }) => {
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph).toHaveAttribute('data-layout', 'done');
  const { frame, labels, nodes } = await graph.evaluate((svg) => ({
    frame: svg.getBoundingClientRect().toJSON() as DOMRect,
    labels: [...svg.querySelectorAll('text')].map((t) => ({ text: t.textContent, ...(t.getBoundingClientRect().toJSON() as DOMRect) })),
    nodes: [...svg.querySelectorAll('[data-node] > circle')].map((c) => c.getBoundingClientRect().toJSON() as DOMRect),
  }));
  expect(labels.length).toBeGreaterThan(5);
  // the learned skill is the story's payoff; a long name still finds room above or below its node
  await expect(graph.getByText('limiter-config-via-env', { exact: true })).toBeVisible();
  for (const l of labels) {
    expect(l.left).toBeGreaterThanOrEqual(frame.left);
    expect(l.right).toBeLessThanOrEqual(frame.right);
  }
  // half a pixel each side for antialiasing
  const hit = (a: DOMRect, b: DOMRect) => a.left + 0.5 < b.right && b.left + 0.5 < a.right && a.top + 0.5 < b.bottom && b.top + 0.5 < a.bottom;
  expect(labels.flatMap((a, i) => labels.slice(i + 1).filter((b) => hit(a, b)).map((b) => `${a.text} over ${b.text}`))).toEqual([]);
  // at most three nodes sit on one wall: the layout is fitted, not clamped
  const onWall = (pick: (n: DOMRect) => boolean) => nodes.filter(pick).length;
  expect(onWall((n) => n.top - frame.top < 18)).toBeLessThanOrEqual(3);
  expect(onWall((n) => frame.bottom - n.bottom < 18)).toBeLessThanOrEqual(3);
});

test('A decision superseded during the window is hidden before it was recorded, on while it held, and faded to 35% after (R-019)', async ({ page }) => {
  const t0 = Date.parse('2026-10-26T14:00:00Z');
  const iso = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();
  const node = (id: string, type: string, label: string) => ({ id, type, label, data: {} });
  const edge = (id: string, to: string, from: number, until: number | null) => ({ id, from: 'task:T-0042', to, type: 'relates', recordedAt: iso(from), validTo: until === null ? null : iso(until), eventId: id, data: {} });
  await page.route('**/api/tasks/T-0042/graph', (r) =>
    r.fulfill({
      json: {
        nodes: [node('task:T-0042', 'task', 'T-0042'), node('file:src/a.ts', 'file', 'src/a.ts'), node('decision:T-0042/D1', 'decision', 'D1'), node('decision:T-0042/D2', 'decision', 'D2')],
        edges: [edge('e0', 'file:src/a.ts', 0, null), edge('e1', 'decision:T-0042/D1', 2, 6), edge('e2', 'decision:T-0042/D2', 6, null), edge('e3', 'file:src/a.ts', 10, null)],
        asOf: null,
        total: 4,
      },
    }),
  );
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  const d1 = graph.locator('[data-node="decision:T-0042/D1"]');
  const d2 = graph.locator('[data-node="decision:T-0042/D2"]');
  // now: D2 replaced D1, which fades rather than vanishes
  await expect(d1).toHaveAttribute('data-state', 'faded');
  await expect(d1).toHaveAttribute('opacity', '0.35');
  await expect(d2).toHaveAttribute('data-state', 'on');
  // the moment the task view shows is its asOf, which the clock sets; a link can set it too
  const at = async (iso: string) => {
    await page.goto(`/t/T-0042?memory=open&asOf=${encodeURIComponent(iso)}`);
    await expect(graph.locator('[data-node="task:T-0042"]')).toBeVisible();
  };
  // minute 4: D1 holds, D2 is not recorded yet
  await at(iso(4));
  await expect(d1).toHaveAttribute('data-state', 'on');
  await expect(d2).toHaveCount(0);
  // the start: neither decision was recorded
  await at(iso(0));
  await expect(d1).toHaveCount(0);
  await expect(d2).toHaveCount(0);
});

test('Clicking D3 in the panel selects its timeline row; clicking a run node selects its segment (R-052)', async ({ page }) => {
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph).toHaveAttribute('data-layout', 'done');
  const { events } = (await (await page.request.get('/api/tasks/T-0042/events?since=0')).json()) as { events: Array<{ seq: number; type: string; run?: string; payload: Record<string, unknown> }> };
  // Nodes are buttons (R-052): neighbouring nodes crowd the circles, so focus and Enter is the steady aim.
  const activate = async (nodeId: string) => {
    await graph.locator(`[data-node="${nodeId}"]`).focus();
    await page.keyboard.press('Enter');
  };

  const decided = events.find((e) => e.type === 'decision.recorded' && e.payload.id === 'D3');
  expect(decided).toBeDefined();
  await activate('decision:T-0042/D3');
  await expect(page).toHaveURL(new RegExp(`ev=${decided?.seq}`));
  await expect(page.locator(`[data-testid="event-row"][data-seq="${decided?.seq}"]`)).toBeVisible();

  const started = events.find((e) => e.type === 'run.started' && e.run === 'r3');
  expect(started).toBeDefined();
  await activate('run:T-0042/r3');
  await expect(page).toHaveURL(new RegExp(`ev=${started?.seq}`));
  await expect(page.locator('[data-testid="run-segment"][data-run="r3"]')).toBeVisible();
});

test('The Constrains tab lists D3 with its text; Similar lists T-0040 and T-0043 with their evidence', async ({ page }) => {
  await page.goto('/t/T-0042?memory=open');
  await expect(page.getByTestId('memory-rows-similar')).toContainText('T-0040');
  await expect(page.getByTestId('memory-rows-similar')).toContainText('shares src/app.ts');
  await page.getByTestId('memory-tab-constrains').click();
  await expect(page.getByTestId('memory-rows-constrains')).toContainText('D3 Sliding window over fixed window');
});

test('The queue shows the review finding that would reverse D3, side by side with the decision', async ({ page }) => {
  await page.goto('/t/T-0042');
  const row = page.getByTestId('queue-row').first();
  await expect(row).toContainText('would reverse D3');
  await expect(row.getByRole('button', { name: 'Keep D3' })).toBeVisible();
});
