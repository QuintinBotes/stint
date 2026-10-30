import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('A new task with "Sharpen it first" shows its questions; one answered by keyboard collapses to its decision, and "Use these proofs" leads to the ready line', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/');
  await page.keyboard.press('n');
  // the spec builder opens first; the plain form is behind Write it yourself
  await page.getByTestId('builder-write').click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Flow: sharpen a health endpoint');
  await dialog.getByLabel('Goal').fill('GET /health answers 200.');
  await dialog.getByLabel('How you will know it is done, one check per line').fill('GET /health answers 200\nThe body says ok');
  await expect(dialog.getByLabel('Sharpen it first')).not.toBeChecked();
  await dialog.getByLabel('Sharpen it first').check();
  await dialog.getByRole('button', { name: 'Create task' }).click();
  // the round starts in the task view, and the address drops the flag that asked for it
  await expect(page).toHaveURL(/\/t\/T-\d+$/);
  const id = /\/t\/(T-\d+)/.exec(page.url())?.[1] as string;

  const card = page.getByTestId('sharpen-card-Q1');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Who may turn the new behaviour off once it ships?');
  await expect(card).toContainText('Needs your answer');
  await expect(card).toContainText('What Stint found:');
  await expect(card.getByRole('group', { name: /Who may turn the new behaviour off/ })).toBeVisible();
  await expect(page.getByTestId('sharpen-card-Q2')).toBeVisible();
  // the question the repository can answer was dropped in code
  await expect(page.getByText('Which file holds the change?')).toHaveCount(0);

  // Tab to the radio group, an arrow to the second option, then Enter on the button that names it
  for (let i = 0; i < 80 && !(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name === 'sharpen-Q1')); i++) await page.keyboard.press('Tab');
  await expect(card.getByRole('radio', { name: /Only an admin/ })).toBeFocused();
  await expect(card.getByTestId('sharpen-answer-Q1')).toHaveText('Answer with A');
  await page.keyboard.press('ArrowDown');
  await expect(card.getByRole('radio', { name: /Anyone on the team/ })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: 'Answer with B' })).toBeFocused();
  // the text answer waits for text
  await expect(card.getByRole('button', { name: 'Answer with this' })).toBeDisabled();
  await page.keyboard.press('Enter');

  const line = page.getByTestId('sharpen-answered-Q1');
  await expect(line).toContainText('Anyone on the team');
  await expect(line.getByTestId('sharpen-decision')).toHaveText(/^D\d+$/);
  await expect(card).toHaveCount(0);
  await expect(line).toBeFocused();

  // with every proof cleared, Use these proofs says why it waits; the suggestions go back after
  const refs = page.getByRole('textbox', { name: /What proves criterion/ });
  const kept = await refs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  for (const r of await refs.all()) await r.fill('');
  await expect(page.getByTestId('sharpen-use-proofs')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('sharpen-use-proofs')).toHaveAttribute('aria-describedby', 'sharpen-proofs-why');
  await expect(page.getByTestId('sharpen-proofs-why')).toHaveText('Say what proves at least one criterion first.');
  for (const [i, r] of (await refs.all()).entries()) await r.fill(kept[i] as string);
  await expect(page.getByTestId('sharpen-proofs-why')).toHaveCount(0);

  await page.getByTestId('sharpen-use-proofs').click();
  await expect(page.getByTestId('sharpen-ready')).toHaveText('Ready: every criterion has a proof and nothing waits on you.');
  const task = (await d.task(id)) as unknown as { proofs: unknown };
  expect(task.proofs).toEqual([
    { criterion: 1, kind: 'test', ref: 'GET /health answers 200' },
    { criterion: 2, kind: 'test', ref: 'The body says ok' },
  ]);
  const answered = (await d.events(id)).find((e) => e.type === 'sharpen.answered');
  expect(answered?.payload).toMatchObject({ question: 'Q1', option: 'Anyone on the team', by: 'you' });
});

test('The Sharpen panel and the New task dialog have no WCAG A or AA violations, and the panel has no sideways scroll at 390 px', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: sharpen for the accessibility check', ['the task file exists', 'the log says so']);
  const axe = async () => {
    // this check is about the panel and the dialog; a toast from another flow's task can arrive mid-fade at any moment,
    // and toasts have their own accessibility test (toasts.spec.ts), so the toast region is left out here
    const results = await new AxeBuilder({ page }).exclude('[data-sonner-toaster]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('sharpen-start')).toBeVisible();
  expect(await axe()).toEqual([]);
  await page.getByTestId('sharpen-start').click();
  await expect(page.getByTestId('sharpen-card-Q1')).toBeVisible();
  await page.getByTestId('sharpen-assumed').getByRole('button', { name: 'Change A1' }).click();
  expect(await axe()).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  const sideways = await page.getByTestId('sharpen-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.goto('/');
  await page.keyboard.press('n');
  // the spec builder opens first; the plain form is behind Write it yourself
  await page.getByTestId('builder-write').click();
  await expect(page.getByRole('dialog', { name: 'New task' }).getByLabel('Sharpen it first')).toBeVisible();
  expect(await axe()).toEqual([]);
});

test('A merged task asks nothing more: its Sharpen questions are gone once it is done', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: sharpen, then merge');
  await d.post(`/api/tasks/${t.id}/sharpen`);
  await page.goto(`/t/${t.id}`);
  await expect(page.getByTestId('sharpen-card-Q1')).toBeVisible();
  await page.route(`**/api/tasks/${t.id}`, async (route) => {
    const res = await route.fetch();
    const bundle = (await res.json()) as { task: Record<string, unknown> };
    bundle.task.status = 'done';
    await route.fulfill({ response: res, json: bundle });
  });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Flow: sharpen, then merge');
  await expect(page.getByTestId('sharpen-panel')).toHaveCount(0);
});
