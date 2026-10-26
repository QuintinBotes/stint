import { expect, test } from '@playwright/test';

test('The board has an In review lane between Reviewing and Done for tasks waiting on a pull request', async ({ page }) => {
  await page.goto('/');
  const lane = page.getByTestId('lane-in-review');
  await expect(lane).toBeVisible();
  await expect(lane.getByRole('heading', { name: /In review/ })).toBeVisible();
  // the replay has no pull request, so the lane says so in plain words
  await expect(lane).toContainText('Nothing is in pull request review.');
});

test('The Factory Outcomes panel shows merged, reverted and followed up per agent', async ({ page }) => {
  await page.goto('/factory');
  const panel = page.getByTestId('panel-outcomes');
  await expect(panel).toContainText('Outcomes after merge, per agent');
  const outcomes = page.getByTestId('outcomes');
  await expect(outcomes).toContainText('Merged');
  await expect(outcomes).toContainText('Reverted');
  await expect(outcomes).toContainText('Followed up');
  // T-0042 merged in the replay; both agents that built it are credited
  await expect(outcomes.locator('[data-agent="muse-code"]')).toContainText('Muse Code');
  await expect(outcomes.locator('[data-agent="stint-agent"]')).toContainText('Stint agent');
});
