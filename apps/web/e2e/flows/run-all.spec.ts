import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('Run all from the palette starts every planned task; with one slot one card waits as queued, and both reach Needs you', async ({ page, request }) => {
  const d = daemon(request);
  const a = await d.create('Flow: run all, first');
  const b = await d.create('Flow: run all, second');
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('option', { name: /Run all/i }).first().click();
  await d.until(a.id, stopped, 90_000);
  await d.until(b.id, stopped, 90_000);
  // one autopilot slot (parallel: 1): at least one of them waited its turn, and its log says so
  const waited = [...(await d.events(a.id)), ...(await d.events(b.id))].filter((e) => e.type === 'autopilot.step' && e.payload.queued);
  expect(waited.length).toBeGreaterThan(0);
  expect(String(waited[0]?.payload.reason)).toMatch(/^Queued behind /);
  expect((await d.task(a.id)).status).toBe('awaiting_approval');
  expect((await d.task(b.id)).status).toBe('awaiting_approval');
});
