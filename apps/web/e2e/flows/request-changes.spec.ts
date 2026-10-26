import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('Pressing r on the gate asks for changes: the task goes back to building, and the next run is asked what was typed', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: request changes');
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('approval-gate')).toBeVisible();
  await page.keyboard.press('r');
  await page.getByRole('textbox').last().fill('Name the export LIMIT, not DONE.');
  await page.getByRole('button', { name: /Ask for changes|Send|Request changes/ }).click();
  await expect.poll(async () => (await d.task(t.id)).status).toBe('building');

  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'stint-agent', role: 'implementer' });
  const events = await d.until(t.id, (ev) => ev.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').length >= 2 && ev.filter((e) => e.type === 'agent.message').length >= 2);
  const second = events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').at(-1);
  // the agent says back the ask its prompt carried
  const said = events.find((e) => e.type === 'agent.message' && e.run === second?.run);
  expect(String(said?.payload.text)).toContain('Asked: Name the export LIMIT, not DONE.');
});
