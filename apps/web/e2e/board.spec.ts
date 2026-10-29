import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

// a route handler still serving a poll when a test ends would read a disposed response; drop them first
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }));

type Card = { task: Record<string, unknown>; lastRun: unknown; autopilot: unknown; summary: unknown; cost: Record<string, unknown>; lastEventAt: string; verification: unknown; agents: unknown };

const run = (endedAt: string | null) => ({ run: 'r1', adapter: 'muse-code', vendor: 'meta', role: 'implementer', model: null, host: null, startedAt: '2026-10-29T10:00:00.000Z', endedAt, endedBy: endedAt ? 'completed' : null, cost: null, handoffFrom: null });

/** The board's task list replaced by `make`, built from the replay's first card so every field the card reads is there. */
async function board(page: Page, make: (card: (id: string, status: string, extra?: Partial<Card> & { task?: Record<string, unknown> }) => Card) => Card[]) {
  await page.route('**/api/tasks', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { tasks: Card[] };
    const base = body.tasks[0] as Card;
    const card = (id: string, status: string, extra: Partial<Card> & { task?: Record<string, unknown> } = {}): Card => ({
      ...base,
      lastRun: null,
      autopilot: null,
      summary: null,
      verification: null,
      agents: [],
      cost: { ...base.cost, usd: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
      lastEventAt: '2026-10-29T10:00:00.000Z',
      ...extra,
      task: { ...base.task, id, title: `Task ${id}`, status, parent: undefined, dependsOn: undefined, ...extra.task },
    });
    await route.fulfill({ response: res, json: { tasks: make(card) } });
  });
}

const lane = (page: Page, id: string) => page.getByTestId(`lane-${id}`);

test('The board gathers the statuses into four groups in order, and the summary counts tasks apart from the decisions that wait', async ({ page }) => {
  await board(page, (card) => [
    card('T-0101', 'awaiting_approval', { lastEventAt: '2026-10-29T10:05:00.000Z' }),
    card('T-0102', 'awaiting_approval', { lastEventAt: '2026-10-29T10:01:00.000Z' }),
    card('T-0103', 'rejected'),
    card('T-0104', 'building', { lastRun: run('2026-10-29T10:03:00.000Z'), autopilot: { on: true, step: null, reason: 'the build limit is reached (1 of 1)', queued: false, needsYou: true } }),
    card('T-0105', 'planned'),
    card('T-0106', 'planned', { task: { dependsOn: ['T-0105'] } }),
    card('T-0107', 'building', { lastRun: run(null) }),
    card('T-0108', 'building', { lastRun: run('2026-10-29T10:02:00.000Z') }),
    card('T-0109', 'verifying', { lastRun: run('2026-10-29T10:02:00.000Z') }),
    card('T-0110', 'in_review', { lastRun: run('2026-10-29T10:02:00.000Z') }),
    card('T-0111', 'done', { lastRun: run('2026-10-29T10:02:00.000Z') }),
    card('T-0112', 'abandoned'),
    card('T-0113', 'approved', { lastRun: run('2026-10-29T10:02:00.000Z') }),
  ]);
  const contradiction = (id: string) => ({ id, kind: 'contradiction', task: 'T-0101', run: 'r2', agent: 'glimmer', decision: { id: 'D1', text: 'Limits come from config.' }, finding: { id: 'F1', text: 'Hard-coded limit.' }, at: '2026-10-29T10:04:00.000Z' });
  // two decisions wait on one task; a proposed skill in the same queue is not a decision
  await page.route('**/api/graph/pending', (route) => route.fulfill({ json: [contradiction('q1'), contradiction('q2'), { id: 'q3', kind: 'skill', task: 'T-0101', skill: 's', run: 'r2', agent: 'glimmer', at: '2026-10-29T10:04:00.000Z' }] }));
  await page.goto('/');

  const order = await page.locator('[data-testid^="lane-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(order).toEqual(['lane-needs-you', 'lane-planned', 'lane-in-progress', 'lane-closed']);
  const ids = (id: string) => lane(page, id).getByTestId('task-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-task')));
  expect(await ids('needs-you')).toEqual(['T-0101', 'T-0102', 'T-0103', 'T-0104']);
  expect(await ids('planned')).toEqual(['T-0105', 'T-0106']);
  expect(await ids('in-progress')).toEqual(['T-0107', 'T-0108', 'T-0109', 'T-0110']);
  expect(await ids('closed')).toEqual(['T-0111', 'T-0112', 'T-0113']);

  // running counts only what executes now: the live build and the verifying task, never the idle build or the pull request
  const count = (id: string) => page.getByTestId('board-summary').locator(`[data-count="${id}"] b`);
  await expect(count('needs-you')).toHaveText('4');
  await expect(count('running')).toHaveText('2');
  await expect(count('planned')).toHaveText('2');
  await expect(count('decisions')).toHaveText('2');
  await expect(page.getByTestId('board-summary').locator('[data-count="decisions"]').getByRole('link', { name: 'T-0101' })).toBeVisible();

  // what needs you, in words, before the counts: each task with its reason, the first three by name
  await expect(page.getByTestId('board-attention')).toHaveText('T-0101 waits for your approval; T-0102 waits for your approval; T-0103 was rejected and waits for you to hand it on or leave it; and 1 more.');

  // the next action reviews the task that has waited longest
  await expect(page.getByTestId('review-next')).toHaveText('Review T-0102');
  await expect(page.getByTestId('review-next')).toHaveAttribute('href', '/t/T-0102');

  // each card says its exact state, with a shape beside the word
  const chip = (id: string) => page.locator(`[data-task="${id}"] .stint-status`);
  await expect(chip('T-0101')).toHaveText('awaiting approval');
  await expect(chip('T-0104')).toHaveText('needs you');
  await expect(page.locator('[data-task="T-0104"]').getByTestId('card-blocker')).toHaveText('Autopilot stopped: the build limit is reached (1 of 1)');
  await expect(chip('T-0107')).toHaveText('building');
  await expect(chip('T-0107').locator('svg')).toHaveAttribute('data-shape', 'running');
  await expect(chip('T-0108')).toHaveText('building');
  await expect(chip('T-0108').locator('svg')).toHaveAttribute('data-shape', 'waiting');
  await expect(chip('T-0110')).toHaveText('in PR review');
  await expect(chip('T-0111')).toHaveText('merged');
  await expect(chip('T-0112')).toHaveText('abandoned');
  await expect(chip('T-0113')).toHaveText('approved');
  await expect(page.locator('[data-task="T-0106"]').getByTestId('card-blocker')).toHaveText('Waits for T-0105 to be merged before it starts.');
  // a task that never ran claims no run and no cost
  await expect(page.locator('[data-task="T-0105"]')).toContainText('No run yet');
  await expect(page.locator('[data-task="T-0105"]')).not.toContainText('$');
  // one action on a card that needs approval
  await expect(page.locator('[data-task="T-0102"]').getByRole('link', { name: 'Review and approve' })).toBeVisible();
  await expect(page.locator('[data-task="T-0102"]').getByRole('button')).toHaveCount(0);

  // the replay starts nothing, so Run all planned says why it is off, and what it would do
  const runAll = page.getByTestId('run-all');
  await expect(runAll).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#run-all-what')).toContainText('A task that waits on another starts only once that one is merged.');
  await expect(page.locator('#run-all-what')).toContainText('Not in the replay');
});

test('An empty board says so, and each empty group says what will appear in it', async ({ page }) => {
  await board(page, () => []);
  await page.goto('/');
  await expect(page.getByTestId('empty')).toContainText('No tasks yet.');
  await expect(page.getByTestId('board-attention')).toHaveText('Nothing needs you right now.');
  // an empty group says it is empty before it says what will appear in it
  await expect(lane(page, 'needs-you').locator('.stint-lane-empty')).toHaveText(/^Nothing needs you\.A task waits here for your approval/);
  await expect(lane(page, 'planned')).toContainText('Nothing planned.');
  await expect(lane(page, 'planned')).toContainText('A new task waits here until an agent takes it or autopilot starts it.');
  await expect(lane(page, 'in-progress')).toContainText('its pull request waits');
  await expect(lane(page, 'closed')).toContainText('once it is merged, approved or abandoned');
  await expect(page.getByTestId('new-task')).toHaveClass(/stint-button--primary/);
  await expect(page.getByTestId('run-all')).toHaveCount(0);
});

test('A failed first read says so with Try again; a failed refresh keeps the board on screen and warns it may be out of date', async ({ page, request }) => {
  let fail = true;
  await page.route('**/api/tasks', (route) => (fail ? route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'the daemon is restarting', hint: null } } }) : route.fallback()));
  await page.goto('/');
  const error = page.getByTestId('board-error');
  await expect(error).toContainText('Stint did not answer: the daemon is restarting.');
  // never an empty board that reads as nothing needs you
  await expect(page.getByTestId('board')).toHaveCount(0);
  await expect(page.getByTestId('board-summary')).toHaveCount(0);
  fail = false;
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-task="T-0043"]')).toBeVisible();
  await expect(error).toHaveCount(0);

  // a new task is an event, and the board refreshes on it; that read fails
  fail = true;
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  await request.post('/api/tasks', { headers: { Authorization: `Bearer ${token}` }, data: { title: 'A task that arrives while the board cannot read', goal: 'Trigger a refresh.', acceptance: ['the board warns'] } });
  const stale = page.getByTestId('board-stale');
  await expect(stale).toContainText('This board may be out of date');
  await expect(stale).toContainText('the daemon is restarting');
  await expect(page.locator('[data-task="T-0043"]')).toBeVisible();
  await expect(page.getByTestId('lane-needs-you')).toBeVisible();
  fail = false;
  await stale.getByRole('button', { name: 'Try again' }).click();
  await expect(stale).toHaveCount(0);
  await expect(page.getByTestId('board')).toContainText('A task that arrives while the board cannot read');
});

test('Run all planned says what it would start and under which limits, starts nothing until Start, and sends one request however often Start is pressed', async ({ page }) => {
  // a live daemon for this page only; the request that would start work is caught here and never reaches it
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), mode: 'live', replay: undefined } });
  });
  await board(page, (card) => [card('T-0105', 'planned'), card('T-0106', 'planned', { task: { dependsOn: ['T-0105'] } }), card('T-0107', 'planned')]);
  const own: Record<string, { builds: number | null; usd: number | null }> = { 'T-0105': { builds: 8, usd: null }, 'T-0106': { builds: 3, usd: 2 }, 'T-0107': { builds: 8, usd: null } };
  await page.route('**/api/tasks/*/limits', (route) => {
    const id = /tasks\/(T-\d+)\/limits/.exec(route.request().url())?.[1] as string;
    return route.fulfill({ json: { limits: { handoffs: 2, reviewRounds: 1, minutes: null, ...own[id] }, used: {}, own: {} } });
  });
  let starts = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/autopilot', async (route) => {
    starts++;
    await held;
    await route.fulfill({ json: { on: true, tasks: ['T-0105', 'T-0106', 'T-0107'], running: ['T-0105'], queued: ['T-0106', 'T-0107'], step: 'plan' } });
  });
  await page.goto('/');

  const runAll = page.getByTestId('run-all');
  await expect(runAll).toHaveText('Run all 3 planned');
  await runAll.click();
  const ask = page.getByTestId('run-all-ask');
  await expect(ask).toHaveText(
    'Autopilot plans, builds, tests and reviews T-0105 and T-0107 now, and T-0106 once the tasks it waits on are merged, then stops for your approval. Nothing is merged without you. Each stops after at most 8 builds. 2 of 3 have no spend limit, so their model calls are not capped.',
  );
  const start = page.getByTestId('run-all-confirm');
  await expect(start).toHaveText('Start 3 tasks');
  await expect(start).toBeFocused();
  expect(starts).toBe(0);
  const results = await new AxeBuilder({ page }).include('header').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  // Escape puts it back, still with nothing started
  await page.keyboard.press('Escape');
  await expect(runAll).toBeFocused();
  expect(starts).toBe(0);

  await runAll.click();
  await start.dblclick();
  await expect(start).toHaveText('Starting autopilot');
  await expect(start).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(page.getByText('3 tasks on autopilot')).toBeVisible();
  expect(starts).toBe(1);

  // the palette's Run all opens the same question here, and starts nothing by itself
  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Search or run a command').fill('Run all planned');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-all-ask')).toBeVisible();
  expect(starts).toBe(1);
});

test('A task no run has started asks for no summary and shows its goal; a task that ran asks for one', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/api/tasks/*/summary', (route) => {
    asked.push(/tasks\/(T-\d+)\/summary/.exec(route.request().url())?.[1] as string);
    return route.fulfill({ json: { summary: 'The run wrote one file for its task.', seq: 3, source: 'model' } });
  });
  await board(page, (card) => [card('T-0105', 'planned', { task: { goal: 'Answer 429 over the limit.' } }), card('T-0108', 'building', { lastRun: run('2026-10-29T10:02:00.000Z') })]);
  await page.goto('/');
  await expect(page.locator('[data-task="T-0108"]').getByTestId('card-summary')).toHaveText('Summary: The run wrote one file for its task.');
  const planned = page.locator('[data-task="T-0105"]');
  await expect(planned).toContainText('Answer 429 over the limit.');
  await expect(planned).toContainText('No run yet');
  await expect(planned.getByTestId('card-summary')).toHaveCount(0);
  expect(asked).toEqual(['T-0108']);
});
