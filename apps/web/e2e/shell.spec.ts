import { expect, test } from '@playwright/test';

test('bun run build:web succeeds and the daemon serves / with the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stint' })).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Type a command or a task')).toBeVisible();
  await expect(page.getByText('arrives in R-009')).toBeVisible();
});
