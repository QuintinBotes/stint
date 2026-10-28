import { expect, test } from '@playwright/test';

type Event = { seq: number; ts: string; type: string; run?: string; payload: Record<string, unknown> };

test('The T-0042 stint chart draws each stint in its livery, the pit stops with their tokens, and the flags with their words', async ({ page }) => {
  await page.goto('/t/T-0042');
  const chart = page.getByTestId('stint-chart');
  const bars = chart.getByTestId('stint-bar');
  await expect(bars).toHaveCount(4);
  expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-run')))).toEqual(['r1', 'r2', 'r3', 'r4']);
  await expect(bars.nth(1)).toContainText('MUS');
  await expect(bars.nth(1)).toContainText('stopped');
  // the pit stop shows its packet's name; its size is in its accessible name and its tooltip
  await expect(chart.getByTestId('stint-pit').first()).toContainText('h1');
  await expect(chart.getByTestId('stint-pit').first()).toContainText('412 tokens');
  // every flag on the chart says its word beside it
  for (const flag of await chart.getByTestId('stint-flag').all()) expect(((await flag.textContent()) ?? '').trim().length).toBeGreaterThan(0);
  await expect(chart.getByTestId('stint-flag').filter({ hasText: 'Stopped' })).toHaveCount(1);
  await expect(chart).toHaveAttribute('data-rewound', 'false');
});

test('Dragging the stint chart back to the red flag rewinds race control, the car, the pit board and memory together; Back to the latest returns', async ({ page }) => {
  const { events } = (await (await page.request.get('/api/tasks/T-0042/events')).json()) as { events: Event[] };
  // just after the kill: the killed run's packet h1 is built, the next driver is not out yet
  const h1 = events.find((e) => e.type === 'handoff.created' && e.payload.name === 'h1') as Event;
  const review = events.find((e) => e.type === 'review.recorded') as Event;
  expect(h1.seq).toBeLessThan(review.seq);

  await page.goto('/t/T-0042');
  await page.getByTestId('race-control-toggle').click();
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(1);
  await expect(page.getByTestId('red-flag')).toHaveCount(0);

  const scrubber = page.getByTestId('stint-scrubber');
  // the first stop of the clock after the packet was built, on the scrubber's own steps, as a drag would land
  const [min, step] = [Number(await scrubber.getAttribute('min')), Number(await scrubber.getAttribute('step'))];
  const target = Number(h1.payload.replayAt);
  await scrubber.fill(String(min + Math.ceil((target - min) / step) * step));
  await expect(page).toHaveURL(/asOf=/);
  await expect(page.getByTestId('stint-chart')).toHaveAttribute('data-rewound', 'true');

  // race control shows the task up to that moment: the review had not happened yet
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(0);
  await expect(page.getByTestId('rewound')).toContainText('As it stood at');
  // the car as it stood: stopped, under a red flag, and the pit board shows the packet the kill left
  await expect(page.getByTestId('red-flag')).toContainText('Red flag');
  await expect(page.getByTestId('red-flag')).toContainText('MUS was stopped');
  await expect(page.getByTestId('car-state')).toContainText('Stopped');
  await expect(page.getByTestId('pit-board')).toContainText('In-flight step unknown');
  await expect(page.getByTestId('pit-board')).toContainText('412 tok');
  // memory reads the same moment, and says it on the same clock
  await page.getByTestId('tab-memory').click();
  await expect.poll(async () => page.getByTestId('memory-asof').textContent()).toBe(await page.getByTestId('stint-clock').textContent());

  await page.getByTestId('stint-latest').click();
  await expect(page).not.toHaveURL(/asOf=/);
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(1);
  await expect(page.getByTestId('red-flag')).toHaveCount(0);
  await expect(page.getByTestId('car-state')).toContainText('Took the flag');
});

test('The memory tab follows the stint chart: one clock for the whole task view, and memory has no clock of its own', async ({ page }) => {
  await page.goto('/t/T-0042?tab=memory');
  const graph = page.getByTestId('memory-graph');
  await expect(graph).toHaveAttribute('data-layout', 'done');
  await expect(page.getByTestId('memory-panel').locator('input[type="range"]')).toHaveCount(0);
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
  const scrubber = page.getByTestId('stint-scrubber');
  await scrubber.fill(String(await scrubber.getAttribute('min')));
  await expect(page).toHaveURL(/asOf=/);
  await expect(page.getByTestId('stint-chart')).toHaveAttribute('data-rewound', 'true');
  // the memory reads the chart's moment, says it on the chart's clock, and the skill learned later is not there yet
  await expect.poll(async () => page.getByTestId('memory-asof').textContent()).toBe(await page.getByTestId('stint-clock').textContent());
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveCount(0);
  await page.getByTestId('stint-latest').click();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
});
