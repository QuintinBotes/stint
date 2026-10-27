import { expect, test } from '@playwright/test';

// R-049: the replay says what the factory does, in the words the video uses.
test('The T-0042 verification card says the locked tests are unchanged', async ({ page }) => {
  await page.goto('/t/T-0042?tab=verification');
  await expect(page.getByTestId('verification-summary')).toContainText('33 passed, tests unchanged');
  await expect(page.getByTestId('verification-tab')).toContainText('test/webhooks.test.ts');
});

// the numbers are a live eval of 27 October: one Muse Code run on T-0042 with the skill mounted, one without
test('The learned skill shows its eval: with the skill and without', async ({ page }) => {
  await page.goto('/skills?skill=limiter-config-via-env');
  await expect(page.locator('[data-skill="limiter-config-via-env"]').getByTestId('skill-eval')).toContainText(/^with skill: \d+ findings, .*; without: \d+ findings/);
});

test('The demo closes on any harness, any model, one packet, over every configured harness and host', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Any harness, any model, one packet.' }).click();
  const panel = page.locator('#any-harness');
  await expect(panel).toBeVisible();
  for (const name of ['Muse Code', 'Stint agent', 'Claude Code', 'Codex']) await expect(panel).toContainText(name);
});
