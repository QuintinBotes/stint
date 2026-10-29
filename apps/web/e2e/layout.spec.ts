import { expect, test } from '@playwright/test';

// R-065 2.6: four Board columns at 1200 px and wider, two from 768 px, one below.
for (const [width, columns] of [
  [1440, 4],
  [1280, 4],
  [1024, 2],
  [768, 2],
  [390, 1],
] as const) {
  test(`At ${width} px the Board lays its groups out in ${columns} column${columns === 1 ? '' : 's'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const tracks = await board.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
    expect(tracks).toBe(columns);
  });
}

// R-065 7.4 and R-067 Acceptance 3: no document-level sideways scroll on the main pages at the four sizes, in either theme.
for (const scheme of ['dark', 'light'] as const) {
  test(`No main page scrolls sideways at 1440, 1280, 768 or 390 px in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const wide: string[] = [];
    for (const [w, h] of [
      [1440, 900],
      [1280, 800],
      [768, 1024],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of ['/', '/t/T-0042', '/t/T-0043', '/t/T-0042?tab=verification', '/goals', '/factory', '/skills']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 0) wide.push(`${path} at ${w}: ${over} px`);
      }
    }
    expect(wide).toEqual([]);
  });
}
