import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

test('A finding that recurs with an earlier task proposes a skill on approve; approving it on the Skills page mounts it on the next task with its tag', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.post<{ id: string }>('/api/tasks', { title: 'Flow: [learn] a recurring mistake', goal: 'Add a limit, as a flow test.', acceptance: ['the task file exists'], tags: ['limits'] });
  await d.post(`/api/tasks/${t.id}/autopilot`, { on: true });
  await d.until(t.id, stopped);
  await d.post(`/api/tasks/${t.id}/approve`);
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'skill.proposed' || e.type === 'learn.skipped'), 60_000);
  const proposed = (await d.events(t.id)).find((e) => e.type === 'skill.proposed');
  expect(proposed, JSON.stringify((await d.events(t.id)).find((e) => e.type === 'learn.skipped')?.payload)).toBeTruthy();

  await page.goto('/skills');
  const row = page.locator('[data-testid="skill-row"][data-skill="limits-come-from-config"]');
  await row.getByTestId('approve-skill').click();
  await expect.poll(async () => (await d.get<Array<{ id: string; status: string; origin: string }>>('/api/skills')).find((s) => s.id === 'limits-come-from-config')).toMatchObject({ status: 'probation', origin: 'learn-loop' });

  const next = await d.post<{ id: string }>('/api/tasks', { title: 'Flow: the next limit', goal: 'Another limit.', acceptance: ['the task file exists'], tags: ['limits'] });
  await d.post(`/api/tasks/${next.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  const events = await d.until(next.id, (ev) => ev.some((e) => e.type === 'skill.applied'));
  expect(events.find((e) => e.type === 'skill.applied')?.payload.skill).toBeTruthy();
});
