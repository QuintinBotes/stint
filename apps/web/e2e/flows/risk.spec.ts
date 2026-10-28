import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('The gate shows the risk tier and why; approving it puts a shadow decision on the Factory record while the lane stays off', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: risk and shadow');
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('risk-line')).toContainText('low risk');
  await expect(page.getByTestId('risk-line')).toContainText('nothing sensitive');
  await page.keyboard.press('a');
  await expect(page.getByTestId('signoff')).toBeVisible();
  const shadow = (await d.events(t.id)).find((e) => e.type === 'autoapprove.shadow');
  expect(shadow?.payload).toMatchObject({ tier: 'low', wouldApprove: true, humanDecision: 'approved' });

  await page.goto('/factory');
  await page.getByTestId('panel-auto-approve').locator('summary').click();
  const panel = page.getByTestId('auto-approve');
  await expect(panel).toContainText('lane off');
  await expect(panel.locator('[data-testid="shadow-row"][data-tier="low"]')).toBeVisible();
  await expect(panel.locator('[data-testid="lane-tier"][data-tier="low"]')).toContainText('waits for you');
});
