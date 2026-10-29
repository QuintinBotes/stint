import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('Killing a run from the Terminal tab leaves a packet with the step in flight; handing it to the Stint agent continues from that packet to green', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: kill and hand');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'sleeper', role: 'implementer' });
  await page.goto(`/t/${t.id}?tab=terminal`);
  await page.getByTestId('kill-run').click();
  const killed = await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));
  expect(killed.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('killed');
  const packet = String(killed.find((e) => e.type === 'handoff.created')?.payload.name);

  await page.goto(`/t/${t.id}?tab=packet`);
  await expect(page.getByTestId('handoff-card')).toContainText(`src/lib/${t.id}.ts`);
  const hand = page.getByTestId('hand-to');
  await hand.locator('input[value="stint-agent"]').check();
  await hand.getByTestId('hand-button').click();

  const after = await d.until(t.id, (ev) => ev.filter((e) => e.type === 'verification.ran').length >= 2);
  // the green hand-off is reviewed after it; the second build is the last implementer run
  const second = after.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').at(-1);
  expect(second?.adapter).toBe('stint-agent');
  // handing off writes the packet addressed to the next agent, after the one the kill left
  const packets = after.filter((e) => e.type === 'handoff.created');
  expect(String(packets[0]?.payload.name)).toBe(packet);
  const handed = packets.filter((e) => e.ts <= String(second?.ts)).at(-1);
  expect(handed?.payload.name).not.toBe(packet);
  expect(second?.payload.handoffFrom).toBe(handed?.payload.name);
  expect(after.filter((e) => e.type === 'verification.ran').at(-1)?.payload.status).toBe('green');
  await page.goto(`/t/${t.id}?tab=verification`);
  await expect(page.getByTestId('verification-summary')).toBeVisible();
});

test('In the Terminal tab the kill button reads Kill run and Command-period kills the live run', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: kill from the keyboard');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'sleeper', role: 'implementer' });
  await page.goto(`/t/${t.id}?tab=terminal`);
  await expect(page.getByTestId('kill-run')).toContainText('Kill run');
  await page.locator('.xterm').click();
  await page.keyboard.press('Meta+Period');
  const events = await d.until(t.id, (ev) => ev.some((e) => e.type === 'run.finished'));
  expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('killed');
});
