import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('After a kill the task view recommends a different agent; one click hands the task over and a new run starts from the packet', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: who continues');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'sleeper', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'run.started'));
  await d.post(`/api/tasks/${t.id}/runs/r1/stop`);
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));
  await page.goto(`/t/${t.id}`);
  const card = page.getByTestId('who-continues');
  await expect(card).toContainText('Recommended:');
  await expect(card).toContainText('was killed');
  await card.getByTestId('who-continues-hand').click();
  const events = await d.until(t.id, (ev) => ev.filter((e) => e.type === 'run.started').length >= 2);
  const second = events.filter((e) => e.type === 'run.started').at(-1);
  expect(second?.adapter).not.toBe('sleeper');
  expect(String(second?.payload.handoffFrom)).toMatch(/^h\d+$/);
});
