import { expect, test } from '@playwright/test';

test('The Skills page lists the learned skill with its evidence and the hand-written one with its origin', async ({ page }) => {
  await page.goto('/skills');
  const learned = page.locator('[data-skill="limiter-config-via-env"]');
  await expect(learned).toContainText('learned from reviews');
  await expect(learned).toContainText('T-0042/r4#F1');
  await expect(learned).toContainText('applied in 1 run');
  await expect(page.locator('[data-skill="review-voice-policy"]')).toContainText('written by a person');
});
