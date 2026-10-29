import { expect, test } from '@playwright/test';

test('The Skills page lists the learned skill with its evidence and the hand-written one with its origin', async ({ page }) => {
  await page.goto('/skills');
  const learned = page.locator('[data-skill="limiter-config-via-env"]');
  await expect(learned).toContainText('learned from a task');
  await expect(learned).toContainText('T-0042/r4#F1');
  await expect(learned.getByRole('link', { name: 'A finding in the review of T-0042' })).toHaveAttribute('href', '/t/T-0042?tab=review');
  await expect(learned).toContainText('used in 1 run');
  // the list names both; picking the hand-written one shows its record beside the list
  await expect(page.locator('[data-list-skill="review-voice-policy"]')).toContainText('written by you');
  await page.locator('[data-list-skill="review-voice-policy"]').getByRole('button').click();
  await expect(page.locator('[data-skill="review-voice-policy"]')).toContainText('written by you');
});

test('The Skills page shows the track record (applied, helped, hurt) on the learned skill', async ({ page }) => {
  await page.goto('/skills');
  const learned = page.locator('[data-skill="limiter-config-via-env"]');
  await expect(learned.getByTestId('skill-track')).toContainText('used in 1 run, helped 0 tasks, hurt 0 tasks');
  await expect(page.getByTestId('skills')).toContainText('starts on trial');
});

test('Add skill says what its disabled button waits for, and its tabs follow the arrow, Home and End keys', async ({ page }) => {
  await page.goto('/skills');
  await page.getByTestId('add-skill').click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await expect(dialog.getByTestId('add-skill-submit')).toBeDisabled();
  await expect(dialog.getByTestId('add-skill-submit')).toHaveAccessibleDescription('Choose a file or folder first.');
  const upload = dialog.getByRole('tab', { name: 'Upload' });
  await expect(upload).toBeFocused();
  await page.keyboard.press('End');
  await expect(dialog.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByTestId('add-skill-submit')).toHaveAccessibleDescription('Fill in the name and the description first.');
  await page.keyboard.press('ArrowRight');
  await expect(upload).toBeFocused();
  await expect(upload).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-skill')).toBeFocused();
});

test('A filter that matches no skill says so and offers every skill back, apart from the empty state of a workspace with none', async ({ page }) => {
  await page.goto('/skills?origin=import');
  await expect(page.getByTestId('skills-filter-empty')).toHaveText('No skill matches these filters.');
  await expect(page.getByTestId('skill-list-row')).toHaveCount(0);
  await expect(page.getByTestId('skills-empty')).toHaveCount(0);
  await expect(page.getByTestId('filter-origin')).toHaveValue('import');
  await page.getByTestId('clear-skill-filters').click();
  await expect(page.locator('[data-list-skill="limiter-config-via-env"]')).toBeVisible();
  await expect(page.getByTestId('skills-filter-empty')).toHaveCount(0);
  await expect(page.getByTestId('filter-origin')).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('origin')).toBe(false);
});

test('Skills that fail to load say so with a retry, never that there are no skills', async ({ page }) => {
  await page.route('**/api/skills', (r) => r.fulfill({ status: 500, json: { error: { code: 'internal', message: 'the skills folder could not be read' } } }));
  await page.goto('/skills');
  await expect(page.getByTestId('skills-error')).toHaveText(/^The skills did not load: the skills folder could not be read\./);
  await expect(page.getByTestId('skills-empty')).toHaveCount(0);
  await page.unroute('**/api/skills');
  await page.getByTestId('skills-error').getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-list-skill="limiter-config-via-env"]')).toBeVisible();
  await expect(page.getByTestId('skills-error')).toHaveCount(0);
});

test('Add skill asks before a dismissal drops a chosen file or typed text, and an untouched dialog closes at once', async ({ page }) => {
  await page.goto('/skills');
  await page.getByTestId('add-skill').click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await dialog.getByTestId('skill-file').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: kept-draft\ndescription: Stays chosen.\n---\n\nBody.\n') });
  await expect(dialog.getByTestId('skill-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByTestId('dialog-discard')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByTestId('skill-preview')).toBeVisible();
  await dialog.getByTestId('dialog-close').click();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);

  // typed text on another tab counts too
  await page.getByTestId('add-skill').click();
  await dialog.getByRole('tab', { name: 'From git' }).click();
  await dialog.getByLabel('Repository URL').fill('https://example.com/acme/skills');
  await dialog.getByTestId('dialog-close').click();
  await expect(dialog.getByTestId('dialog-discard')).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByTestId('add-skill').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

// The recording carries no eval file and no retirement proposal, so the eval line and the
// Retire and Keep buttons cannot be shown against the replay server; the daemon and CLI
// tests cover them (packages/daemon/test/skills.track.test.ts, packages/cli/test/eval.skill.test.ts).
test.skip('The eval card and the retirement Retire and Keep buttons (needs live eval state the recording does not carry)', async () => {});
