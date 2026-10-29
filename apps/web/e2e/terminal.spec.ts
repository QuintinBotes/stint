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

test('The terminal fills its pane, with the kill button visible while its run is live', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post('/api/tasks', { headers, data: { title: 'A task whose run looks live', goal: 'Fill the pane.', acceptance: ['the terminal fills its pane'] } });
  const { id } = (await created.json()) as { id: string };
  expect((await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } })).status()).toBe(202);
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}`)).json()) as { runs: Array<{ endedAt: string | null }> }).runs[0]?.endedAt ?? null).not.toBeNull();

  // the replay run ends at once, so the bundle the page reads keeps it live: the worktree and its shell are real
  await page.route(`**/api/tasks/${id}`, async (route) => {
    const res = await route.fetch();
    const bundle = (await res.json()) as { runs: Array<Record<string, unknown>> };
    if (bundle.runs[0]) bundle.runs[0].endedAt = null;
    await route.fulfill({ response: res, json: bundle });
  });
  await page.goto(`/t/${id}?tab=terminal`);
  await expect(page.getByTestId('kill-run')).toBeVisible();
  await expect(page.getByTestId('kill-run')).toContainText('Kill run');
  await expect(page.getByTestId('kill-run')).toHaveAttribute('title', 'Kill r1');
  await expect(page.getByTestId('terminal-cwd')).toContainText(`.stint/worktrees/${id}-r1`);
  await expect
    .poll(async () => {
      const pane = await page.getByTestId('terminal').boundingBox();
      const term = await page.locator('.xterm').boundingBox();
      if (!pane || !term) return 0;
      // the shell takes the pane's width and most of its height, not a fixed small box in a corner
      return term.width >= pane.width - 24 && term.height >= 300 ? 1 : 0;
    })
    .toBe(1);
  // the page polls the bundle; a poll still in the handler when the test ends would read a disposed response
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Copy the cd command says so when the browser refuses the clipboard', async ({ page, request }) => {
  await page.goto('/');
  const token = (await page.locator('meta[name="stint-token"]').getAttribute('content')) as string;
  const headers = { Authorization: `Bearer ${token}` };
  const { id } = (await (await request.post('/api/tasks', { headers, data: { title: 'A task whose cd is not copied', goal: 'Refuse the clipboard.', acceptance: ['the refusal is said'] } })).json()) as { id: string };
  expect((await request.post(`/api/tasks/${id}/assign`, { headers, data: { adapter: 'replay', role: 'implementer' } })).status()).toBe(202);
  await expect.poll(async () => ((await (await request.get(`/api/tasks/${id}`)).json()) as { runs: Array<{ endedAt: string | null }> }).runs[0]?.endedAt ?? null).not.toBeNull();
  await page.goto(`/t/${id}?tab=terminal`);
  await expect(page.getByTestId('terminal-cwd')).toContainText(`.stint/worktrees/${id}-r1`);
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
  });
  await page.getByRole('button', { name: 'Copy the cd command' }).click();
  await expect(page.getByTestId('copy-refused')).toHaveText('The browser did not allow copying. Select the path and copy it by hand.');
});
