import { expect, test } from '@playwright/test';

// a route handler still serving a poll when a test ends would read a disposed response; drop them first
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

test('A task waiting on its pull request sits in In progress, labelled in PR review with a ring, and is never counted as running', async ({ page }) => {
  await page.route('**/api/tasks', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tasks: Array<{ task: Record<string, unknown>; lastRun: unknown }> };
    const base = body.tasks[0] as { task: Record<string, unknown>; lastRun: unknown };
    body.tasks = [{ ...base, task: { ...base.task, id: 'T-0091', title: 'Waiting on its pull request', status: 'in_review' }, lastRun: null }];
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/');
  const card = page.getByTestId('lane-in-progress').locator('[data-task="T-0091"]');
  await expect(card).toBeVisible();
  const label = card.locator('.stint-status');
  await expect(label).toHaveText('in PR review');
  await expect(label.locator('svg')).toHaveAttribute('data-shape', 'waiting');
  await expect(page.getByTestId('board-summary').locator('[data-count="running"] b')).toHaveText('0');
  await expect(page.getByTestId('lane-in-progress').getByRole('heading', { name: 'In progress' })).toBeVisible();
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
