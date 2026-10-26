import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('Pressing n opens the new task dialog; creating a task opens it, puts it in Planned, and the daemon has it as typed', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Flow: add a health endpoint');
  await dialog.getByLabel('Goal').fill('GET /health answers 200.');
  await dialog.getByLabel('Acceptance criteria, one per line').fill('GET /health answers 200\nThe body says ok');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/t\/T-\d+/);
  const id = /\/t\/(T-\d+)/.exec(page.url())?.[1] as string;
  await expect(page.getByTestId('task-view')).toContainText('Flow: add a health endpoint');

  const task = await d.task(id);
  expect(task).toMatchObject({ title: 'Flow: add a health endpoint', status: 'planned', acceptance: ['GET /health answers 200', 'The body says ok'] });
  await page.goto('/');
  await expect(page.getByTestId('lane-planned').locator(`[data-task="${id}"]`)).toBeVisible();
});
