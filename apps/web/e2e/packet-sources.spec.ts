import { expect, test } from '@playwright/test';

test('A packet built from a real run shows where each part came from, and an event link selects it on the timeline', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task with a packet', goal: 'End a run.', acceptance: ['a packet exists'] } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}/handoffs`)).json()) as { names: string[] }).names.length).toBeGreaterThan(0);

  await page.goto(`/t/${id}?tab=packet`);
  const sources = page.getByTestId('packet-sources');
  await sources.locator('summary').click();
  await expect(sources).toContainText('the event log');
  await sources.getByRole('button').first().click();
  await expect(page).toHaveURL(/ev=\d+/);
});
