import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('An ACP agent asking permission shows a banner on its task; Allow once answers it and the run finishes', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: an agent asks permission');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'fake-acp', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'permission.requested'));
  // the run is blocked on you, so the board puts the task in Needs you and says why, not in progress as if it worked
  await page.goto('/');
  const card = page.getByTestId('lane-needs-you').locator(`[data-task="${t.id}"]`);
  await expect(card.getByTestId('card-blocker')).toHaveText(/^An agent waits for your permission to use .+: Run the test suite\. Open the task to answer\.$/);
  await expect(card.locator('.stint-status')).toHaveText('asks permission');
  await page.goto(`/t/${t.id}`);
  const banner = page.getByTestId('permission-banner');
  await expect(banner).toContainText('Run the test suite');
  await expect(banner.getByRole('button', { name: 'Always for this run' })).toBeVisible();
  await banner.getByRole('button', { name: 'Allow once' }).click();
  const events = await d.until(t.id, (ev) => ev.some((e) => e.type === 'run.finished'));
  expect(events.find((e) => e.type === 'permission.decided')?.payload.optionId).toBe('allow');
  expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('completed');
  await expect(banner).toHaveCount(0);
});
