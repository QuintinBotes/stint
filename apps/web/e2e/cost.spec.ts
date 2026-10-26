import { expect, test } from '@playwright/test';

test('The task header shows the task total and each rail segment its run cost after the replay', async ({ page }) => {
  await page.goto('/t/T-0042');
  await expect(page.getByTestId('task-cost')).toContainText('$0.61');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  await expect(segments.nth(0)).toContainText('$0.05');
  await expect(segments.nth(1)).toContainText('$0.21');
  await expect(segments.nth(2)).toContainText('$0.35');
  await expect(segments.nth(3)).toContainText('$0.00');
});
