import { expect, test } from '@playwright/test';

test('On a task, the palette runs Verify for real and opens Request changes; r and x open the gate forms', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task for the palette', goal: 'Act on it.', acceptance: ['actions work'], testCommand: "printf ' 1 pass\\n 0 fail\\n'" } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}/verification`)).json()) as unknown[]).length).toBeGreaterThan(0);
  await page.goto(`/t/${id}`);

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Type a command or a task').fill('Verify');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${id}: tests run by the daemon` })).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Type a command or a task').fill('Request changes');
  await page.keyboard.press('Enter');
  await expect(page.getByText('What should change? This becomes the next ask.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('x');
  await expect(page.getByText('Why reject it? The reason becomes a decision.')).toBeVisible();
});
