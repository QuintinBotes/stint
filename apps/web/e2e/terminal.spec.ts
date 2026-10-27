import { expect, test } from '@playwright/test';

test('The Terminal tab opens a shell in the run worktree; a typed line runs there and is recorded as human.command', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post('/api/tasks', { headers, data: { title: 'A task with a worktree', goal: 'Open a shell.', acceptance: ['the shell runs in the worktree'] } });
  const { id } = (await created.json()) as { id: string };
  expect((await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } })).status()).toBe(202);
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}`)).json()) as { runs: Array<{ endedAt: string | null }> }).runs[0]?.endedAt ?? null).not.toBeNull();

  await page.goto(`/t/${id}?tab=terminal`);
  await expect(page.getByTestId('terminal-cwd')).toContainText(`.stint/worktrees/${id}-r1`);
  await page.locator('.xterm').click();
  await page.keyboard.type('echo stint-$((40+2))');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-accessibility-tree')).toContainText('stint-42');
  await expect
    .poll(async () => {
      const events = ((await (await request.get(`/api/tasks/${id}/events`)).json()) as { events: Array<{ type: string; payload: { command?: string } }> }).events;
      return events.find((e) => e.type === 'human.command')?.payload.command ?? null;
    })
    .toBe('echo stint-$((40+2))');
});
