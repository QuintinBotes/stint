import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('After real runs the Factory shows the relay with the agents that ran, the models at work, the scoreboard and the queue', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: factory');
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto('/factory');
  await expect(page.getByTestId('relay')).toContainText('Muse Code');
  await page.getByTestId('panel-models').getByText('Meta models at work').click();
  await expect(page.getByTestId('models-at-work')).toBeVisible();
  await expect(page.getByTestId('scoreboard').locator('[data-testid="score-row"][data-agent="muse-code"]')).toBeVisible();
  await expect(page.getByTestId('kpis')).toContainText('Runs');
});
