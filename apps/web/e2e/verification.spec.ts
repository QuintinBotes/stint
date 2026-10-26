import { expect, test } from '@playwright/test';

test('The verification tab lists every run, shows the selected one, maps acceptance criteria and re-runs the tests for real', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task to verify', goal: 'Run the tests.', acceptance: ['the limiter answers 429'], testCommand: "printf '(pass) limiter > answers 429 [1ms]\\n 1 pass\\n 0 fail\\n'" } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}/verification`)).json()) as unknown[]).length).toBeGreaterThan(0);

  await page.goto(`/t/${id}?tab=verification`);
  await expect(page.getByTestId('verification-summary')).toContainText('1 passed, 0 failed, run by the daemon');
  await expect(page.getByTestId('tamper-line')).toContainText('tests unchanged');
  await expect(page.getByTestId('check-tests')).toContainText('tests');
  await expect(page.getByTestId('check-tests')).toContainText('1 passed, 0 failed');
  await expect(page.getByTestId('verification-run-r1')).toBeVisible();
  await expect(page.getByTestId('acceptance')).toContainText('checked by 1 test');
  await page.getByTestId('toggle-output').click();
  await expect(page.getByTestId('verification-output')).toContainText('(pass) limiter > answers 429');
  await page.getByTestId('rerun').click();
  await expect(page.getByTestId('rerun')).toHaveText('Re-run the tests', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
