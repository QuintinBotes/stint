import { expect, test } from '@playwright/test';

const ev = (url: string) => new URL(url).searchParams.get('ev');
const file = (url: string) => new URL(url).searchParams.get('file');

test('j and k move the rail selection, [ and ] move between diff files, v marks a file viewed, and d focuses the diff', async ({ page }) => {
  await page.goto('/t/T-0042');
  await expect(page.getByTestId('diff-tree').getByTestId('diff-tree-file')).toHaveCount(5);

  await page.keyboard.press('j');
  await expect.poll(() => ev(page.url())).not.toBeNull();
  const first = ev(page.url());
  await page.keyboard.press('j');
  await expect.poll(() => ev(page.url())).not.toBe(first);
  await page.keyboard.press('k');
  await expect.poll(() => ev(page.url())).toBe(first);

  await page.keyboard.press(']');
  await expect.poll(() => file(page.url())).toBe('src/lib/limiter.ts');
  await page.keyboard.press(']');
  await expect.poll(() => file(page.url())).toBe('src/routes/webhooks.ts');
  await page.keyboard.press('[');
  await expect.poll(() => file(page.url())).toBe('src/lib/limiter.ts');

  await page.keyboard.press('v');
  await expect(page.getByTestId('viewed-count')).toContainText('1 of 5 viewed');
  await expect(page.getByTestId('mark-viewed')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(page.getByTestId('viewed-count')).toContainText('0 of 5 viewed');

  await page.goto('/t/T-0042?tab=packet');
  await expect(page.getByTestId('tab-packet')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('d');
  await expect(page.getByTestId('diff-pane')).toBeVisible();
  await expect(page.getByTestId('diff-pane')).toBeFocused();
});
