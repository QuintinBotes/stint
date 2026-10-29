import { expect, test } from '@playwright/test';

test('bun run build:web succeeds and the daemon serves / with the shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Stint', exact: true })).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  // the default replay is hand-written, and the strip says so (ADR-0011)
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  await expect(page.getByTestId('replay-strip')).toContainText('A hand-written demo story, played back.');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Search or run a command')).toBeVisible();
  await expect(page.getByText('Run all planned tasks on autopilot')).toBeVisible();
  await expect(page.getByText(/arrives in/)).toHaveCount(0);
});

test('The top bar fits at 1440 and 1600 px: one status button, whose panel lists the agents, the ones you can turn on, and the models', async ({ page }) => {
  for (const width of [1440, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const button = page.getByTestId('status-button');
    // the replay starts nothing, so the bar never says an agent is ready there
    await expect(button).toHaveText('Replay, agents are off');
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

test('At 390 px the status panel opens inside the screen and a click outside it closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByTestId('status-button');
  await button.click();
  const panel = page.getByTestId('status-panel');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox()) as { x: number; y: number; width: number; height: number };
  expect(box.x, 'panel starts off the left edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'panel ends off the right edge').toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  // a click on the board below, outside the panel and its button
  await page.mouse.click(195, 800);
  await expect(panel).toHaveCount(0);
});
