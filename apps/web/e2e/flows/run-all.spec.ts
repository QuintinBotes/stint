import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('Run all from the palette starts every planned task; with one slot one card waits as queued, and both reach Needs you', async ({ page, request }) => {
  const d = daemon(request);
  const a = await d.create('Flow: run all, first');
  const b = await d.create('Flow: run all, second');
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('option', { name: /Run all/i }).first().click();
  // one autopilot slot (parallel: 1): whichever starts second waits its turn
  await expect.poll(async () => ((await d.get<{ autopilot: { queued: string[] } }>('/api/health')).autopilot.queued.length), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('autopilot-chip').filter({ hasText: 'queued' }).first()).toBeVisible();
  await d.until(a.id, stopped, 90_000);
  await d.until(b.id, stopped, 90_000);
  expect((await d.task(a.id)).status).toBe('awaiting_approval');
  expect((await d.task(b.id)).status).toBe('awaiting_approval');
});
