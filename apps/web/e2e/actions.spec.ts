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
  await page.getByPlaceholder('Search or run a command').fill('Verify');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `${id}: tests run by Stint` })).toBeVisible({ timeout: 30_000 });

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Search or run a command').fill('Request changes');
  await page.keyboard.press('Enter');
  await expect(page.getByText('What should change? This becomes the next ask.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('x');
  await expect(page.getByText('Why reject it? The reason becomes a decision.')).toBeVisible();
});

test('On a merged task, the palette offers its views and no gate or autopilot actions', async ({ page }) => {
  await page.goto('/t/T-0042');
  await page.keyboard.press('Meta+k');
  const list = page.getByRole('listbox');
  await expect(list.getByText('Show the packet')).toBeVisible();
  await expect(list.getByText('Approve and merge')).toHaveCount(0);
  await expect(list.getByText('Put on autopilot')).toHaveCount(0);
  await expect(list.getByText('Run the tests', { exact: true })).toHaveCount(0);
});

test('Looking back on a task, the palette offers Return to latest in place of Approve and every change; the views keep the moment, and Return to latest clears it', async ({ page }) => {
  // T-0043 waits at the gate, so Approve is offered at the latest moment and must not be while looking back
  const { events } = (await (await page.request.get('/api/tasks/T-0043/events')).json()) as { events: Array<{ seq: number; ts: string }> };
  const early = events[2] as { seq: number; ts: string };
  await page.goto(`/t/T-0043?asOf=${encodeURIComponent(early.ts)}&at=${early.seq}`);
  await page.keyboard.press('Meta+k');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: 'Return to latest' })).toBeVisible();
  for (const name of [/^Approve and merge/, /^Request changes/, /^Reject/, /^Run the tests/, /^Hand to another agent/, /^Put on autopilot/, /^Take off autopilot/, /^Assign to/, /^Stop the live run/]) await expect(list.getByRole('option', { name })).toHaveCount(0);
  await list.getByRole('option', { name: /^Show the packet/ }).click();
  await expect(page).toHaveURL(/tab=packet/);
  await expect(page).toHaveURL(/asOf=/);

  await page.keyboard.press('Meta+k');
  await page.getByRole('listbox').getByRole('option', { name: 'Return to latest' }).click();
  await expect(page).not.toHaveURL(/asOf=|[?&]at=/);
  await expect(page).toHaveURL(/tab=packet/);
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('listbox').getByRole('option', { name: /^Approve and merge/ })).toBeVisible();
  await expect(page.getByRole('listbox').getByRole('option', { name: 'Return to latest' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
