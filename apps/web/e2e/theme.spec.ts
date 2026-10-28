import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const theme = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.dataset.theme);
const ground = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('Pit wall is the default; the header button cycles to the timing sheet and stage, and the choice is remembered', async ({ page }) => {
  await page.goto('/');
  const button = page.getByTestId('theme-button');
  expect(await theme(page)).toBe('pitwall');
  await expect(button).toHaveText('Theme: Pit wall');
  expect(await ground(page)).toBe('rgb(23, 25, 28)');

  await button.click();
  expect(await theme(page)).toBe('sheet');
  await expect(button).toHaveText('Theme: Timing sheet');
  expect(await ground(page)).toBe('rgb(255, 255, 255)');

  // remembered in this browser across a reload
  await page.reload();
  expect(await theme(page)).toBe('sheet');
  await expect(page.getByTestId('theme-button')).toHaveText('Theme: Timing sheet');

  await page.getByTestId('theme-button').click();
  expect(await theme(page)).toBe('stage');
  await page.getByTestId('theme-button').click();
  expect(await theme(page)).toBe('pitwall');
  expect(await page.evaluate(() => localStorage.getItem('stint.theme'))).toBe('pitwall');
});

test('The palette switches the theme too, and the header button follows it', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Type a command or a task').fill('stage theme');
  await page.keyboard.press('Enter');
  expect(await theme(page)).toBe('stage');
  await expect(page.getByTestId('theme-button')).toHaveText('Theme: Stage');
});

// the opt-in themes keep the tokens' contrast: the board and the task view under each, against WCAG 2.2 A and AA
for (const name of ['sheet', 'stage'] as const) {
  for (const path of ['/', '/t/T-0042']) {
    test(`The ${name} theme has no WCAG A or AA violations on ${path}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('stint.theme', t), name);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await theme(page)).toBe(name);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const found = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}
