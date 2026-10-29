import { expect, test } from '@playwright/test';

// One look, charcoal: no theme control in the top bar or the palette, nothing set on <html>, and every screen on the charcoal ground.
test('There is no theme control, and every screen sits on the charcoal ground', async ({ page }) => {
  for (const path of ['/', '/t/T-0042', '/factory', '/skills']) {
    await page.goto(path);
    await expect(page.getByTestId('palette-button')).toBeVisible();
    await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), path).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe('rgb(11, 15, 20)');
  }
  // the palette's Settings group holds the single-key switch and nothing about a theme
  await page.keyboard.press('Meta+k');
  const settings = page.getByRole('group', { name: 'Settings' });
  await expect(settings.getByRole('option')).toHaveText([/single-key shortcuts/]);
  await expect(page.getByRole('option', { name: /theme/i })).toHaveCount(0);
});

// R-067: the system setting picks the theme; light is paper and near-black ink, dark is charcoal, and the terminal is dark in both.
for (const [scheme, ground, ink] of [
  ['light', 'rgb(250, 251, 252)', 'rgb(13, 18, 24)'],
  ['dark', 'rgb(11, 15, 20)', 'rgb(238, 243, 248)'],
] as const) {
  test(`The ${scheme} system setting gives the ${scheme} theme on the board, a task and the Factory, with no theme control`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    for (const path of ['/', '/t/T-0042', '/factory']) {
      await page.goto(path);
      await expect(page.getByTestId('palette-button')).toBeVisible();
      const look = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme }));
      expect(look, path).toEqual({ bg: ground, ink, scheme });
    }
    await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0);
    const term = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--term').trim());
    expect(term).toBe('#080c11');
    await context.close();
  });
}
