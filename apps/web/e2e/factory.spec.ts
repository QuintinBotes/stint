import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('The Factory view renders KPIs, Meta models at work, tasks by stage, the learned pair and the queue', async ({ page }) => {
  await page.goto('/factory');
  await expect(page.getByTestId('kpis')).toContainText('Tasks merged');
  // the cache share moved from the figures to the models it describes
  await expect(page.getByTestId('panel-models')).toContainText('Read from cache overall');
  const models = page.getByTestId('model-row');
  await expect(models.first()).toContainText('Muse Spark 1.3');
  await expect(page.getByTestId('models-at-work')).toContainText('Muse Glimmer 30B');
  await expect(page.getByTestId('models-at-work')).toContainText('Meta Model API');
  await expect(page.getByTestId('loops')).toContainText('Needs you');
  await expect(page.getByTestId('it-learned')).toContainText('limiter-config-via-env');
  await expect(page.getByTestId('queue-row').first()).toContainText('would reverse D3');
});

test('The Factory shows the workspace graph with its scrubber, the transcript-share KPI and a 7-day funnel (R-052)', async ({ page }) => {
  await page.goto('/factory');
  // the workspace graph is one click away, under its heading
  await page.getByTestId('panel-memory').getByText('Workspace memory').click();
  const memory = page.getByTestId('factory-memory');
  await expect(memory.locator('[data-node="decision:T-0042/D3"]')).toBeVisible();
  const scrubber = page.getByTestId('factory-memory-scrubber');
  await scrubber.fill(String(await scrubber.getAttribute('min')));
  // at the workspace's first moment D3 was not recorded yet
  await expect(memory.locator('[data-node="decision:T-0042/D3"]')).toHaveCount(0);

  const share = page.getByTestId('kpi-transcript-share');
  await expect(share).toContainText('not the full session log');
  await expect(share).toContainText('Full logs passed on: 0%');
  await expect(share).toContainText(/a packet of about [\d,]+ tokens/);

  const loops = page.getByTestId('loops');
  await page.getByRole('heading', { name: /last 7 days/ }).click();
  await expect(loops).toBeVisible();
  await expect(loops.locator('li').filter({ hasText: 'Done' }).locator('span').last()).not.toHaveText(/^0 /);
  await expect(loops.locator('li').filter({ hasText: 'Planned' }).locator('span').last()).not.toHaveText(/^0 /);
});

test('The Factory shows the phase gates with their reasons', async ({ page }) => {
  await page.goto('/factory');
  const gates = page.getByTestId('phase-gates');
  await expect(gates).toContainText('Phase 2');
  await expect(gates).toContainText('Phase 3');
  // the replay fixture has no golden results of its own, so it shows Stint's, measured on it; phase 3 has no shadow record
  await expect(gates).toContainText('100% of tasks passed every try');
  await expect(gates).toContainText('No auto-approve trial recorded yet');
  await expect(gates).toContainText('not yet');
});

test('The relay shows each agent as a lane, the killed run, the 412-token packet to the next agent, and the skill that crossed tasks', async ({ page }) => {
  await page.goto('/factory');
  const relay = page.getByTestId('relay');
  await expect(relay.locator('[data-lane="muse-code:muse-spark-1.3"]')).toContainText('Muse Code');
  await expect(relay.locator('[data-lane="stint-agent:muse-spark-1.3"]')).toContainText('Stint agent');
  await expect(relay.locator('[data-run="T-0042/r2"]')).toContainText('killed');
  await expect(relay.locator('[data-link="packet"]').first()).toContainText('412 tokens');
  await expect(relay.locator('[data-link="skill"]')).toContainText('learned: limiter-config-via-env');
  await expect(relay.locator('[data-mark="approved"]')).toContainText('merged T-0042');
});

test('The scoreboard lists each agent and model with its attempts and pass rate, per tag, and says how autopilot picks', async ({ page }) => {
  await page.goto('/factory');
  const board = page.getByTestId('scoreboard');
  await expect(board.locator('[data-testid="score-row"][data-agent="stint-agent"]')).toContainText('Muse Spark 1.3');
  await expect(board.locator('[data-testid="score-row"][data-agent="stint-agent"]')).toContainText('100%');
  await expect(page.getByTestId('routing-mode')).toContainText('in the order set in the config, autopilot.implementers');
});

test('The Factory says upkeep is off and how to turn it on', async ({ page }) => {
  await page.goto('/factory');
  await expect(page.getByTestId('upkeep-off')).toContainText('"schedule": "weekly"');
});

test('The demo closes on any harness, any model, one packet: every configured harness and host, ready ones marked', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('replay-close')).toContainText('Any harness, any model, one packet.');
  await page.getByTestId('replay-close').click();
  await expect(page).toHaveURL(/\/factory/);
  const panel = page.getByTestId('any-harness');
  // the link lands on the panel, not on the top of the page
  await expect(panel).toBeInViewport();
  await expect(panel.getByTestId('harness-chips')).toContainText('Muse Code');
  await expect(panel.getByTestId('harness-chips')).toContainText('Claude Code');
  await expect(panel.getByTestId('harness-chips')).toContainText('goose, acp');
  await expect(panel.getByTestId('host-chips')).toContainText('Meta Model API');
  await expect(panel.getByTestId('host-chips')).toContainText('Ollama');
});

test('The Factory shows the benchmark the fixture was measured with: transcript, packet, and packet with the digest, as the results files record them', async ({ page }) => {
  // the numbers come from the committed live results, so a new bench run changes them without touching this test
  const read = (path: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', path), 'utf8')) as { commit: string; byMode: Record<string, { runs: number; passRate: number; meanPromptTokens: number; meanInputTokens: number }> };
  const plain = read('bench/results.json');
  const digest = read('bench/digest/results.json');
  const lines = [plain.byMode.transcript, plain.byMode.packet, digest.byMode.packet];
  await page.goto('/factory');
  const bench = page.getByTestId('panel-bench');
  await expect(bench.getByTestId('bench-row')).toHaveCount(3);
  await expect(bench.getByTestId('bench-row').nth(2)).toContainText('the packet, with a summary of the change');
  for (const [i, m] of lines.entries()) {
    const row = bench.getByTestId('bench-row').nth(i);
    if (!m) throw new Error(`bench line ${i} is missing from the results`);
    await expect(row).toContainText(`${Math.round(m.meanPromptTokens).toLocaleString('en-US')} tokens`);
    await expect(row).toContainText(Math.round(m.meanInputTokens).toLocaleString('en-US'));
    await expect(row).toContainText(`${Math.round(m.passRate * m.runs)} of ${m.runs}`);
  }
  await expect(bench).toContainText(`commit ${plain.commit.slice(0, 7)}`);
});

test('The Factory shows the scorecard: pass^1 and pass^3 per task and overall, hand-off, review agreement, time per green attempt, who ran, each with its run count, and an empty state where none was run (R-070)', async ({ page }) => {
  const fixture = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'schemas', 'examples', 'scorecard.json'), 'utf8');
  await page.route('**/api/scorecard', (r) => r.fulfill({ contentType: 'application/json', body: fixture }));
  await page.goto('/factory');
  const panel = page.getByTestId('panel-scorecard');
  await panel.locator(':scope > summary').click();
  const cells = async (testId: string) => Promise.all((await panel.getByTestId(testId).all()).map((row) => row.locator('td').allInnerTexts()));
  expect(await cells('scorecard-row')).toEqual([
    ['pass^1, ms-unit-option', 'none yet', '0 graded attempts'],
    ['pass^3, ms-unit-option', 'not yet', '0 graded attempts'],
    ['pass^1, negotiator-preferred', '1 of 3 (33%)', '3 graded attempts'],
    ['pass^3, negotiator-preferred', 'no, 1 of 3 green', '3 graded attempts'],
    ['pass^1, all tasks', '1 of 3 (33%)', '3 graded attempts'],
    ['pass^3, all tasks', '0 of 1 (0%)', '1 task with 3 graded attempts'],
    ['Hand-off success: continued runs that went green', '1 of 2 (50%)', '2 continued runs in 1 relay'],
    ['Bad patches stopped by the tests alone', '1 of 2 (50%)', '2 attempts the hidden tests failed'],
    ['Bad patches stopped by the tests or the review', '2 of 2 (100%)', '2 attempts the hidden tests failed'],
    ['Review caught: asked for changes, hidden tests red', '1', '2 reviewed attempts'],
    ['Review missed: approved, hidden tests red', '0', '2 reviewed attempts'],
    ['Review false alarm: asked for changes, hidden tests green', '0', '2 reviewed attempts'],
    ['Review agreed: approved, hidden tests green', '1', '2 reviewed attempts'],
    ['Wall time per green attempt', '8.5 min', '1 green attempt'],
  ]);
  expect(await cells('scorecard-model')).toEqual([
    ['The scorecard attempts', 'Muse Spark Open', 'Baseten', 'Stint agent', 'builds', '3'],
    ['The scorecard attempts', 'Muse Glimmer 30B', 'Ollama on this machine', 'openai-compatible', 'reviews', '2'],
    ['The relays', 'Muse Spark 1.3', 'local CLI', 'Muse Code', 'builds', '1'],
    ['The relays', 'Muse Glimmer 30B', 'Ollama on this machine', 'Claude Code', 'builds', '1'],
    ['The relays', 'Muse Spark 1.3', 'Meta Model API', 'Codex', 'builds', '1'],
  ]);
  await expect(panel.getByTestId('scorecard-scope')).toHaveText(
    'Measured live on October 30: 4 attempts on 2 seeded tasks in 2 repositories, each from a fresh clone, graded by hidden tests the agent never saw. It shows what the tests and the review caught on these tasks; it does not show how an agent does on other work, and each figure rests only on the runs beside it.',
  );

  // a repository the scorecard was never run on says so, and is not an error
  await page.route('**/api/scorecard', (r) => r.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'no scorecard yet' } } }));
  await page.reload();
  await panel.locator(':scope > summary').click();
  await expect(panel.getByTestId('scorecard-empty')).toHaveText('The scorecard appears here once one has been run on this repository, with the hidden tests that grade it.');
  await expect(panel.getByTestId('panel-error')).toHaveCount(0);
});

test('The Factory shows what the agents did: every measure by group behind one disclosure, a window switch that changes the window, and each label linked to its definition (R-061)', async ({ page }) => {
  await page.goto('/factory');
  const panel = page.getByTestId('panel-metrics');
  await expect(panel).toBeVisible();
  await panel.getByTestId('panel-measures').locator('summary').click();
  for (const group of ['verification', 'outcome', 'human', 'learning', 'efficiency']) await expect(panel.getByTestId(`metrics-${group}`)).toBeVisible();
  // 30 days is the default; switching to 7 days asks the daemon for that window and says the new range
  await expect(panel.getByTestId('metrics-window-30d')).toHaveAttribute('aria-pressed', 'true');
  const thirty = await panel.getByTestId('metrics-window').textContent();
  const asked = page.waitForRequest((r) => r.url().includes('/api/metrics?window=7d'));
  await panel.getByTestId('metrics-window-7d').click();
  await asked;
  await expect(panel.getByTestId('metrics-window-7d')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('metrics-window')).not.toHaveText(thirty ?? '');
  // every metric, shown or waiting for data, links to its own anchor in docs/metrics.md, and says it opens the definition
  const metrics = panel.getByTestId('metric');
  expect(await metrics.count()).toBeGreaterThan(10);
  for (const m of await metrics.all()) {
    const id = (await m.getAttribute('data-metric')) as string;
    const link = m.getByTestId('metric-link');
    await expect(link).toHaveAttribute('href', new RegExp(`docs/metrics\\.md#${id.replace('.', '\\.')}$`));
    await expect(link).toContainText('opens its definition');
  }
  // the figures row reads the same response: the transcript share is efficiency.transcript_share
  await expect(page.getByTestId('kpi-transcript-share')).toContainText('Full logs passed on: 0%');
});

test('A Factory panel whose read fails says so in the daemon\'s words, never that there is nothing to show', async ({ page }) => {
  await page.route('**/api/scoreboard', (r) => r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'the scoreboard could not be computed' } } }));
  await page.goto('/factory');
  const panel = page.getByTestId('panel-scoreboard');
  await expect(panel.getByTestId('panel-error')).toHaveText("Each agent's record could not be read: the scoreboard could not be computed.");
  await expect(panel.getByTestId('scoreboard-empty')).toHaveCount(0);
  await expect(panel.getByTestId('scoreboard')).toHaveCount(0);
  // the other panels read on their own
  await expect(page.getByTestId('kpis')).toContainText('Tasks merged');
});

test('The Factory lead counts merges as the Tasks merged figure does, and one build run is singular', async ({ page }) => {
  // two tasks marked done, one of them with its merge in the log
  await page.route('**/api/tasks', async (route) => {
    const res = await route.fetch();
    const base = ((await res.json()) as { tasks: Array<{ task: Record<string, unknown> }> }).tasks[0] as { task: Record<string, unknown> };
    const card = (id: string) => ({ ...base, task: { ...base.task, id, status: 'done', parent: undefined, dependsOn: undefined } });
    await route.fulfill({ response: res, json: { tasks: [card('T-0201'), card('T-0202')] } });
  });
  const event = (task: string, type: string, seq: number) => ({ id: `E${seq}`, seq, ts: '2026-10-29T10:00:00.000Z', task, type, payload: {} });
  await page.route('**/api/tasks/T-020*/events?*', (route) => {
    const id = /T-020\d/.exec(route.request().url())?.[0] as string;
    return route.fulfill({ json: { events: id === 'T-0201' ? [event(id, 'task.created', 1), event(id, 'merge.completed', 2)] : [event(id, 'task.created', 1)] } });
  });
  await page.route('**/api/metrics?*', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { groups: Record<string, Array<{ id: string; value: number | null }>> };
    for (const m of body.groups.efficiency ?? []) if (m.id === 'efficiency.hops') m.value = 1;
    await route.fulfill({ response: res, json: body });
  });
  await page.route('**/api/scoreboard', (route) =>
    route.fulfill({ json: { rows: [{ tag: '*', agent: 'muse-code', model: null, runs: 1, attempts: 1, passed: 1, passRate: 1, pass3: null, resolved: 1, costPerResolved: 0.0042, reverts: 0 }], routing: { mode: 'chains', explore: 0 } } }),
  );
  await page.goto('/factory');
  await expect(page.getByTestId('factory-headline')).toHaveText('How the agents are doing. It has merged one task so far.');
  await expect(page.getByTestId('kpis')).toContainText('1 build run each');
});

test('The Factory charts review findings per task from the replay, marks where limiter-config-via-env was approved, and says it in words (R-070)', async ({ page }) => {
  await page.goto('/factory');
  await page.getByTestId('panel-learning').getByText('Review findings per task').click();
  const chart = page.getByTestId('learning-chart');
  await expect(chart.getByRole('img', { name: /^Review findings per task, in the order reviewed: T-0040, 2 findings; T-0042, 2 findings; limiter-config-via-env approved; T-0043, 0 findings/ })).toBeVisible();
  const point = (task: string) => chart.locator(`[data-testid="learning-point"][data-task="${task}"]`);
  await expect(point('T-0040')).toHaveAttribute('data-findings', '2');
  await expect(point('T-0042')).toHaveAttribute('data-findings', '2');
  await expect(point('T-0043')).toHaveAttribute('data-findings', '0');
  const mark = chart.locator('[data-testid="learning-approval"][data-skill="limiter-config-via-env"]');
  await expect(mark).toContainText('limiter-config-via-env approved');
  // drawn in review order, with the approval between the review before it and the one after
  const at = async (l: import('@playwright/test').Locator) => {
    const box = await l.boundingBox();
    if (!box) throw new Error('not drawn');
    return box.x + box.width / 2;
  };
  const [t40, t42, t43, line] = [await at(point('T-0040').locator('circle')), await at(point('T-0042').locator('circle')), await at(point('T-0043').locator('circle')), await at(mark.locator('line'))];
  expect(t40).toBeLessThan(t42);
  expect(t42).toBeLessThan(line);
  expect(line).toBeLessThan(t43);
  await expect(page.getByTestId('learning-summary')).toContainText('Findings fell from 2 on T-0042 to 0 on T-0043 after limiter-config-via-env was approved.');
});
