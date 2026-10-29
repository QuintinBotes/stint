import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('Pressing r on the gate asks for changes: autopilot, stopped at the gate, goes on again, and the next run is asked exactly what was typed', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: request changes');
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('approval-gate')).toBeVisible();
  await page.keyboard.press('r');
  const field = page.locator('#gate-text');
  await expect(field).toBeFocused();
  // the r that opened the field is not in it
  await expect(field).toHaveValue('');
  await expect(page.locator('label[for="gate-text"]')).toHaveText('What should change? Autopilot builds the task again with this as the ask.');
  await page.keyboard.type('Name the export LIMIT, not DONE.');
  await expect(field).toHaveValue('Name the export LIMIT, not DONE.');
  await page.getByTestId('approval-gate').getByRole('button', { name: 'Request changes' }).click();
  const events = await d.until(t.id, (ev) => ev.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').length >= 2 && ev.filter((e) => e.type === 'agent.message').length >= 2);
  expect(events.find((e) => e.type === 'approval.rejected')?.payload.reason).toBe('Name the export LIMIT, not DONE.');
  const second = events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').at(-1);
  // the agent says back the ask its prompt carried
  const said = events.find((e) => e.type === 'agent.message' && e.run === second?.run);
  expect(String(said?.payload.text)).toContain('Asked: Name the export LIMIT, not DONE.');
  expect(events.filter((e) => e.type === 'autopilot.started')).toHaveLength(2);
  await d.until(t.id, (ev) => ev.filter((e) => e.type === 'autopilot.stopped').length >= 2);
});

test('Pressing x on a gate reached by hand opens an empty reject field that says the task goes to Needs you; Escape closes it, drops the text and puts focus back on Reject', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: reject from the keyboard');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'approval.requested'));
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('approval-gate')).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('x');
  const field = page.locator('#gate-text');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await expect(page.locator('label[for="gate-text"]')).toHaveText('Why reject it? The reason becomes a decision, and the task goes to Needs you as rejected.');
  await page.keyboard.type('Wrong file');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(page.getByTestId('ask-reject')).toBeFocused();
  await page.keyboard.press('x');
  await expect(page.locator('#gate-text')).toHaveValue('');
});
