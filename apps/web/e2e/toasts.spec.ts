import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('A red verification raises a toast that opens the task', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task with red tests', goal: 'Fail.', acceptance: ['the toast says the tests are red'], testCommand: 'false' } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: `${id}: the tests are red` });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  // once it has finished fading in, the toast and its action meet WCAG A and AA, in both themes
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect.poll(() => toast.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const results = await new AxeBuilder({ page }).include('[data-sonner-toaster]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), scheme).toEqual([]);
  }
  await toast.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${id}`));
});
