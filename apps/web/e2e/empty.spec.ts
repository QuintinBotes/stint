import { expect, test } from '@playwright/test';

test('Every panel in an empty task shows its empty-state sentence', async ({ page, request }) => {
  await page.goto('/');
  const token = await page.locator('meta[name="stint-token"]').getAttribute('content');
  const res = await request.post('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'An empty task', goal: 'Nothing has happened yet.', acceptance: ['the panels say what will appear'] },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/t/${id}`);
  await expect(page.getByTestId('memory-panel').getByTestId('empty-memory')).toBeVisible();
  const expected: Record<string, string> = {
    diff: 'The diff appears here once a run commits to the task branch.',
    terminal: 'No worktree to open a shell in.',
    plan: 'The plan arrives here when the planner finishes.',
    packet: 'The packet appears here when a run ends, however it ends.',
    review: 'The review appears here after a green verification.',
    verification: 'Verification runs here when the run ends.',
  };
  for (const [tab, sentence] of Object.entries(expected)) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByRole('tabpanel')).toContainText(sentence);
  }
});
