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

test('Each T-0042 rail segment shows a permission tier chip', async ({ page }) => {
  await page.goto('/t/T-0042');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  const tiers = page.getByTestId('permission-tier');
  await expect(tiers).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(segments.nth(i).getByTestId('permission-tier')).toHaveCount(1);
    expect(['manual', 'auto, verified', 'never bypass']).toContain((await tiers.nth(i).textContent())?.trim());
  }
});

test("The T-0042 rail runs to r4, and each segment's spine takes its agent's vendor colour", async ({ page }) => {
  await page.goto('/t/T-0042');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  await expect(segments.nth(3)).toHaveAttribute('data-run', 'r4');
  await expect(segments.nth(3)).toHaveAttribute('data-adapter', 'openai-compatible');
  // every run on this task is a Meta model, so every mark and spine takes the Meta vendor colour
  for (let i = 0; i < 4; i++) {
    const colours = await segments.nth(i).evaluate((header) => {
      const mark = header.querySelector('span[aria-hidden="true"]');
      const spine = header.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
      return {
        mark: mark ? getComputedStyle(mark).backgroundColor : null,
        spine: spine ? getComputedStyle(spine).backgroundColor : null,
      };
    });
    expect(colours.mark).toBe('rgb(250, 204, 21)');
    expect(colours.spine).toBe(colours.mark);
  }
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
