import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('T-0043 at the gate shows How it went above Approve, a state in words per criterion, and the loops line', async ({ page }) => {
  await page.goto('/t/T-0043');
  const gate = page.getByTestId('approval-gate');
  const block = gate.getByTestId('how-it-went');
  // the criteria fold under one line so Approve stays in view; none fails or waits for you here
  const summary = block.getByText('How it went: 0 of 2 criteria proven');
  await expect(summary).toBeVisible();
  await expect(block.getByRole('table', { name: 'Criteria' })).toBeHidden();
  await summary.click();
  await expect(block.getByRole('table', { name: 'Criteria' })).toBeVisible();
  const rows = block.getByTestId('outcome-criterion');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-state', 'passing');
    // passing is not proven, so its words say so and its ink is plain
    await expect(row.getByRole('cell')).toHaveText('Passes, but no test showed it failing first');
    await expect(row.getByRole('cell')).toHaveClass(/text-ink(?!-)/);
  }
  await expect(block.getByTestId('outcome-line')).toHaveText(/^1 build, 0 hand-offs, (under 1|\d+) s to green\.$/);
  await block.getByText('What is a proof?').click();
  await expect(block.getByText('a test that failed before the change and passes after')).toBeVisible();
  const above = await block.boundingBox();
  const approve = await gate.getByTestId('approve').boundingBox();
  expect((above?.y ?? 0) + (above?.height ?? 0)).toBeLessThanOrEqual(approve?.y ?? 0);
  // the gate's own evidence line is still there
  await expect(gate.getByTestId('gate-evidence')).toContainText('36 tests passed, run by Stint');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const found = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(found, found.join('\n')).toEqual([]);
});

test('T-0042 after merge shows How it went under the title block, with the after-merge rows and the window it watches', async ({ page }) => {
  await page.goto('/t/T-0042');
  const block = page.getByTestId('task-view').getByTestId('how-it-went');
  // one line under the title block: the result, the criteria tally and the window it watches
  const summary = block.getByText('How it went: Merged.');
  await expect(summary).toBeVisible();
  await expect(block.getByTestId('outcome-watching')).toHaveText(/^ ?Watching for reverts and follow-ups until .+\d{4}\.$/);
  await summary.click();
  await expect(block.getByTestId('outcome-criterion')).toHaveCount(3);
  // r3 started from r2's packet: one hand-off, as the meter and the runs list say
  await expect(block.getByTestId('outcome-line')).toHaveText(/^2 builds, 1 hand-off, (under 1|\d+) s to green\.$/);
  const after = block.getByTestId('outcome-after-merge');
  for (const [row, value] of [['Reverted', 'No'], ['Follow-ups', 'None'], ['CI', 'No failure recorded'], ['Incidents', 'None']]) {
    await expect(after.getByRole('row', { name: new RegExp(`^${row} `) })).toContainText(value as string);
  }
  // under the title block, and the gate in the rail does not repeat it for a merged task
  const header = await page.getByTestId('task-header').boundingBox();
  expect((await block.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0) - 1);
  await expect(page.getByTestId('approval-gate').getByTestId('how-it-went')).toHaveCount(0);
});
