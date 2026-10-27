import { expect, test } from '@playwright/test';

test('The Factory view renders KPIs, Meta models at work, tasks by stage, cost bars with a legend, the learned pair and the queue', async ({ page }) => {
  await page.goto('/factory');
  await expect(page.getByTestId('kpis')).toContainText('Input from cache');
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
  const memory = page.getByTestId('factory-memory');
  await expect(memory.locator('[data-node="decision:T-0042/D3"]')).toBeVisible();
  const scrubber = page.getByTestId('factory-memory-scrubber');
  await scrubber.fill(String(await scrubber.getAttribute('min')));
  await expect(memory.locator('[data-node="decision:T-0042/D3"]')).toHaveAttribute('data-state', 'faded');

  const share = page.getByTestId('kpi-transcript-share');
  await expect(share).toContainText('Fed forward as transcripts');
  await expect(share).toContainText('0%');
  await expect(share).toContainText('all in');

  const loops = page.getByTestId('loops');
  await expect(page.getByRole('heading', { name: /last 7 days/ })).toBeVisible();
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
  // the replay fixture has no golden results file, so both gates say not yet and say why
  await expect(gates).toContainText('No golden results yet');
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
  await expect(panel.getByTestId('harness-chips')).toContainText('Muse Code');
  await expect(panel.getByTestId('harness-chips')).toContainText('Claude Code');
  await expect(panel.getByTestId('harness-chips')).toContainText('goose, acp');
  await expect(panel.getByTestId('host-chips')).toContainText('Meta Model API');
  await expect(panel.getByTestId('host-chips')).toContainText('Ollama');
});

test('The Factory shows the benchmark the fixture was measured with: transcript, packet, and packet with the digest, each 5 of 5 green', async ({ page }) => {
  await page.goto('/factory');
  const bench = page.getByTestId('panel-bench');
  await expect(bench.getByTestId('bench-row')).toHaveCount(3);
  await expect(bench.getByTestId('bench-row').nth(0)).toContainText('4,418 tokens');
  await expect(bench.getByTestId('bench-row').nth(1)).toContainText('728 tokens');
  await expect(bench.getByTestId('bench-row').nth(2)).toContainText('the packet with the diff digest');
  await expect(bench.getByTestId('bench-row').nth(2)).toContainText('48,623');
  for (const row of await bench.getByTestId('bench-row').all()) await expect(row).toContainText('5 of 5');
  await expect(bench).toContainText('commit be1bee8');
});
