import { expect, test } from '@playwright/test';

test.describe('at 1440 by 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('The runs list ends where the approval box starts, and the first run reads whole above it', async ({ page }) => {
    await page.goto('/t/T-0042');
    const first = page.locator('[data-testid="run-segment"][data-run="r1"]');
    await expect(first).toBeVisible();
    const runs = await page.getByTestId('rail-scroller').boundingBox();
    const gate = await page.getByTestId('gate-column').boundingBox();
    const head = await first.boundingBox();
    if (!runs || !gate || !head) throw new Error('the runs, the gate and the first run must all be on screen');
    expect(runs.y + runs.height).toBeLessThanOrEqual(gate.y + 0.5);
    expect(head.y + head.height).toBeLessThanOrEqual(runs.y + runs.height);
    // what is drawn at the first run's last line is the run itself, not the box
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), { x: head.x + 24, y: head.y + head.height - 4 });
    expect(hit).toBe('run-segment');
  });
});

test.describe('at 390 by 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('The gate and the tabs come before the run history', async ({ page }) => {
    await page.goto('/t/T-0043');
    const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.y ?? Number.NaN;
    const gate = await top('approval-gate');
    const tabs = (await page.getByRole('tablist', { name: 'Work area' }).boundingBox())?.y ?? Number.NaN;
    const runs = await top('rail-column');
    expect(gate).toBeLessThan(tabs);
    expect(tabs).toBeLessThan(runs);
  });
});
