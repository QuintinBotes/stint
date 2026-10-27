import { expect, test } from '@playwright/test';

test('The T-0042 verification card shows the passed count and who ran it, and the packet card highlights the ask of next with its token count', async ({ page }) => {
  await page.goto('/t/T-0042?tab=verification');
  const card = page.getByTestId('verification-card');
  await expect(card.getByTestId('verification-summary')).toContainText('33 passed');
  await expect(card.getByTestId('verification-summary')).toContainText('run by the daemon');

  await page.goto('/t/T-0042?tab=packet');
  // the killed run's packet is h1; the recording counted it at 412 tokens and the header agrees
  await page.getByRole('button', { name: 'h1', exact: true }).click();
  await expect(page.getByTestId('packet-size')).toContainText('412 tokens');
  await expect(page.getByTestId('ask-of-next')).toBeVisible();
  await expect(page.getByTestId('ask-of-next')).toContainText('Check the unknown step first');
});

test('The packet card shows the raw packet as a tree that folds', async ({ page }) => {
  await page.goto('/t/T-0042?tab=packet');
  await page.getByRole('tab', { name: 'Raw JSON' }).or(page.getByRole('button', { name: 'Raw JSON' })).first().click();
  const tree = page.getByTestId('packet-json');
  await expect(tree).toContainText('askOfNext');
  await expect(tree.getByRole('button').first()).toBeVisible();
});
