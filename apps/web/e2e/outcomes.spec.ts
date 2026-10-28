import { expect, test } from '@playwright/test';

test('The board has an In review lane between Reviewing and Done once a task waits on a pull request, and none before', async ({ page }) => {
  // the replay has no pull request, so the lane stays out of the way
  await page.goto('/');
  await expect(page.getByTestId('lane-reviewing')).toBeVisible();
  await expect(page.getByTestId('lane-in-review')).toHaveCount(0);

  await page.route('**/api/tasks', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tasks: Array<{ task: Record<string, unknown> }> };
    const base = body.tasks[0] as { task: Record<string, unknown> };
    body.tasks.push({ ...base, task: { ...base.task, id: 'T-0091', title: 'Waiting on its pull request', status: 'in_review' } });
    await route.fulfill({ response: res, json: body });
  });
  await page.reload();
  const lane = page.getByTestId('lane-in-review');
  await expect(lane.getByRole('heading', { name: /In review/ })).toBeVisible();
  await expect(lane.locator('[data-task="T-0091"]')).toBeVisible();
  const order = await page.locator('[data-testid^="lane-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order.indexOf('lane-in-review')).toBe(order.indexOf('lane-reviewing') + 1);
  expect(order.indexOf('lane-done')).toBe(order.indexOf('lane-in-review') + 1);
});

test('The Factory Outcomes panel shows merged, reverted and followed up per agent', async ({ page }) => {
  await page.goto('/factory');
  const panel = page.getByTestId('panel-outcomes');
  await expect(panel).toContainText('What happened after merge');
  const outcomes = page.getByTestId('outcomes');
  await expect(outcomes).toContainText('Merged');
  await expect(outcomes).toContainText('Reverted');
  await expect(outcomes).toContainText('Followed up');
  // T-0042 merged in the replay; both agents that built it are credited
  await expect(outcomes.locator('[data-agent="muse-code"]')).toContainText('Muse Code');
  await expect(outcomes.locator('[data-agent="stint-agent"]')).toContainText('Stint agent');
});
