import { expect, test } from '@playwright/test';

test('The Skills page lists the learned skill with its evidence and the hand-written one with its origin', async ({ page }) => {
  await page.goto('/skills');
  const learned = page.locator('[data-skill="limiter-config-via-env"]');
  await expect(learned).toContainText('learned from reviews');
  await expect(learned).toContainText('T-0042/r4#F1');
  await expect(learned).toContainText('applied in 1 run');
  await expect(page.locator('[data-skill="review-voice-policy"]')).toContainText('written by a person');
});

test('The Skills page shows the track record (applied, helped, hurt) on the learned skill', async ({ page }) => {
  await page.goto('/skills');
  const learned = page.locator('[data-skill="limiter-config-via-env"]');
  await expect(learned.getByTestId('skill-track')).toContainText('applied in 1 run, helped 0 tasks, hurt 0 tasks');
  await expect(page.getByTestId('skills')).toContainText('starts on probation');
});

// The recording carries no eval file and no retirement proposal, so the eval line and the
// Retire and Keep buttons cannot be shown against the replay server; the daemon and CLI
// tests cover them (packages/daemon/test/skills.track.test.ts, packages/cli/test/eval.skill.test.ts).
test.skip('The eval card and the retirement Retire and Keep buttons (needs live eval state the recording does not carry)', async () => {});
