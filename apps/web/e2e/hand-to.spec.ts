import { expect, test } from '@playwright/test';

test('The Hand to picker recommends an agent other than the leaving one and says why', async ({ page, request }) => {
  const health = (await (await request.get('/api/health')).json()) as { adapters: Array<{ id: string; roles: string[]; capability: { level: string } }> };
  const ready = health.adapters.filter((a) => a.id !== 'replay' && a.roles.includes('implementer') && a.capability.level === 'supported');
  test.skip(ready.length === 0, 'no implementer agent is available on this machine');
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task to hand on', goal: 'Hand it on.', acceptance: ['another agent continues'] } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}/handoffs`)).json()) as { names: string[] }).names.length).toBeGreaterThan(0);
  await page.goto(`/t/${id}?tab=packet`);
  const picker = page.getByTestId('hand-to');
  await expect(picker.getByText('recommended', { exact: true })).toBeVisible();
  await expect(page.getByTestId('hand-reason')).toContainText('a different agent from Replay');
  await expect(page.getByTestId('hand-button')).toBeEnabled();
});
