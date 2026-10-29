import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';
import { holdRequests } from './pending';

test("A goal's tasks name it and link to it, a task waiting on an unmerged one says so, Run the goal's tasks starts them once, and a merged task's sign-off offers the goal's next task", async ({ page, request }) => {
  const d = daemon(request);
  const axe = async () => {
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: a goal its tasks link back to', outcome: 'Each task says which goal it is for.', criteria: ['The first part', 'The second part'], limits: { usd: 3 } });
  const { tasks } = await d.post<{ tasks: unknown[] }>(`/api/goals/${g.id}/plan`);
  const made = (await d.post<{ tasks: Array<{ id: string; title: string }> }>(`/api/goals/${g.id}/tasks`, { tasks })).tasks;
  const [a, b] = made as [{ id: string; title: string }, { id: string; title: string }];

  await page.goto('/');
  const card = page.locator(`[data-task="${b.id}"]`);
  await expect(card.getByTestId('task-goal')).toHaveText(`Part of ${g.id}, covers criterion 2`);
  await expect(card.getByTestId('card-blocker')).toHaveText(`Waits for ${a.id} to be merged before it starts.`);

  await page.goto(`/t/${b.id}`);
  await expect(page.getByTestId('task-goal')).toHaveText(`Part of ${g.id}, covers criterion 2`);
  await expect(page.getByTestId('task-goal').getByRole('link')).toHaveAttribute('href', `/goals/${g.id}`);
  await expect(page.getByTestId('task-depends')).toHaveText(`After ${a.id} (not merged)`);
  await expect(page.getByTestId('depends-warning')).toHaveText(`Waits for ${a.id}, which is not merged yet. Autopilot starts this task only once it is.`);
  await expect(page.getByTestId('header-start')).toHaveText('Queue on autopilot');
  expect(await axe()).toEqual([]);

  // the palette lists the goal under Go to
  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Search or run a command').fill(g.id);
  await page.getByRole('option', { name: new RegExp(`^${g.id}, Flow: a goal its tasks link back to`) }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${g.id}$`));

  // each task row reads its own status, so a planned task never reads as in progress
  await expect(page.getByTestId('goal-task-result').locator('.stint-status')).toHaveText(['planned', 'planned']);
  await expect(page.getByTestId('goal-task-waits')).toHaveText(`Waits for ${a.id} to be merged`);
  await expect(page.locator('#run-goal-what')).toHaveText(
    `Puts the goal's 2 open tasks on autopilot, in order: each is planned, built, tested and reviewed, then stops for your approval. ${b.id} starts only once the tasks it waits on are merged. The goal has a spend limit of $3.00 ($0.00 spent) and no build limit.`,
  );
  expect(await axe()).toEqual([]);
  const held = await holdRequests(page, `**/api/goals/${g.id}/run`);
  await page.getByTestId('run-goal-button').dblclick();
  await expect(page.getByTestId('run-goal-button')).toHaveText('Starting autopilot');
  held.release();
  await expect(page.getByTestId('run-goal-started')).toHaveText(`On autopilot: ${a.id}, ${b.id}.`);
  expect(held.count()).toBe(1);

  // a reaches the gate on autopilot and is merged; its sign-off links to the goal and offers b, the goal's next open task
  await d.until(a.id, stopped);
  // at the gate, a is not open work: Run the goal's tasks counts b alone
  await page.goto(`/goals/${g.id}`);
  await expect(page.getByTestId('run-goal-button')).toHaveText("Run the goal's 1 task");
  await d.post(`/api/tasks/${a.id}/approve`);
  await page.goto(`/t/${a.id}`);
  await expect(page.getByTestId('signoff-goal').getByRole('link')).toHaveAttribute('href', `/goals/${g.id}`);
  await expect(page.getByTestId('next-task')).toHaveText(`${b.id} ${b.title}`);
  await expect(page.getByTestId('next-task')).toHaveAttribute('href', `/t/${b.id}`);
});
