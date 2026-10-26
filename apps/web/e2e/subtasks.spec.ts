import { expect, test } from '@playwright/test';

// The replay has no split task, so the board's task list gets one added: a parent and two subtasks, the second after the first.
test('The board shows a split task with its subtasks in order and what each waits for, and each subtask names its parent', async ({ page }) => {
  await page.route('**/api/tasks', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tasks: Array<{ task: Record<string, unknown> }> };
    const base = body.tasks[0] as { task: Record<string, unknown> };
    const card = (id: string, title: string, status: string, extra: Record<string, unknown>) => ({ ...base, task: { ...base.task, id, title, status, ...extra }, autopilot: null, summary: null });
    body.tasks.push(
      card('T-0090', 'Rate-limit webhooks end to end', 'building', {}),
      card('T-0091', 'Add the limiter', 'done', { parent: 'T-0090', dependsOn: [] }),
      card('T-0092', 'Wire it into the webhook route', 'awaiting_approval', { parent: 'T-0090', dependsOn: ['T-0091'] }),
      card('T-0093', 'Document the limits', 'planned', { parent: 'T-0090', dependsOn: ['T-0092'] }),
    );
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/');
  const parent = page.locator('[data-testid="task-card"][data-task="T-0090"]');
  const rows = parent.getByTestId('subtasks').locator('li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('T-0091');
  await expect(rows.nth(0)).toContainText('merged');
  await expect(rows.nth(2)).toContainText('waits for T-0092');
  const child = page.locator('[data-testid="task-card"][data-task="T-0092"]');
  await expect(child.getByTestId('task-family')).toContainText('Part of T-0090');
  await expect(child.getByTestId('task-family')).toContainText('after T-0091 (merged)');
});
