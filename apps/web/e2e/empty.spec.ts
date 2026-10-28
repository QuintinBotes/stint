import { expect, test } from '@playwright/test';

test('Every panel in an empty task shows its empty-state sentence, and every card a planned chip beside it', async ({ page, request }) => {
  await page.goto('/');
  const token = await page.locator('meta[name="stint-token"]').getAttribute('content');
  const res = await request.post('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'An empty task', goal: 'Nothing has happened yet.', acceptance: ['the panels say what will appear'] },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/t/${id}?memory=open`);
  // memory is a column of the task view, beside the work
  await expect(page.getByTestId('memory-panel').getByTestId('empty-memory')).toBeVisible();
  const expected: Record<string, string> = {
    diff: 'The diff appears here once a run commits to the task branch.',
    terminal: 'No copy of the code to open a terminal in.',
    plan: 'The plan arrives here when the planner finishes.',
    packet: 'The packet appears here when a run ends, however it ends.',
    review: 'The review appears here after the tests pass.',
    verification: 'Verification runs here when the run ends.',
  };
  for (const [tab, sentence] of Object.entries(expected)) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByRole('tabpanel')).toContainText(sentence);
    // the plan, packet and review cards carry their state beside the sentence (R-051)
    if (tab === 'plan' || tab === 'packet' || tab === 'review') {
      const chip = page.getByRole('tabpanel').locator('[data-status="planned"]');
      await expect(chip).toBeVisible();
      await expect(chip).toHaveText('planned');
    }
  }
});

test('The Files tab and the run rail show their empty states in an empty task', async ({ page, request }) => {
  await page.goto('/');
  const token = await page.locator('meta[name="stint-token"]').getAttribute('content');
  const res = await request.post('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: 'Another empty task', goal: 'Nothing has happened yet either.', acceptance: ['the panels say what will appear'] },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/t/${id}?tab=files`);
  // no run has changed a file, and no file is picked yet
  await expect(page.getByTestId('file-none')).toContainText('Pick a file to read it here.');
  await page.getByLabel('Filter files').fill('no-such-file-zzz');
  await expect(page.getByTestId('files-empty')).toContainText('No file matches.');
  // the rail has the creation row and no runs yet
  const rail = page.getByTestId('rail-column');
  await expect(rail.getByTestId('run-segment')).toHaveCount(0);
  await expect(rail).toContainText('Task created');
});
