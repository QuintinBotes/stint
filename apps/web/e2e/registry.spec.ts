import { expect, test } from '@playwright/test';

test('Health lists the turned off presets as disabled, and the Hand to picker marks them', async ({ page, request }) => {
  const health = (await (await request.get('/api/health')).json()) as {
    adapters: Array<{ id: string; harness?: string; enabled?: boolean; available?: boolean; roles: string[] }>;
  };
  for (const id of ['claude-code', 'codex', 'goose', 'opencode', 'gemini-cli', 'aider']) {
    const row = health.adapters.find((a) => a.id === id);
    expect(row, id).toBeDefined();
    expect(row?.enabled).toBe(false);
    expect(row?.roles).toContain('implementer');
  }
  expect(health.adapters.find((a) => a.id === 'claude-code')?.harness).toBe('claude-code');
  expect(health.adapters.find((a) => a.id === 'codex')?.harness).toBe('codex');

  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task for the registry', goal: 'Show the agents.', acceptance: ['disabled agents are marked'] } })).json()) as { id: string };
  await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } });
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}/handoffs`)).json()) as { names: string[] }).names.length).toBeGreaterThan(0);
  await page.goto(`/t/${id}?tab=packet`);
  const picker = page.getByTestId('hand-to');
  await expect(picker).toBeVisible();
  await expect(picker.getByText('disabled', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('hand-disabled').first()).toContainText('Turned off in config');
});
