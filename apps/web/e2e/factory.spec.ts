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
