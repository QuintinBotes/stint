import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { daemon, stopped } from './daemon';

// the toasts a stop raises are not this screen's and come and go, so they are left out
const axe = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('[data-sonner-toaster]').analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
const builds = (events: Array<{ type: string; payload: Record<string, unknown> }>) => events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').length;

test('A task made with Builds 1 stops at the build limit after a failing build; raising it to 2 inline puts autopilot back on and it takes the next build', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Flow: stop at the build limit');
  await dialog.getByLabel('Goal').fill('The build fails, and autopilot stops at one build.');
  await dialog.getByLabel('How you will know it is done, one check per line').fill('the tests pass');
  // a test command that always fails, so the one build is red
  await dialog.getByLabel('Command that runs the tests').fill('exit 1');
  await dialog.getByText('Limits', { exact: true }).click();
  await expect(dialog.getByLabel('Builds')).toHaveAttribute('placeholder', '8');
  await expect(dialog.getByLabel('Spend in dollars')).toHaveAttribute('placeholder', 'No limit');
  expect(await axe(page)).toEqual([]);
  await dialog.getByLabel('Builds').fill('1');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(page).toHaveURL(/\/t\/T-\d+/);
  const id = /\/t\/(T-\d+)/.exec(page.url())?.[1] as string;
  expect(((await d.task(id)) as unknown as { limits?: unknown }).limits).toEqual({ builds: 1 });
  await expect(page.getByTestId('meter-builds')).toContainText('Builds 0 of 1');

  await page.getByTestId('autopilot-switch').click();
  const first = await d.until(id, stopped);
  expect(builds(first)).toBe(1);
  expect(first.find((e) => e.type === 'limit.reached')?.payload).toEqual({ limit: 'builds', used: 1, cap: 1 });
  await expect(page.getByTestId('meter-builds')).toContainText('Builds 1 of 1, reached');
  const stop = page.getByTestId('limit-stop');
  await expect(stop).toContainText('Needs you: the build limit is reached (1 of 1).');
  await expect(stop.getByRole('button', { name: 'Hand to another agent' })).toBeVisible();
  await expect(stop.getByText('What is a limit?')).toBeVisible();
  // said once: the status line points at the stop instead of repeating it, and nothing claims a run is going
  await expect(page.getByTestId('autopilot-step')).toHaveText('Autopilot: stopped at a limit; it needs you.');
  await expect(page.getByText('A run is going on this task')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
  // on the board the stopped task needs you, whatever its status says
  await page.goto('/');
  await expect(page.getByTestId('lane-needs-you')).toContainText(id);
  await expect(page.getByTestId('lane-in-progress')).not.toContainText(id);
  await page.goto(`/t/${id}`);

  await stop.getByLabel('New build limit').fill('2');
  await stop.getByRole('button', { name: 'Raise the limit' }).click();
  const after = await d.until(id, (ev) => builds(ev) >= 2);
  expect(after.find((e) => e.type === 'limits.changed')).toMatchObject({ vendor: 'human', payload: { from: { builds: 1 }, to: { builds: 2 }, by: 'you' } });
  // the second build came from autopilot, switched on again after the change
  const changedAt = after.findIndex((e) => e.type === 'limits.changed');
  expect(after.slice(changedAt).map((e) => e.type)).toContain('autopilot.started');
  expect(after.slice(changedAt).some((e) => e.type === 'autopilot.step' && (e.payload.step === 'build' || e.payload.step === 'hand'))).toBe(true);
  // the fake build is quick, so it is at the new limit already
  await d.until(id, (ev) => ev.filter((e) => e.type === 'limit.reached').length === 2);
  await expect(page.getByTestId('meter-builds')).toContainText('Builds 2 of 2, reached');
  await expect(stop).toContainText('Needs you: the build limit is reached (2 of 2).');
  // the other way on: the hand-to control, on the packet tab
  await stop.getByRole('button', { name: 'Hand to another agent' }).click();
  await expect(page.getByTestId('tab-packet')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('hand-to')).toBeVisible();
  // the hand-to choices are a list inside a radio group, which axe checks with the panel open
  expect(await axe(page)).toEqual([]);
});
