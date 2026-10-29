import { expect, test } from '@playwright/test';

test('After stint demo --speed 0, the board shows three cards in the right groups and the task view for T-0042 lists 100+ events', async ({ page }) => {
  await page.goto('/');
  // other specs may add tasks to the same daemon; the three replayed ones are checked by id
  await expect(page.locator('[data-task="T-0040"], [data-task="T-0042"], [data-task="T-0043"]')).toHaveCount(3);
  await expect(page.getByTestId('lane-needs-you').locator('[data-task="T-0043"]')).toBeVisible();
  await expect(page.getByTestId('lane-closed').locator('[data-task="T-0040"]')).toBeVisible();
  await expect(page.getByTestId('lane-closed').locator('[data-task="T-0042"]')).toBeVisible();

  await page.getByTestId('lane-closed').locator('[data-task="T-0042"]').click();
  await expect(page).toHaveURL(/\/t\/T-0042/);
  await expect(page.getByTestId('run-segment')).toHaveCount(4);
  await expect(page.getByTestId('handoff-joint').first()).toContainText('412 tokens');
  await page.getByTestId('show-all').click();
  expect(await page.getByTestId('event-row').count()).toBeGreaterThanOrEqual(100);
});
