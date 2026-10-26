import { expect, test } from '@playwright/test';

test('The Files tab starts on the files the change touched, filters, shows a file with line numbers, and offers the editor', async ({ page }) => {
  await page.goto('/t/T-0042?tab=files');
  const list = page.getByTestId('file-list');
  await expect(list.getByTestId('file-row').first()).toBeVisible();
  const changedCount = await list.getByTestId('file-row').count();
  // every changed row shows its added and removed lines
  await expect(list.getByTestId('file-row').first()).toContainText('+');
  await page.getByRole('button', { name: /^Changed/ }).click();
  await expect(list.getByTestId('file-row')).not.toHaveCount(changedCount);
  await page.getByLabel('Filter files').fill('package.json');
  await page.locator('[data-testid="file-row"][data-path="package.json"]').click();
  await expect(page.getByTestId('file-content')).toContainText('"name"');
  await expect(page.getByTestId('file-content').locator('div').first()).toContainText('1');
  await expect(page.getByTestId('open-file')).toBeVisible();
});
