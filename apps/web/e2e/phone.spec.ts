import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('At 390 px width the board has no horizontal scroll', async ({ page }) => {
  for (const path of ['/', '/t/T-0042']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, path).toBeLessThanOrEqual(client);
  }
});
