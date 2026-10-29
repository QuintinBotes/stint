import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { daemon } from './daemon';
import { holdRequests } from './pending';

type Goal = { id: string; status: string; tasks: string[]; decisions: Array<{ id: string }> };

test('A goal made from the Goals page is sharpened, split into tasks a person edits, and lists those tasks with their results, each linking to its task', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/goals');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('new-goal').click();
  // New goal opens the spec builder asking for a goal; the plain form is behind Write it yourself
  await page.getByRole('dialog', { name: 'What do you want done?' }).getByTestId('builder-write').click();
  const dialog = page.getByRole('dialog', { name: 'New goal' });
  await dialog.getByLabel('Title').fill('Flow: health checks for the service');
  await dialog.getByLabel('Outcome: what is true once it is met').fill('Operators can tell the service is up without reading its logs.');
  await dialog.getByLabel('Success criteria, one per line').fill('GET /health answers 200\nThe body says ok');
  await dialog.getByLabel('Not in scope, one per line').fill('Metrics');
  await dialog.getByText('Limits', { exact: true }).click();
  await dialog.getByLabel('Spend in dollars').fill('4');
  await dialog.getByLabel('Builds').fill('6');
  await dialog.getByRole('button', { name: 'Create goal' }).click();
  await expect(page).toHaveURL(/\/goals\/G-\d{4}$/);
  const id = /\/goals\/(G-\d{4})/.exec(page.url())?.[1] as string;

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Flow: health checks for the service');
  await expect(page.getByTestId('goal-outcome')).toHaveText('Operators can tell the service is up without reading its logs.');
  await expect(page.getByTestId('goal-met')).toHaveText('0 of 2 criteria met');
  await expect(page.getByTestId('goal-criterion')).toHaveCount(2);
  await expect(page.getByTestId('goal-criterion').first()).toContainText('No task covers it yet.');
  await expect(page.getByTestId('meter-goal-usd')).toContainText('Spend $0.00 of $4.00');
  await expect(page.getByTestId('meter-goal-builds')).toContainText('Builds 0 of 6');
  await expect(page.getByTestId('goal-no-tasks')).toBeVisible();

  // the same Sharpen as a task's: a material question waits for an answer, the rest take the recommendation
  await page.getByTestId('sharpen-start').click();
  const card = page.getByTestId('sharpen-card-Q1');
  await expect(card).toContainText('Who may turn the new behaviour off once it ships?');
  await expect(card).toContainText('Needs your answer');
  await card.getByTestId('sharpen-answer-Q1').click();
  await expect(page.getByTestId('sharpen-answered-Q1').getByTestId('sharpen-decision')).toHaveText('D1');
  await page.getByTestId('sharpen-recommended').click();
  await expect(page.getByTestId('sharpen-answered-Q2')).toBeVisible();
  await page.getByTestId('sharpen-use-proofs').click();
  await expect(page.getByTestId('sharpen-ready')).toBeVisible();
  await expect(page.getByTestId('goal-page').getByText('ready', { exact: true }).first()).toBeVisible();
  const sharpened = await d.get<{ goal: Goal }>(`/api/goals/${id}`);
  expect(sharpened.goal.status).toBe('ready');
  expect(sharpened.goal.decisions.map((x) => x.id)).toEqual(['D1', 'D2']);

  // the split is a proposal: rows to edit, and nothing is created until Create tasks
  await page.getByTestId('split-goal').click();
  const first = page.getByTestId('proposed-1');
  await expect(first.getByLabel('Title')).toHaveValue('Part 1: GET /health answers 200');
  await expect(page.getByTestId('proposed-2')).toContainText('Covers criterion 2; starts after task 1 is merged');
  expect((await d.get<{ goal: Goal }>(`/api/goals/${id}`)).goal.tasks).toEqual([]);
  await first.getByLabel('Title').fill('Flow: answer GET /health');
  await first.getByLabel('How you will know it is done, one check per line').fill('GET /health answers 200\nIt answers within 100 ms');
  await page.getByTestId('create-goal-tasks').click();

  const rows = page.getByTestId('goal-tasks').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Flow: answer GET /health');
  await expect(rows.nth(1)).toContainText('Part 2: The body says ok');
  // each row says the task's own status: planned, not the rollup's in progress
  await expect(page.getByTestId('goal-task-result').locator('.stint-status')).toHaveText(['planned', 'planned']);
  await expect(page.getByTestId('goal-criterion').first()).toContainText('Not checked');
  const goal = (await d.get<{ goal: Goal }>(`/api/goals/${id}`)).goal;
  expect(goal.status).toBe('running');
  const [a, b] = goal.tasks as [string, string];
  const task = (await d.task(a)) as unknown as { title: string; acceptance: string[]; goalId: string; goalCriteria: number[]; limits: unknown };
  expect(task).toMatchObject({ title: 'Flow: answer GET /health', acceptance: ['GET /health answers 200', 'It answers within 100 ms'], goalId: id, goalCriteria: [1], limits: { usd: 2, builds: 3 } });
  expect(((await d.task(b)) as unknown as { dependsOn: string[] }).dependsOn).toEqual([a]);
  // each created task's ledger starts with the goal's decisions
  expect((await d.events(a)).filter((e) => e.type === 'decision.recorded' && e.payload.goal === id)).toHaveLength(2);

  // the list shows it, and each task on the goal links to the task
  await page.goto('/goals');
  await expect(page.getByTestId(`goal-row-${id}`)).toContainText('0 of 2 criteria met');
  await expect(page.getByTestId(`goal-row-${id}`)).toContainText('2 tasks');
  await page.getByTestId(`goal-row-${id}`).getByRole('link').click();
  await page.getByTestId(`goal-task-${a}`).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/t/${a}$`));
});

test('The Goals list, a goal page and the New goal dialog have no WCAG A or AA violations and no sideways scroll at 390 px; the palette offers New goal', async ({ page, request }) => {
  const d = daemon(request);
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: a goal for the accessibility check', outcome: 'Every screen of it passes.', criteria: ['The list passes', 'The page passes'], limits: { usd: 2 } });
  const axe = async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto('/goals');
  await expect(page.getByTestId(`goal-row-${g.id}`)).toBeVisible();
  expect(await axe()).toEqual([]);
  await page.goto(`/goals/${g.id}`);
  await expect(page.getByTestId('sharpen-start')).toBeVisible();
  await page.getByTestId('goal-limits').getByText("Change the goal's limits").click();
  expect(await axe()).toEqual([]);
  await page.getByTestId('split-goal').click();
  await expect(page.getByTestId('goal-proposal')).toBeVisible();
  expect(await axe()).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await sideways()).toBeLessThanOrEqual(0);
  await page.goto('/goals');
  expect(await sideways()).toBeLessThanOrEqual(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Search or run a command').fill('New goal');
  await page.keyboard.press('Enter');
  await page.getByTestId('builder-write').click();
  const dialog = page.getByRole('dialog', { name: 'New goal' });
  await expect(dialog).toBeVisible();
  await dialog.getByText('Limits', { exact: true }).click();
  expect(await axe()).toEqual([]);
  // more criteria than a goal takes is said in words, before the daemon is asked
  await dialog.getByLabel('Title').fill('Too many');
  await dialog.getByLabel(/^Outcome/).fill('o');
  await dialog.getByLabel(/criteria/i).first().fill(Array.from({ length: 13 }, (_, i) => `criterion ${i + 1}`).join('\n'));
  await dialog.getByRole('button', { name: /Create goal/ }).click();
  await expect(dialog).toContainText('A goal takes 1 to 12 criteria, one per line; this has 13.');
  await expect(dialog).not.toContainText('"origin"');
});

test("A task stopped at its goal's build limit says so and sends you to the goal, whose builds meter reads reached", async ({ page, request }) => {
  const d = daemon(request);
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: a goal with one build', outcome: 'One build is all it may take.', criteria: ['the task file exists'], limits: { builds: 1 } });
  const { tasks } = await d.post<{ tasks: unknown[] }>(`/api/goals/${g.id}/plan`);
  const [t] = (await d.post<{ tasks: Array<{ id: string }> }>(`/api/goals/${g.id}/tasks`, { tasks })).tasks as [{ id: string }];
  // one build that is stopped by hand: the goal's one build is used
  const { run } = await d.post<{ run: string }>(`/api/tasks/${t.id}/assign`, { adapter: 'sleeper', role: 'implementer' });
  await d.post(`/api/tasks/${t.id}/runs/${run}/stop`);
  await d.until(t.id, (es) => es.some((e) => e.type === 'handoff.created'));
  // the task took the goal's one build as its share; a person raised the task's own limit, and the goal's still holds
  expect(((await d.task(t.id)) as unknown as { limits: unknown }).limits).toEqual({ builds: 1 });
  await d.patch(`/api/tasks/${t.id}/limits`, { builds: 5 });
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  const events = await d.until(t.id, (es) => es.some((e) => e.type === 'autopilot.stopped'));
  expect(events.find((e) => e.type === 'limit.reached')?.payload).toMatchObject({ limit: 'builds', scope: 'goal', goal: g.id, used: 1, cap: 1 });

  await page.goto(`/t/${t.id}`);
  const stop = page.getByTestId('limit-stop');
  await expect(stop).toContainText(`the goal's build limit is reached (1 of 1 across ${g.id}'s tasks).`);
  await expect(page.getByTestId('raise-limit')).toHaveCount(0);
  await expect(page.getByTestId('meter-builds')).not.toContainText('reached');
  await stop.getByTestId('limit-goal').click();
  await expect(page).toHaveURL(new RegExp(`/goals/${g.id}$`));
  await expect(page.getByTestId('meter-goal-builds')).toContainText('Builds 1 of 1, reached');

  // abandoning takes two clicks, and a closed goal offers nothing more to do
  await page.getByTestId('abandon-goal').click();
  await expect(page.getByRole('status').filter({ hasText: `Click again to abandon ${g.id}` })).toBeVisible();
  await page.getByTestId('abandon-goal').click();
  await expect(page.getByTestId('goal-page')).toContainText(/abandoned/i);
  await expect(page.getByTestId('abandon-goal')).toHaveCount(0);
});

test("Create tasks runs once however often it is pressed, and a refusal keeps the edited rows with the daemon's words beside the buttons", async ({ page, request }) => {
  const d = daemon(request);
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: a split pressed twice', outcome: 'It splits once.', criteria: ['The first part', 'The second part'] });
  const tasks = `**/api/goals/${g.id}/tasks`;
  await page.goto(`/goals/${g.id}`);
  await page.getByTestId('split-goal').click();
  const first = page.getByTestId('proposed-1');
  await first.getByLabel('Title').fill('Flow: the edited first part');

  await page.route(tasks, (r) => r.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'the goal changed while you were editing', hint: 'Split it again' } } }));
  await page.getByTestId('create-goal-tasks').click();
  await expect(page.getByTestId('split-error')).toHaveText('The tasks were not created: the goal changed while you were editing. Split it again');
  await expect(first.getByLabel('Title')).toHaveValue('Flow: the edited first part');
  await expect(page.getByTestId('create-goal-tasks')).toBeEnabled();
  await page.unroute(tasks);

  const held = await holdRequests(page, tasks);
  await page.getByTestId('create-goal-tasks').dblclick();
  await expect(page.getByTestId('create-goal-tasks')).toHaveText('Creating tasks');
  await expect(page.getByTestId('create-goal-tasks')).toBeDisabled();
  held.release();
  await expect(page.getByTestId('goal-tasks').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('goal-tasks')).toContainText('Flow: the edited first part');
  expect(held.count()).toBe(1);
  expect((await d.get<{ goal: Goal }>(`/api/goals/${g.id}`)).goal.tasks).toHaveLength(2);
});

test('Saving the limits and abandoning each send one request however often they are pressed, and say they are working', async ({ page, request }) => {
  const d = daemon(request);
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: limits and abandon pressed twice', outcome: 'Each runs once.', criteria: ['It runs once'], limits: { builds: 4 } });
  await page.goto(`/goals/${g.id}`);
  const limits = page.getByTestId('goal-limits');
  await limits.getByText("Change the goal's limits").click();
  await limits.getByLabel('Builds').fill('7');
  const saving = await holdRequests(page, `**/api/goals/${g.id}/limits`, 'PATCH');
  await page.getByTestId('save-goal-limits').dblclick();
  await expect(page.getByTestId('save-goal-limits')).toHaveText('Saving');
  saving.release();
  await expect(page.getByTestId('meter-goal-builds')).toContainText('Builds 0 of 7');
  expect(saving.count()).toBe(1);

  const abandoning = await holdRequests(page, `**/api/goals/${g.id}/abandon`);
  await page.getByTestId('abandon-goal').click();
  await page.getByTestId('abandon-goal').dblclick();
  await expect(page.getByTestId('abandon-goal')).toHaveText('Abandoning');
  abandoning.release();
  await expect(page.getByTestId('abandon-goal')).toHaveCount(0);
  expect(abandoning.count()).toBe(1);
  expect((await d.get<{ goal: Goal }>(`/api/goals/${g.id}`)).goal.status).toBe('abandoned');
});

test('A refresh that fails keeps the goals on screen with a stale warning, and a first load that fails says so with a retry, never that there are no goals', async ({ page, request }) => {
  const d = daemon(request);
  const g = await d.post<{ id: string }>('/api/goals', { title: 'Flow: a goal that stays on screen', outcome: 'It stays.', criteria: ['It stays'] });
  await page.goto('/goals');
  await expect(page.getByTestId(`goal-row-${g.id}`)).toBeVisible();
  await page.route('**/api/goals', (r) => r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'the goals could not be read' } } }));
  // anything that happens refreshes the list
  await d.create('Flow: an event that refreshes the goals');
  await expect(page.getByTestId('goals-stale')).toHaveText(/^Showing the goals as last read\. The refresh failed: the goals could not be read\./);
  await expect(page.getByTestId(`goal-row-${g.id}`)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('goals-error')).toHaveText(/^The goals did not load: the goals could not be read\./);
  await expect(page.getByTestId('goals-empty')).toHaveCount(0);
  await expect(page.getByTestId('goal-list')).toHaveCount(0);
  await page.unroute('**/api/goals');
  await page.getByTestId('goals-error').getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId(`goal-row-${g.id}`)).toBeVisible();
  await expect(page.getByTestId('goals-error')).toHaveCount(0);
});
