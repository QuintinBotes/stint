import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';
import { holdRequests } from './pending';

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
  await expect(page.getByTestId('kpis')).toContainText('Tasks merged');
});

test("Turn the lane off sends once however often it is pressed, says it is working, and a refusal says why the lane is still on", async ({ page }) => {
  // the lane is off in the flows config; the page is shown it on, so its off switch can be pressed
  await page.route('**/api/risk', async (r) => {
    const res = await r.fetch();
    const body = (await res.json()) as { lane: { enabled: boolean } };
    await r.fulfill({ response: res, json: { ...body, lane: { ...body.lane, enabled: true } } });
  });
  await page.goto('/factory');
  await page.getByTestId('panel-auto-approve').locator('summary').click();
  const off = page.getByTestId('lane-off');

  await page.route('**/api/risk/autoapprove', (r) => r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'the config could not be written' } } }));
  await off.click();
  await expect(page.getByTestId('lane-off-error')).toHaveText('The lane is still on: the config could not be written');
  await page.unroute('**/api/risk/autoapprove');

  const held = await holdRequests(page, '**/api/risk/autoapprove');
  await off.dblclick();
  await expect(off).toHaveText('Turning it off');
  await expect(off).toBeDisabled();
  held.release();
  await expect(off).toHaveText('Turn the lane off');
  expect(held.count()).toBe(1);
  await expect(page.getByTestId('lane-off-error')).toHaveCount(0);
});
