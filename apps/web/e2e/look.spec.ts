import { expect, test } from '@playwright/test';

// One look, Blueprint: no theme control in the top bar or the palette, nothing set on <html>, and every screen on the Blueprint ground.
test('There is no theme control, and every screen sits on the Blueprint ground', async ({ page }) => {
  for (const path of ['/', '/t/T-0042', '/factory', '/skills']) {
    await page.goto(path);
    await expect(page.getByTestId('palette-button')).toBeVisible();
    await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), path).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), path).toBe('rgb(4, 48, 81)');
  }
  // the palette's Settings group holds the single-key switch and nothing about a theme
  await page.keyboard.press('Meta+k');
  const settings = page.getByRole('group', { name: 'Settings' });
  await expect(settings.getByRole('option')).toHaveText([/single-key shortcuts/]);
  await expect(page.getByRole('option', { name: /theme/i })).toHaveCount(0);
});
