import { expect, test } from '@playwright/test';

test('bun run build:web succeeds and the daemon serves / with the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stint' })).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Type a command or a task')).toBeVisible();
  await expect(page.getByText('Run all planned tasks on autopilot')).toBeVisible();
  await expect(page.getByText(/arrives in/)).toHaveCount(0);
});

test('The top bar fits a 1440 px window: live agents as chips, the ones that are off folded into one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const chips = page.getByTestId('health-chips');
  await expect(chips).toContainText('Muse Code');
  await expect(chips).not.toContainText('unavailable');
  await expect(page.getByTestId('agents-off')).toContainText('agents off');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
