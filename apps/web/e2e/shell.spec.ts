import { expect, test } from '@playwright/test';

test('bun run build:web succeeds and the daemon serves / with the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stint', exact: true })).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Type a command or a task')).toBeVisible();
  await expect(page.getByText('Run all planned tasks on autopilot')).toBeVisible();
  await expect(page.getByText(/arrives in/)).toHaveCount(0);
});

test('The top bar fits at 1440 and 1600 px: one status button, whose panel lists the agents, the ones you can turn on, and the models', async ({ page }) => {
  for (const width of [1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const button = page.getByTestId('status-button');
    await expect(button).toContainText(/Replay daemon, \d agents?, \d models?/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page scrolls sideways at ${width} px`).toBe(0);
    const box = await button.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0), `status button off screen at ${width} px`).toBeLessThanOrEqual(width);
  }
  const button = page.getByTestId('status-button');
  await button.click();
  const panel = page.getByTestId('status-panel');
  await expect(panel).toContainText('Muse Code');
  await expect(panel).toContainText('Agents you can turn on');
  await expect(panel).toContainText('Claude Code');
  await expect(panel).toContainText('Codex');
  await expect(panel).toContainText(/Models, \d+ ready/);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
});
