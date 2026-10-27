import { expect, test } from '@playwright/test';

test('The T-0042 rail shows its four runs with their agents, the 412-token joint, and a checkpoint after each run that committed', async ({ page }) => {
  await page.goto('/t/T-0042');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  await expect(segments.nth(0)).toHaveAttribute('data-run', 'r1');
  await expect(segments.nth(1)).toHaveAttribute('data-adapter', 'muse-code');
  await expect(segments.nth(2)).toHaveAttribute('data-adapter', 'stint-agent');
  await expect(page.getByTestId('handoff-joint').first()).toContainText('412 tokens');
  // r2 and r3 changed files and ended on a commit; the planner and the reviewer did not
  await expect(page.getByTestId('checkpoint')).toHaveCount(2);
  await expect(page.locator('[data-testid="checkpoint"][data-run="r2"]')).toContainText('Checkpoint after r2');
});

test("Restore on a checkpoint opens that run's code in a worktree of its own; the conversation waits for a later release", async ({ page }) => {
  await page.goto('/t/T-0042');
  const cp = page.locator('[data-testid="checkpoint"][data-run="r3"]');
  await cp.getByRole('button', { name: 'Restore' }).click();
  await expect(cp.getByRole('button', { name: 'Conversation' })).toBeDisabled();
  await expect(cp.getByRole('button', { name: 'Both' })).toBeDisabled();
  await cp.getByRole('button', { name: 'Code' }).click();
  await expect(cp.getByTestId('checkpoint-restored')).toContainText('.stint/worktrees/T-0042-r3-checkpoint');
});

test('Selecting a row and pressing Enter expands it to the full event; Enter again folds it', async ({ page }) => {
  await page.goto('/t/T-0042');
  const row = page.locator('[data-testid="event-row"][data-type="decision.recorded"]').first();
  await row.click();
  await expect(page).toHaveURL(/ev=\d+/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('event-detail')).toContainText('"text"');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('event-detail')).toHaveCount(0);
});
