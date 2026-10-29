import { expect, test } from '@playwright/test';

test('New task asks before a dismissal drops what was typed: Discard this draft? with Keep editing first, and an empty form closes at once', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await page.keyboard.press('n');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press('n');
  await dialog.getByLabel('Title').fill('A draft worth keeping');
  await page.keyboard.press('Escape');
  const ask = dialog.getByTestId('dialog-discard');
  await expect(ask).toContainText('Discard this draft?');
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  // Escape on the question keeps editing, with the text as typed
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(dialog.getByLabel('Title')).toHaveValue('A draft worth keeping');
  // the visible Close asks too; Discard drops it
  await dialog.getByTestId('dialog-close').click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(dialog.getByLabel('Title')).toHaveValue('');
});

test('At 390 px the New task footer stays in reach with Limits open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByText('Limits', { exact: true }).click();
  const create = dialog.getByRole('button', { name: 'Create task' });
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
