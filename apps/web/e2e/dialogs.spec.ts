import { type Page, expect, test } from '@playwright/test';

/** n opens the spec builder; the plain New task form is behind Write it yourself. */
async function newTaskForm(page: Page) {
  await page.keyboard.press('n');
  await page.getByRole('dialog', { name: 'What do you want done?' }).getByRole('button', { name: 'Write it yourself' }).click();
  return page.getByRole('dialog', { name: 'New task' });
}

test('New task asks before a dismissal drops what was typed: Discard this draft? with Keep editing first, and an empty form closes at once', async ({ page }) => {
  await page.goto('/');
  const dialog = await newTaskForm(page);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await newTaskForm(page);
  await dialog.getByLabel('Title').fill('A draft worth keeping');
  await page.keyboard.press('Escape');
  const ask = dialog.getByTestId('dialog-discard');
  await expect(ask).toContainText('Discard this draft?');
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  // Escape on the question keeps editing, with the text as typed
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(dialog.getByLabel('Title')).toHaveValue('A draft worth keeping');
  // the visible Close asks too; Discard drops it
  await dialog.getByTestId('dialog-close').click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);
  await newTaskForm(page);
  await expect(dialog.getByLabel('Title')).toHaveValue('');
});

test("The footer's Cancel closes an empty New task at once and asks first once anything is typed; Write it yourself leaves focus in the form", async ({ page }) => {
  await page.goto('/');
  // opened from the Board's button, which is where the builder would give focus back as it closes
  await page.getByTestId('new-task').click();
  await page.getByRole('dialog', { name: 'What do you want done?' }).getByRole('button', { name: 'Write it yourself' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  // two frames, so the builder's focus restore has had its turn and could not pull focus out of the form
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await newTaskForm(page);
  await dialog.getByLabel('Goal').fill('Something worth keeping');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const ask = dialog.getByTestId('dialog-discard');
  await expect(ask).toContainText('Discard this draft?');
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByLabel('Goal')).toHaveValue('Something worth keeping');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);
  // the form hands focus back to the button the builder was opened from
  await expect(page.getByTestId('new-task')).toBeFocused();
});

test('In the replay the builder says why Draft it is off, and Open a Spec Kit spec still opens a pasted spec as a draft', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'What do you want done?' });
  // the text box takes focus, and the n that opened the builder is not typed into it
  await expect(dialog.getByLabel('In a sentence or two')).toBeFocused();
  await expect(dialog.getByLabel('In a sentence or two')).toHaveValue('');
  const draft = dialog.getByRole('button', { name: 'Draft it' });
  await expect(draft).toHaveAttribute('aria-disabled', 'true');
  await expect(draft).toHaveAccessibleDescription('A replay calls no model, so it cannot draft a spec: open a Spec Kit spec, or write it yourself.');
  await dialog.getByLabel('In a sentence or two').fill('Add a health endpoint');
  await draft.click({ force: true });
  await expect(dialog.getByLabel('In a sentence or two')).toBeVisible();

  await dialog.getByRole('button', { name: 'Open a Spec Kit spec' }).click();
  await dialog.getByRole('textbox', { name: 'spec.md' }).fill(['# Feature Specification: Health endpoint', '', '## User Scenarios & Testing', '', '### User Story 1 - The route (Priority: P1)', '', '1. **Given** the service runs, **When** GET /health is asked, **Then** it answers 200', ''].join('\n'));
  await dialog.getByRole('button', { name: 'Open the spec' }).click();
  await expect(dialog.getByTestId('builder-draft')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Task' })).toBeChecked();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('It has one user story.');
  await expect(dialog.getByTestId('builder-story-1').getByLabel('Then')).toHaveValue('it answers 200');
  // a draft is something typed: Cancel asks before it is dropped
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByTestId('dialog-discard')).toContainText('Discard this draft?');
  await dialog.getByRole('button', { name: 'Discard' }).click();
  await expect(dialog).toHaveCount(0);
});

test('At 390 px the New task footer stays in reach with Limits open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const dialog = await newTaskForm(page);
  await dialog.getByText('Limits', { exact: true }).click();
  const create = dialog.getByRole('button', { name: 'Create task' });
  await expect(create).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('Escape from the spec builder opened by n or by the palette puts focus on the page content, not on the page itself', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  const focused = () => page.evaluate(() => document.activeElement?.tagName ?? 'none');
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'What do you want done?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(focused).toBe('MAIN');

  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder('Search or run a command').fill('New task');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'What do you want done?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(focused).toBe('MAIN');
});
