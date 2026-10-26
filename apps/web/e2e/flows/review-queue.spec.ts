import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('A review that would reverse a decision waits in the queue; Supersede records a new decision over it and the row leaves the queue', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: [contradict] a decision');
  const decision = await d.post<{ id: string }>(`/api/tasks/${t.id}/decisions`, { text: 'Limits come from config, never the environment' });
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'review.recorded'));

  await page.goto('/factory');
  const row = page.getByTestId('queue-row').filter({ hasText: t.id });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`would reverse ${decision.id}`);
  await row.getByRole('button', { name: `Supersede ${decision.id}` }).click();
  await expect(row).toHaveCount(0);

  const decisions = await d.get<Array<{ id: string; supersedes?: string }>>(`/api/tasks/${t.id}/decisions`);
  expect(decisions.some((x) => x.supersedes === decision.id)).toBe(true);
  expect(decisions.some((x) => x.id === decision.id)).toBe(false);
  await d.until(t.id, stopped);
});
