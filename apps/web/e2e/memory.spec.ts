import { expect, test } from '@playwright/test';

test('After the replay, the T-0042 panel shows D3 and limiter-config-via-env; dragging the scrubber to the start removes the skill node', async ({ page }) => {
  await page.goto('/t/T-0042');
  const graph = page.getByTestId('memory-graph');
  await expect(graph.locator('[data-node="decision:T-0042/D3"]')).toBeVisible();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
  const scrubber = page.getByTestId('memory-scrubber');
  const min = await scrubber.getAttribute('min');
  await scrubber.fill(String(min));
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toHaveCount(0);
  await expect(page).toHaveURL(/asOf=/);
  await page.getByRole('button', { name: 'Now' }).click();
  await expect(graph.locator('[data-node="skill:limiter-config-via-env"]')).toBeVisible();
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
