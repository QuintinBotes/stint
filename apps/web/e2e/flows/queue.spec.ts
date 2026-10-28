import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('A skill the learn step proposed waits in the memory panel queue; Approve calls the daemon, the row leaves the queue, and an open Skills page shows it without a reload', async ({ page, context, request }) => {
  const d = daemon(request);
  const t = await d.post<{ id: string }>('/api/tasks', { title: 'Flow: [learn] [queue] a limit approved from the panel', goal: 'Add a limit, as a flow test.', acceptance: ['the task file exists'], tags: ['limits'] });
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await d.post(`/api/tasks/${t.id}/approve`);
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'skill.proposed' || e.type === 'learn.skipped'), 60_000);
  const proposed = (await d.events(t.id)).find((e) => e.type === 'skill.proposed');
  expect(proposed, JSON.stringify((await d.events(t.id)).find((e) => e.type === 'learn.skipped')?.payload)).toBeTruthy();

  const skillsPage = await context.newPage();
  await skillsPage.goto('/skills');
  await skillsPage.getByRole('heading', { name: 'Skills' }).waitFor();
  // the memory panel is the task view's Memory tab
  await page.goto(`/t/${t.id}?tab=memory`);
  const row = page.getByTestId('memory-panel').locator('[data-testid="queue-skill"][data-skill="limits-live-in-one-place"]');
  await expect(row).toContainText('Nothing is written until you approve it');
  const approve = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/skills/limits-live-in-one-place/approve'));
  await row.getByRole('button', { name: 'Approve and commit' }).click();
  await approve;
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await d.get<Array<{ id: string; status: string }>>('/api/skills')).find((s) => s.id === 'limits-live-in-one-place')?.status).toBe('probation');
  // the Skills page opened before the approval follows it from the event stream
  await expect(skillsPage.locator('[data-list-skill="limits-live-in-one-place"]')).toContainText('probation');
});
