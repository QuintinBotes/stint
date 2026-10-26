import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('The verification tab lists the run, maps the acceptance criterion, shows the output, and re-runs the tests after merge when the worktree is gone', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: verification', ['the task file exists']);
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto(`/t/${t.id}?tab=verification`);
  const tab = page.getByTestId('verification-tab');
  await expect(tab.getByTestId('verification-summary')).toContainText('1');
  await expect(tab.getByTestId('acceptance')).toContainText('the task file exists');
  await tab.getByTestId('toggle-output').first().click();
  await expect(tab.getByTestId('verification-output')).toContainText('1 pass');

  await d.post(`/api/tasks/${t.id}/approve`);
  const before = (await d.events(t.id)).filter((e) => e.type === 'verification.ran').length;
  await page.reload();
  await page.getByTestId('rerun').click();
  await d.until(t.id, (ev) => ev.filter((e) => e.type === 'verification.ran').length > before);
  expect((await d.events(t.id)).filter((e) => e.type === 'verification.ran').at(-1)?.payload.status).toBe('green');
});
