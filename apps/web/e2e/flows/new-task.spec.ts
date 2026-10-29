import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('Pressing n opens the new task dialog; creating a task opens it, puts it in Planned, and the daemon has it as typed', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Flow: add a health endpoint');
  await dialog.getByLabel('Goal').fill('GET /health answers 200.');
  await dialog.getByLabel('How you will know it is done, one check per line').fill('GET /health answers 200\nThe body says ok');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/t\/T-\d+/);
  const id = /\/t\/(T-\d+)/.exec(page.url())?.[1] as string;
  await expect(page.getByTestId('task-view')).toContainText('Flow: add a health endpoint');

  const task = await d.task(id);
  expect(task).toMatchObject({ title: 'Flow: add a health endpoint', status: 'planned', acceptance: ['GET /health answers 200', 'The body says ok'] });
  await page.goto('/');
  await expect(page.getByTestId('lane-planned').locator(`[data-task="${id}"]`)).toBeVisible();
});

test('A task created with an issue URL shows it as a link in the task header', async ({ page, request }) => {
  const d = daemon(request);
  const issueUrl = 'https://example.invalid/acme/api/issues/42';
  const t = await d.post<{ id: string }>('/api/tasks', {
    title: 'Flow: a task from an issue',
    goal: 'The header links back to the issue.',
    acceptance: ['the issue link is in the header'],
    links: { issueUrl },
  });
  await page.goto(`/t/${t.id}`);
  const link = page.getByTestId('task-header').getByTestId('issue-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', issueUrl);
  // nothing is built yet, so there is nothing to send back or reject
  await expect(page.getByRole('button', { name: 'Request changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled();
});

test('A double press on Create task makes one task; the button says it is working while the daemon answers', async ({ page, request }) => {
  const d = daemon(request);
  // the create call is held until the second press has landed, so both presses fall inside one request
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.fallback();
  });
  const title = `Flow: pressed twice ${Date.now()}`;
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByLabel('Goal').fill('One task, however many presses.');
  await dialog.getByLabel('How you will know it is done, one check per line').fill('there is one task');
  await dialog.getByRole('button', { name: 'Create task' }).dblclick();
  const working = dialog.getByRole('button', { name: 'Creating task' });
  await expect(working).toHaveAttribute('aria-disabled', 'true');
  await working.click({ force: true });
  release();
  await expect(page).toHaveURL(/\/t\/T-\d+/);
  const { tasks } = await d.get<{ tasks: Array<{ task: { title: string } }> }>('/api/tasks');
  expect(tasks.filter((c) => c.task.title === title)).toHaveLength(1);
});
