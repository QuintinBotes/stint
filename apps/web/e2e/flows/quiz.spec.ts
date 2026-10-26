import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('Check this packet on the Packet tab runs the quiz and shows its score and misses', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: quiz a packet');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));
  await page.goto(`/t/${t.id}?tab=packet`);
  await page.getByRole('button', { name: 'Check this packet' }).click();
  await expect(page.getByTestId('quiz-score')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('quiz')).toContainText(/\d/);
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.quizzed'));
});
