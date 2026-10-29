import { expect, test } from '@playwright/test';

test('A review finding that would reverse a decision on the task is listed at the gate, and Approve holds with that reason until it is settled', async ({ page }) => {
  const contradiction = { id: 'contradiction-T-0043-F1', kind: 'contradiction', task: 'T-0043', run: 'r2', agent: 'glimmer', decision: { id: 'D1', text: 'Limits come from config.' }, finding: { id: 'F1', text: 'A hard-coded limit would be simpler.' }, at: '2026-10-29T10:04:00.000Z' };
  await page.route('**/api/graph/pending', (route) => route.fulfill({ json: [contradiction] }));
  await page.goto('/t/T-0043');
  const gate = page.getByTestId('approval-gate');
  await expect(gate.getByTestId('gate-contradictions')).toHaveText('F1 would reverse D1, "Limits come from config.": A hard-coded limit would be simpler.');
  await expect(gate.getByTestId('gate-evidence')).toContainText('1 review finding would reverse a decision. Keep D1 or supersede it, above the tabs, before you approve.');
  await expect(gate.getByTestId('approve')).toBeDisabled();
  // the header offers no Approve either, and the a key does not get it ready
  await expect(page.getByTestId('header-approve')).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(page.getByTestId('approve-armed')).toHaveCount(0);
  await expect(page.getByTestId('task-decisions')).toContainText('Keep D1');

  // settled elsewhere: the next read has nothing waiting and the gate opens
  await page.unroute('**/api/graph/pending');
  await page.route('**/api/graph/pending', (route) => route.fulfill({ json: [] }));
  await expect(gate.getByTestId('approve')).toBeEnabled({ timeout: 8000 });
  await expect(gate.getByTestId('gate-contradictions')).toHaveCount(0);
});

test('A red verification at the gate says what was red, never "0 failed"', async ({ page }) => {
  await page.route('**/api/tasks/T-0043', async (route) => {
    const res = await route.fetch();
    const bundle = (await res.json()) as { verification: Record<string, unknown> };
    bundle.verification = { ...bundle.verification, status: 'red', passed: 36, failed: 0, reason: 'scenarios', scenarios: { passed: 1, failed: 2, names: ['burst.test.ts', 'reset.test.ts', 'tenant.test.ts'] } };
    await route.fulfill({ response: res, json: bundle });
  });
  await page.goto('/t/T-0043');
  const gate = page.getByTestId('approval-gate');
  await expect(gate.getByTestId('gate-evidence')).toContainText("Stint's check is red. 2 held-out scenarios failed.");
  await expect(gate.getByTestId('gate-evidence')).not.toContainText('0 failed');
  await expect(gate.getByTestId('approve')).toBeDisabled();
});
