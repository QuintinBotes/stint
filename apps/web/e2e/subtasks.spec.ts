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

test('The board sentence links each task, names the decision that waits on T-0042, and a card says how many tests passed', async ({ page }) => {
  await page.goto('/');
  const sentence = page.getByTestId('board-sentence');
  await expect(sentence).toContainText('T-0043 needs you. 1 decision waits on T-0042.');
  await expect(page.locator('[data-task="T-0043"]').getByTestId('card-tests')).toHaveText('36 tests passed');
  // an empty lane keeps its place in the order and says what will appear in it; other tests may have filled some lanes
  const empty: Record<string, string> = {
    planned: 'A new task waits here for an agent.',
    building: 'A task is here while an agent works on it.',
    verifying: 'A task is here while Stint runs its tests.',
    reviewing: 'A task is here while a second model reviews it.',
  };
  let checked = 0;
  for (const [id, text] of Object.entries(empty)) {
    const lane = page.getByTestId(`lane-${id}`);
    if ((await lane.getByTestId('task-card').count()) > 0) continue;
    await expect(lane).toContainText(text);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
  // the task that needs you is one link in the sentence: focus it and press Enter
  await sentence.getByRole('link', { name: 'T-0043' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/t\/T-0043/);
});
