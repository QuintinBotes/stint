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
    expect(['you', 'automatic once tests pass', 'you, and the agent asks first']).toContain((await tiers.nth(i).textContent())?.trim());
  }
});

test("The T-0042 rail runs to r4, and each run's axis takes its vendor's ink, beside the agent's name", async ({ page }) => {
  await page.goto('/t/T-0042');
  const segments = page.getByTestId('run-segment');
  await expect(segments).toHaveCount(4);
  await expect(segments.nth(3)).toHaveAttribute('data-run', 'r4');
  await expect(segments.nth(3)).toHaveAttribute('data-adapter', 'openai-compatible');
  // r1 to r3 ran Meta's models on Meta's hosts and the local CLI, so they take Meta's ink (--meta);
  // r4 is Glimmer served by Ollama on this machine, which takes the local ink (--local)
  const ink = ['rgb(143, 202, 255)', 'rgb(143, 202, 255)', 'rgb(143, 202, 255)', 'rgb(211, 220, 229)'];
  for (let i = 0; i < 4; i++) {
    const colours = await segments.nth(i).evaluate((header) => {
      const mark = header.querySelector('span[aria-hidden="true"]');
      const axis = header.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
      return {
        mark: mark ? getComputedStyle(mark).backgroundColor : null,
        axis: axis ? getComputedStyle(axis).backgroundColor : null,
        name: mark?.nextElementSibling?.textContent ?? '',
      };
    });
    expect(colours.mark).toBe(ink[i]);
    expect(colours.axis).toBe(colours.mark);
    // the ink is never alone: the agent's name sits beside it
    expect(colours.name.length).toBeGreaterThan(0);
  }
});

test("Restore on a checkpoint opens that run's code in a worktree of its own; the conversation waits for a later release", async ({ page }) => {
  await page.goto('/t/T-0042');
  const cp = page.locator('[data-testid="checkpoint"][data-run="r3"]');
  await cp.getByRole('button', { name: 'Restore' }).click();
  // only the code can be restored today; the conversation is not offered, and the panel says why
  await expect(cp.getByRole('button', { name: 'Conversation' })).toHaveCount(0);
  await expect(cp.getByRole('button', { name: 'Both' })).toHaveCount(0);
  await expect(cp).toContainText('Restoring the conversation comes in a later release');
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
