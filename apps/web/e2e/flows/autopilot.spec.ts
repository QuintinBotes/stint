import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('Autopilot from the task header carries a task to Needs you; pressing a merges it, the sign-off names the commit, and the merge carries the trailer', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: autopilot to merge');
  await page.goto(`/t/${t.id}`);
  await page.getByTestId('autopilot-switch').click();
  await expect(page.getByTestId('autopilot-step')).toBeVisible();
  const events = await d.until(t.id, stopped);
  const steps = events.filter((e) => e.type === 'autopilot.step').map((e) => e.payload.step);
  expect(steps).toEqual(['plan', 'build', 'verify', 'review']);

  await page.goto('/');
  await expect(page.getByTestId('lane-needs-you').locator(`[data-task="${t.id}"]`)).toBeVisible();
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('approval-gate')).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.getByTestId('signoff')).toBeVisible();
  await expect(page.getByTestId('signoff')).toContainText(/[0-9a-f]{7}/);

  const merged = (await d.events(t.id)).find((e) => e.type === 'merge.completed');
  expect((merged?.payload.trailers as Record<string, string>)['Stint-Task']).toBe(t.id);
  expect((await d.task(t.id)).status).toBe('done');
  await page.goto('/');
  await expect(page.getByTestId('lane-done').locator(`[data-task="${t.id}"]`)).toBeVisible();
});
