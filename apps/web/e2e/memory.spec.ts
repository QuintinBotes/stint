import { expect, test } from '@playwright/test';

test('After the replay, the T-0042 panel shows D3 and limiter-config-via-env; scrubbing to the start fades D3 to 35%', async ({ page }) => {
  await page.goto('/t/T-0042');
  const graph = page.getByTestId('memory-graph');
  await expect(graph.locator('[data-node="decision:T-0042/D3"]')).toBeVisible();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
  // file nodes carry their basename (R-052)
  await expect(graph.getByText('limiter.ts', { exact: true })).toBeVisible();
  const scrubber = page.getByTestId('memory-scrubber');
  const min = await scrubber.getAttribute('min');
  await scrubber.fill(String(min));
  const d3 = graph.locator('[data-node="decision:T-0042/D3"]');
  await expect(d3).toHaveAttribute('data-state', 'faded');
  await expect(d3).toHaveAttribute('opacity', '0.35');
  const skill = graph.locator('[data-node="skill:limiter-config-via-env"]');
  await expect(skill).toHaveAttribute('data-state', 'faded');
  await expect(page).toHaveURL(/asOf=/);
  await page.getByRole('button', { name: 'Now' }).click();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveAttribute('data-state', 'on');
});

test('Clicking D3 in the panel selects its timeline row; clicking a run node selects its segment (R-052)', async ({ page }) => {
  await page.goto('/t/T-0042');
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
  await page.goto('/t/T-0042');
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
