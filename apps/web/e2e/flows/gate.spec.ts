import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

type Task = { id: string };

test('The approval gate stays shut while the verification is absent or red', async ({ page, request }) => {
  const d = daemon(request);
  const fresh = await d.create('Flow: gate with nothing verified yet');
  await page.goto(`/t/${fresh.id}`);
  await expect(page.getByTestId('approval-gate')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('approve')).toBeDisabled();

  const red = await d.post<Task>('/api/tasks', { title: 'Flow: gate with red tests', goal: 'Fail the daemon tests.', acceptance: ['the gate stays shut'], testCommand: 'false' });
  await d.post(`/api/tasks/${red.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(red.id, (ev) => ev.some((e) => e.type === 'verification.ran' && e.payload.status === 'red'));
  await page.goto(`/t/${red.id}`);
  await expect(page.getByTestId('approval-gate')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('approve')).toBeDisabled();
});

test('A run assigned by hand that goes green is reviewed by the reviewer chain and reaches the gate with autopilot off; then it opens and pressing a calls approve', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: gate opens on green');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  const events = await d.until(t.id, (ev) => ev.some((e) => e.type === 'approval.requested'));
  expect(events.filter((e) => e.type === 'run.started').map((e) => e.payload.role)).toEqual(['implementer', 'reviewer']);
  expect(events.some((e) => e.type.startsWith('autopilot.'))).toBe(false);
  expect((await d.task(t.id)).status).toBe('awaiting_approval');
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('approval-gate')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('gate-evidence')).toContainText('1 test passed, run by Stint; review: approve.');
  await expect(page.getByTestId('approve')).toBeEnabled();

  await page.getByTestId('approval-gate').locator('caption').click();
  let approves = 0;
  page.on('request', (r) => {
    if (r.url().includes(`/api/tasks/${t.id}/approve`) && r.method() === 'POST') approves++;
  });
  // one a never merges: it gets Approve ready, focused, and says what a second press does
  await page.keyboard.press('a');
  await expect(page.getByTestId('approve-armed')).toContainText('Press a again');
  await expect(page.getByTestId('approve')).toBeFocused();
  await page.waitForTimeout(300);
  expect(approves).toBe(0);
  const approveCall = page.waitForRequest((r) => r.url().includes(`/api/tasks/${t.id}/approve`) && r.method() === 'POST');
  await page.keyboard.press('a');
  await approveCall;
  await expect.poll(async () => (await d.task(t.id)).status).toBe('done');
});
