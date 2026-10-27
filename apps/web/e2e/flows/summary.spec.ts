import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('A board card shows the model summary from the local model server', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: card summary');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'agent.message'));

  await page.goto('/');
  const card = page.locator(`[data-task="${t.id}"]`);
  const summary = card.getByTestId('card-summary');
  // the fake model server answers unknown schemas with this line, as the summary route asks it
  await expect(summary).toContainText('The run wrote one file for its task.', { timeout: 20_000 });
  await expect(summary).toHaveAttribute('data-source', 'model');
});
