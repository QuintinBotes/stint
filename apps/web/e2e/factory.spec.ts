import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('The Factory view renders KPIs, Meta models at work, tasks by stage, cost bars with a legend, the learned pair and the queue', async ({ page }) => {
  await page.goto('/factory');
  await expect(page.getByTestId('kpis')).toContainText('Spend this week');
  // the cache share moved from the figures to the models it describes
  await expect(page.getByTestId('panel-models')).toContainText('Input from cache');
  const models = page.getByTestId('model-row');
  await expect(models.first()).toContainText('Muse Spark 1.3');
  await expect(page.getByTestId('models-at-work')).toContainText('Muse Glimmer 30B');
  await expect(page.getByTestId('models-at-work')).toContainText('Meta Model API');
  await expect(page.getByTestId('loops')).toContainText('Needs you');
  await expect(page.getByTestId('cost-legend')).toContainText('Meta Model API');
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
  await expect(share).toContainText('Fed forward as transcripts');
  await expect(share).toContainText('0%');
  await expect(share).toContainText('all in');

  const loops = page.getByTestId('loops');
  await page.getByRole('heading', { name: /last 7 days/ }).click();
  await expect(loops).toBeVisible();
  await expect(loops.locator('li').filter({ hasText: 'Done' }).locator('span').last()).not.toHaveText('0');
  await expect(loops.locator('li').filter({ hasText: 'Planned' }).locator('span').last()).not.toHaveText('0');
});

test('The Factory shows credits left per host with the derived mark (R-054)', async ({ page }) => {
  await page.goto('/factory');
  const credits = page.getByTestId('credits-left');
  await expect(credits.locator('[data-testid="credits-row"][data-host="baseten"]')).toContainText('≈');
  await expect(credits.locator('[data-testid="credits-row"][data-host="baseten"]')).toContainText('left');
  await expect(credits).toContainText('Derived from metered spend, not read from the provider.');
});

test('The Factory shows the phase gates with their reasons', async ({ page }) => {
  await page.goto('/factory');
  const gates = page.getByTestId('phase-gates');
  await expect(gates).toContainText('Phase 2');
  await expect(gates).toContainText('Phase 3');
  // the replay fixture has no golden results of its own, so it shows Stint's, measured on it; phase 3 has no shadow record
  await expect(gates).toContainText('pass^3 100%');
  await expect(gates).toContainText('No shadow approvals recorded yet');
  await expect(gates).toContainText('not yet');
});

test('The relay shows each agent as a lane, the killed run, the 412-token packet to the next agent, and the skill that crossed tasks', async ({ page }) => {
  await page.goto('/factory');
  const relay = page.getByTestId('relay');
  await expect(relay.locator('[data-lane="muse-code:muse-spark-1.3"]')).toContainText('Muse Code');
  await expect(relay.locator('[data-lane="stint-agent:muse-spark-1.3"]')).toContainText('Stint agent');
  await expect(relay.locator('[data-run="T-0042/r2"]')).toContainText('killed');
  await expect(relay.locator('[data-link="packet"]').first()).toContainText('412 tok');
  await expect(relay.locator('[data-link="skill"]')).toContainText('learned: limiter-config-via-env');
  await expect(relay.locator('[data-mark="approved"]')).toContainText('merged T-0042');
});

test('The scoreboard lists each agent and model with its attempts and pass rate, per tag, and says how autopilot picks', async ({ page }) => {
  await page.goto('/factory');
  const board = page.getByTestId('scoreboard');
  await expect(board.locator('[data-testid="score-row"][data-agent="stint-agent"]')).toContainText('Muse Spark 1.3');
  await expect(board.locator('[data-testid="score-row"][data-agent="stint-agent"]')).toContainText('100%');
  await expect(page.getByTestId('routing-mode')).toContainText('in the order of autopilot.implementers');
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
  await expect(bench.getByTestId('bench-row').nth(2)).toContainText('the packet, again with the digest on');
  for (const [i, m] of lines.entries()) {
    const row = bench.getByTestId('bench-row').nth(i);
    if (!m) throw new Error(`bench line ${i} is missing from the results`);
    await expect(row).toContainText(`${Math.round(m.meanPromptTokens).toLocaleString('en-US')} tokens`);
    await expect(row).toContainText(Math.round(m.meanInputTokens).toLocaleString('en-US'));
    await expect(row).toContainText(`${Math.round(m.passRate * m.runs)} of ${m.runs}`);
  }
  await expect(bench).toContainText(`commit ${plain.commit.slice(0, 7)}`);
});

test('Standings shows Verification and outcomes: four groups, a window switch that changes the window, and each label linked to its definition (R-061)', async ({ page }) => {
  await page.goto('/factory');
  const panel = page.getByTestId('panel-metrics');
  await expect(panel).toBeVisible();
  for (const group of ['verification', 'outcome', 'human', 'learning']) await expect(panel.getByTestId(`metrics-${group}`)).toBeVisible();
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
  await expect(page.getByTestId('kpi-transcript-share')).toContainText('0%');
});
