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

  // each agent in the picker carries its vendor, its roles, a capability note and its gate strength (R-051)
  const health = (await (await request.get('/api/health')).json()) as { adapters: Array<{ id: string; vendor: string; roles: string[] }> };
  const rows = picker.getByTestId('hand-agent');
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    const agentId = await row.getAttribute('data-agent');
    const fromHealth = health.adapters.find((a) => a.id === agentId);
    expect(fromHealth, `health lists ${agentId}`).toBeTruthy();
    // the vendor as people write it: OpenAI, not Openai
    const vendor = (fromHealth as { vendor: string }).vendor;
    const names: Record<string, string> = { meta: 'Meta', anthropic: 'Anthropic', openai: 'OpenAI', local: 'Local', other: 'Other' };
    await expect(row.getByTestId('hand-vendor')).toHaveText(names[vendor] ?? `${vendor.charAt(0).toUpperCase()}${vendor.slice(1)}`);
    await expect(row.getByTestId('hand-roles')).toContainText('builds');
    const note = row.getByTestId('capability-note');
    await expect(note).toContainText('resume');
    await expect(note).toContainText('structured output');
    await expect(note).toContainText('sandbox');
    await expect(note).toContainText('cost');
    await expect(row.getByTestId('hand-gate')).toContainText(/Stint (checks|watches|does not check)|Turned off/);
  }
});
