import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('A task autopilot took to the gate says Autopilot: Waiting for your approval until it is merged, and nothing about autopilot after', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: merged after autopilot');
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('autopilot-step')).toHaveText('Autopilot: Waiting for your approval.');
  await d.post(`/api/tasks/${t.id}/approve`);
  await expect.poll(async () => (await d.task(t.id)).status).toBe('done');
  await page.reload();
  await expect(page.getByTestId('signoff')).toBeVisible();
  await expect(page.getByTestId('autopilot-step')).toHaveCount(0);
});

test('A task merged after autopilot stopped at its review round limit shows neither the limit stop nor the autopilot step', async ({ page, request }) => {
  const d = daemon(request);
  // the fake reviewer asks for changes on a [learn] task, and a review round limit of 0 stops at the first ask
  const t = await d.post<{ id: string }>('/api/tasks', { title: 'Flow: [learn] merged after a limit stop', goal: 'Stop at the review round limit, then merge.', acceptance: ['the task file exists'], limits: { reviewRounds: 0 } });
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  const events = await d.until(t.id, stopped);
  expect(events.find((e) => e.type === 'limit.reached')?.payload).toEqual({ limit: 'reviewRounds', used: 0, cap: 0 });
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('limit-stop')).toContainText('the review round limit is reached (0 of 0)');
  await expect(page.getByTestId('autopilot-step')).toHaveText('Autopilot: stopped at a limit; it needs you.');
  await d.post(`/api/tasks/${t.id}/approve`);
  await expect.poll(async () => (await d.task(t.id)).status).toBe('done');
  await page.reload();
  await expect(page.getByTestId('signoff')).toBeVisible();
  await expect(page.getByTestId('limit-stop')).toHaveCount(0);
  await expect(page.getByTestId('autopilot-step')).toHaveCount(0);
});
