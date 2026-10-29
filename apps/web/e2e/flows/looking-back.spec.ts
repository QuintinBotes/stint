import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

type Task = { id: string };

test('Looking back at a task at the gate holds Approve, the a, r and x keys and the palette gate events until Return to latest, which gives them back', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: looking back at the gate');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  const events = (await d.until(t.id, (ev) => ev.some((e) => e.type === 'approval.requested'))) as Array<{ type: string; ts: string; seq?: number }>;
  const green = events.find((e) => e.type === 'verification.ran') as { ts: string; seq?: number };

  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/tasks\/[^/]+\/(approve|reject|request-changes|changes|autopilot)/.test(r.url())) writes.push(r.url());
  });
  await page.goto(`/t/${t.id}?asOf=${encodeURIComponent(green.ts)}&at=${green.seq}`);

  // the notice at the top says what the page shows, and the header offers only the way back
  const notice = page.getByTestId('rewound');
  await expect(notice).toContainText(`You are looking at ${t.id} as it was at`);
  await expect(page.getByTestId('header-approve')).toHaveCount(0);
  const approve = page.getByTestId('approve');
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAttribute('aria-describedby', 'looking-back');
  for (const id of ['ask-changes', 'ask-reject', 'autopilot-switch']) await expect(page.getByTestId(id), id).toBeDisabled();

  // a click, the keys and the palette's requests all do nothing
  await approve.click({ force: true });
  await page.getByTestId('approval-gate').locator('caption').click();
  for (const key of ['a', 'r', 'x']) await page.keyboard.press(key);
  for (const want of ['approve', 'changes', 'reject']) await page.evaluate((detail) => window.dispatchEvent(new CustomEvent('stint:gate', { detail })), want);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('approve-armed')).toHaveCount(0);
  await expect(page.locator('#gate-text')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect((await d.task(t.id)).status).toBe('awaiting_approval');

  await page.getByTestId('return-latest').click();
  await expect(page).not.toHaveURL(/asOf=|at=/);
  await expect(notice).toHaveCount(0);
  await expect(approve).toBeEnabled();
  await expect(page.getByTestId('header-approve')).toBeVisible();
  // a gets Approve ready again, and so does the palette's request; Escape stands it down without a merge
  await page.getByTestId('approval-gate').locator('caption').click();
  await page.keyboard.press('a');
  await expect(page.getByTestId('approve-armed')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('approve-armed')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('stint:gate', { detail: 'changes' })));
  await expect(page.locator('#gate-text')).toBeVisible();
  expect(writes).toEqual([]);
});

test('Approve and merge in the header gets the gate ready beside its evidence, and a double press merges once', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.post<Task>('/api/tasks', { title: 'Flow: approve from the header', goal: 'Merge once.', acceptance: ['the task file exists'] });
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'approval.requested'));
  let approves = 0;
  page.on('request', (r) => {
    if (r.url().includes(`/api/tasks/${t.id}/approve`) && r.method() === 'POST') approves++;
  });
  await page.goto(`/t/${t.id}`);
  await page.getByTestId('header-approve').click();
  await expect(page.getByTestId('approve-armed')).toContainText('Press a again');
  await expect(page.getByTestId('approve')).toBeFocused();
  expect(approves).toBe(0);
  await page.getByTestId('approve').dblclick();
  await expect.poll(async () => (await d.task(t.id)).status).toBe('done');
  expect(approves).toBe(1);
});
