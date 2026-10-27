import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('The Hand to picker never recommends the leaving agent when another is ready, and shows the reason', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: hand to a different agent');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));

  await page.goto(`/t/${t.id}?tab=packet`);
  const picker = page.getByTestId('hand-to');
  await expect(page.getByTestId('hand-reason')).toContainText('a different agent from Muse Code');
  await expect(picker.getByText('recommended', { exact: true })).toBeVisible();
  const chosen = picker.locator('input[name="hand-to"]:checked');
  await expect(chosen).toHaveCount(1);
  expect(await chosen.getAttribute('value')).not.toBe('muse-code');
  await expect(page.getByTestId('hand-button')).toBeEnabled();
});
