import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('Pulled issues wait in the board intake, triaged; Accept makes a task from GitHub, Dismiss removes one for good', async ({ page, request }) => {
  const d = daemon(request);
  const pulled = await d.post<{ received: string[] }>('/api/intake/pull', { source: 'github' });
  expect(pulled.received.sort()).toEqual(['github-7', 'github-8']);
  await page.goto('/');
  const intake = page.getByTestId('intake');
  await expect(intake.getByTestId('intake-row')).toHaveCount(2);
  const first = intake.locator('[data-item="github-7"]');
  await expect(first).toContainText('size S');
  await first.getByTestId('intake-accept').click();
  await expect(intake.getByTestId('intake-row')).toHaveCount(1);
  const tasks = await d.get<{ tasks: Array<{ task: { id: string; title: string; source?: { kind: string; ref: string } } }> }>('/api/tasks');
  const made = tasks.tasks.find((c) => c.task.source?.kind === 'github' && c.task.source.ref === '7');
  expect(made?.task.title).toBe('Show the tenant name in the audit log');
  await expect(page.getByTestId('lane-planned').locator(`[data-task="${made?.task.id}"]`)).toBeVisible();

  await intake.locator('[data-item="github-8"]').getByTestId('intake-dismiss').click();
  await expect(page.getByTestId('intake')).toHaveCount(0);
  expect((await d.post<{ received: string[] }>('/api/intake/pull', { source: 'github' })).received).toEqual([]);
});
