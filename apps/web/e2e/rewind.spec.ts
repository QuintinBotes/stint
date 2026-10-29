import { expect, test } from '@playwright/test';

type Event = { seq: number; ts: string; type: string; run?: string; payload: Record<string, unknown> };

test('The T-0042 revision block lists each run with what it changed, who ran it and what the daemon checked, in words', async ({ page }) => {
  await page.goto('/t/T-0042');
  const gate = page.getByTestId('approval-gate');
  const rows = gate.getByTestId('revision');
  await expect(rows).toHaveCount(4);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-run')))).toEqual(['r1', 'r2', 'r3', 'r4']);
  // each row names its agent beside the vendor's ink, and says its check in words
  await expect(rows.nth(0)).toContainText('Plan');
  await expect(rows.nth(0)).toContainText('Wonder');
  await expect(rows.nth(1)).toContainText('Muse');
  await expect(rows.nth(1)).toContainText('Killed');
  await expect(rows.nth(2)).toContainText('33 passed');
  await expect(rows.nth(3)).toContainText('Review');
  await expect(rows.nth(3)).toContainText('Approve');
  // the approval row closes the block: a merged task shows its sign-off there
  await expect(gate.getByTestId('signoff')).toBeVisible();
});

test('Dragging the clock back to the kill rewinds the rail, the task, the revisions, the packet and memory together; Now returns to the latest', async ({ page }) => {
  const { events } = (await (await page.request.get('/api/tasks/T-0042/events')).json()) as { events: Event[] };
  // just after the kill: the killed run's packet h1 is built, the next agent has not started
  const h1 = events.find((e) => e.type === 'handoff.created' && e.payload.name === 'h1') as Event;
  const review = events.find((e) => e.type === 'review.recorded') as Event;
  expect(h1.seq).toBeLessThan(review.seq);

  await page.goto('/t/T-0042');
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(1);
  await expect(page.getByTestId('kill-notice')).toHaveCount(0);

  const scrubber = page.getByTestId('scrubber');
  // the first stop of the clock after the packet was built, on the scrubber's own steps, as a drag would land
  const [min, step] = [Number(await scrubber.getAttribute('min')), Number(await scrubber.getAttribute('step'))];
  const target = Number(h1.payload.replayAt);
  await scrubber.fill(String(min + Math.ceil((target - min) / step) * step));
  await expect(page).toHaveURL(/asOf=/);
  await expect(page.getByTestId('scrubber-block')).toHaveAttribute('data-rewound', 'true');

  // the rail shows the task up to that moment: the review had not happened yet
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(0);
  // the notice at the top of the task says which task and which moment the page shows
  await expect(page.getByTestId('rewound')).toContainText('You are looking at T-0042 as it was at');
  // the task as it stood: stopped, with the notice of the kill and the packet it left
  await expect(page.getByTestId('kill-notice')).toContainText('Killed');
  await expect(page.getByTestId('kill-notice')).toContainText('Muse Code r2 was stopped');
  await expect(page.getByTestId('kill-notice')).toContainText('the step it was in the middle of marked unknown');
  await expect(page.getByTestId('kill-notice')).toContainText('412 tokens');
  await expect(page.getByTestId('task-state')).toContainText('Stopped');
  // the revisions not started by then go quiet with no check yet; the gate still acts on the task as it is now
  await expect(page.locator('[data-testid="revision"][data-run="r3"]')).toHaveAttribute('data-later', 'true');
  await expect(page.locator('[data-testid="revision"][data-run="r3"]')).toContainText('Not yet');
  await expect(page.locator('[data-testid="revision"][data-run="r2"]')).toHaveAttribute('data-later', 'false');
  await expect(page.locator('[data-testid="revision"][data-run="r2"]')).toContainText('Killed');
  await expect(page.getByTestId('approval-gate')).toContainText('this approval is the task as it is now');
  // memory reads the same moment, and names it as the rail does
  await expect.poll(async () => page.getByTestId('memory-asof').textContent()).toBe(await page.getByTestId('rewound').locator('span').textContent());
  // the packet tab shows the packet that was latest then: h1, the one the kill left
  await page.getByTestId('tab-packet').click();
  await expect(page.getByTestId('handoff-card')).toContainText('Packet h1');
  await expect(page.getByTestId('packet-size')).toContainText('412 tokens');

  await page.getByTestId('scrub-now').click();
  await expect(page).not.toHaveURL(/asOf=/);
  await expect(page.locator(`[data-testid="event-row"][data-seq="${review.seq}"]`)).toHaveCount(1);
  await expect(page.getByTestId('kill-notice')).toHaveCount(0);
  await expect(page.getByTestId('task-state')).toContainText('Merged');
  await expect(page.getByTestId('handoff-card')).toContainText('Packet h2');
});

test('One clock for the whole task view: memory follows it, and the skill learned later is not there yet', async ({ page }) => {
  await page.goto('/t/T-0042?memory=open');
  const graph = page.getByTestId('memory-graph');
  await expect(graph).toHaveAttribute('data-layout', 'done');
  await expect(page.locator('input[type="range"]')).toHaveCount(1);
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
  const scrubber = page.getByTestId('scrubber');
  await scrubber.fill(String(await scrubber.getAttribute('min')));
  await expect(page).toHaveURL(/asOf=/);
  await expect(page.getByTestId('scrubber-block')).toHaveAttribute('data-rewound', 'true');
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveCount(0);
  await page.getByTestId('scrub-now').click();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
});
