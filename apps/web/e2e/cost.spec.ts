import { expect, test } from '@playwright/test';

test('The title block shows the task total and each run on the rail its cost after the replay', async ({ page }) => {
  await page.goto('/t/T-0042');
  await expect(page.getByTestId('task-cost')).toContainText('$0.61');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  await expect(segments.nth(0)).toContainText('$0.05');
  await expect(segments.nth(1)).toContainText('$0.21');
  await expect(segments.nth(2)).toContainText('$0.35');
  await expect(segments.nth(3)).toContainText('$0.00');
});

test('The top bar and the Factory show the same spend for this week, learn and quiz spend included', async ({ page }) => {
  await page.goto('/factory');
  // the replay's runs are dated at playback, so their recorded spend falls in this week; the bar says it is replayed
  await expect(page.getByTestId('week-cost')).toContainText('Replayed spend $0.76');
  await expect(page.getByTestId('kpis')).toContainText('Spend this week$0.76');
});
