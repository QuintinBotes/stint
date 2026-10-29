import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { daemon } from './daemon';
import { holdRequests } from './pending';

type Goal = { id: string; criteria: Array<{ text: string }>; decisions: Array<{ id: string }> };

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
};
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** A spec.md in GitHub Spec Kit's shape with two stories, as a person would paste it. */
const SPEC = `# Feature Specification: Flow: health checks from a spec

**Input**: User description: "Operators can tell the service is up"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The health route (Priority: P1)

**Why this priority**: Nothing else can be checked without it.

**Acceptance Scenarios**:

1. **Given** the service is running, **When** an operator asks GET /health, **Then** it answers 200 with ok

### User Story 2 - A failing database (Priority: P2)

**Why this priority**: A broken database must show.

**Acceptance Scenarios**:

1. **Given** the database is down, **When** an operator asks GET /health, **Then** it answers 503 and names the database

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST answer GET /health

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can tell the service is up without reading its logs
`;

/** From the person's words to the draft: Draft it, one material question answered by a click, the recommendation for the rest, then Continue or Refine. */
async function answer(page: Page, words: string, next: 'Continue' | 'Refine' = 'Continue') {
  const dialog = page.getByRole('dialog', { name: 'What do you want done?' });
  await dialog.getByLabel('In a sentence or two').fill(words);
  await dialog.getByRole('button', { name: 'Draft it' }).click();
  const q1 = dialog.getByTestId('builder-question-Q1');
  await expect(q1).toContainText('Who may turn the new behaviour off once it ships?');
  await expect(q1).toContainText('Needs your answer');
  // the question the repository can answer was dropped by Sharpen's rules
  await expect(dialog.getByText('Which file holds the change?')).toHaveCount(0);
  const rest = dialog.getByTestId('builder-recommended');
  await expect(rest).toHaveText('Use the recommended answers, 1 still needs you');
  // the material question takes its own click; the recommendation is marked, and this answer is the other option
  await expect(q1.getByRole('button', { name: /Only an admin/ })).toContainText('recommended');
  await q1.getByRole('button', { name: /Anyone on the team/ }).click();
  await expect(q1.getByRole('button', { name: /Anyone on the team/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(q1).not.toContainText('Needs your answer');
  await expect(rest).toHaveText('Use the recommended answers');
  await rest.click();
  await expect(dialog.getByTestId('builder-question-Q2').getByRole('button', { name: /One line per run/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(rest).toHaveCount(0);
  await dialog.getByRole('button', { name: next }).click();
  await expect(dialog.getByTestId('builder-draft')).toBeVisible();
  // the step starts at its heading, not where the questions were scrolled to
  await expect(dialog.getByRole('heading', { name: 'The draft' })).toBeFocused();
  return dialog;
}

test('A sentence becomes a task: one question answered, the recommendation for the rest, a scenario edited, and the task view shows the acceptance lines and the decisions', async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = await answer(page, 'Flow: add a health endpoint from the builder');

  await expect(dialog.getByRole('radio', { name: 'Task' })).toBeChecked();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('One agent can build and verify it in one run.');
  // the reason follows a switch, and comes back with the draft's own kind
  await dialog.getByRole('radio', { name: 'Goal' }).check();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('You asked for a goal.');
  await dialog.getByRole('radio', { name: 'Task' }).check();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('One agent can build and verify it in one run.');
  await expect(dialog.getByLabel('Title', { exact: true }).first()).toHaveValue('Flow: add a health endpoint from the builder');
  await dialog.getByTestId('builder-story-1').getByLabel('Then').fill('it answers 200 with ok');

  // Escape with a draft asks first, and Escape on the question keeps the draft as edited
  await page.keyboard.press('Escape');
  await expect(dialog.getByTestId('dialog-discard')).toContainText('Discard this draft?');
  await page.keyboard.press('Escape');
  await expect(dialog.getByTestId('dialog-discard')).toHaveCount(0);
  await expect(dialog.getByTestId('builder-story-1').getByLabel('Then')).toHaveValue('it answers 200 with ok');

  // Download spec.md is the draft as edited, in Spec Kit's shape
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download spec.md' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('spec.md');
  const md = readFileSync(await file.path(), 'utf8');
  expect(md).toContain('# Feature Specification: Flow: add a health endpoint from the builder');
  expect(md).toContain('1. **Given** the service is running, **When** a person uses the change, **Then** it answers 200 with ok');

  // a double press makes one task, and the button says it is working while the daemon answers
  const held = await holdRequests(page, '**/api/drafts/create');
  await dialog.getByRole('button', { name: 'Create task' }).dblclick();
  await expect(dialog.getByRole('button', { name: 'Creating task' })).toHaveAttribute('aria-disabled', 'true');
  held.release();
  await expect(page).toHaveURL(/\/t\/T-\d+$/);
  expect(held.count()).toBe(1);
  const id = /\/t\/(T-\d+)/.exec(page.url())?.[1] as string;

  const lines = ['Given the service is running, when a person uses the change, then it answers 200 with ok', 'Given the change cannot run, when a person uses it, then they see why it failed'];
  const proofs = page.getByTestId('sharpen-proofs');
  for (const l of lines) await expect(proofs).toContainText(l);
  await expect(page.getByTestId('sharpen-answered-Q1')).toContainText('Anyone on the team');
  await expect(page.getByTestId('sharpen-answered-Q1').getByTestId('sharpen-decision')).toHaveText(/^D\d+$/);
  await expect(page.getByTestId('sharpen-answered-Q2')).toContainText('One line per run');

  const task = (await d.task(id)) as unknown as { title: string; acceptance: string[]; proofs: unknown[] };
  expect(task).toMatchObject({ title: 'Flow: add a health endpoint from the builder', acceptance: lines });
  expect(task.proofs).toEqual([
    { criterion: 1, kind: 'scenario', ref: 'it answers 200 with ok' },
    { criterion: 2, kind: 'scenario', ref: 'they see why it failed' },
  ]);
  const answered = (await d.events(id)).filter((e) => e.type === 'sharpen.answered').map((e) => e.payload);
  expect(answered).toEqual([
    { question: 'Q1', option: 'Anyone on the team', decision: 'D1', by: 'you' },
    { question: 'Q2', option: 'One line per run', decision: 'D2', by: 'you' },
  ]);
});

test("New goal's builder drafts a goal whose split proposal lists one task per story, with a decision per answer", async ({ page, request }) => {
  const d = daemon(request);
  await page.goto('/goals');
  await page.getByTestId('new-goal').click();
  // Refine folds the answers in; the fake model asks nothing more, so the draft is next, and a second round is not offered
  const dialog = await answer(page, 'Flow: operators can tell the service is up', 'Refine');
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByTestId('builder-question-Q1').getByRole('button', { name: /Anyone on the team/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Refine' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('radio', { name: 'Goal' })).toBeChecked();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('It has two stories that each ship on their own.');
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Create goal' }).click();
  await expect(page).toHaveURL(/\/goals\/G-\d{4}$/);
  const id = /\/goals\/(G-\d{4})/.exec(page.url())?.[1] as string;

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Flow: operators can tell the service is up');
  const proposal = page.getByTestId('goal-proposal');
  await expect(proposal.locator('[data-testid^="proposed-"]')).toHaveCount(2);
  await expect(page.getByTestId('proposed-1').getByLabel('Title')).toHaveValue('The main path');
  await expect(page.getByTestId('proposed-2').getByLabel('Title')).toHaveValue('When it fails');
  await expect(page.getByTestId('sharpen-answered-Q1')).toContainText('Anyone on the team');

  const goal = await d.get<{ goal: Goal }>(`/api/goals/${id}`).then((v) => v.goal);
  expect(goal.criteria.map((c) => c.text)).toEqual(['Both stories pass their scenarios.']);
  expect(goal.decisions).toHaveLength(2);
});

test('Open a Spec Kit spec: a malformed one is refused in plain words with the text kept, and a pasted spec becomes a goal split one task per story', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'What do you want done?' });
  await dialog.getByRole('button', { name: 'Open a Spec Kit spec' }).click();
  const spec = dialog.getByRole('textbox', { name: 'spec.md' });
  await spec.fill('Just some notes about health checks.');
  await dialog.getByRole('button', { name: 'Open the spec' }).click();
  await expect(dialog.getByTestId('builder-error')).toHaveText(
    'The spec was not opened: the spec could not be read. The spec has no title; Spec Kit starts it with # Feature Specification: Name; The spec has no user stories; Spec Kit writes each as ### User Story 1 - Title (Priority: P1).',
  );
  await expect(spec).toHaveValue('Just some notes about health checks.');
  expect(await axe(page)).toEqual([]);

  // a chosen file fills the same text area, so what is opened can be read first
  await dialog.getByRole('button', { name: 'Choose spec.md' }).setInputFiles({ name: 'spec.md', mimeType: 'text/markdown', buffer: Buffer.from(SPEC) });
  await expect(spec).toHaveValue(SPEC);
  await dialog.getByRole('button', { name: 'Open the spec' }).click();
  // no questions to ask, so the draft is next
  await expect(dialog.getByTestId('builder-draft')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Goal' })).toBeChecked();
  await expect(dialog.getByTestId('builder-kind-why')).toHaveText('It has 2 user stories, and each ships on its own.');
  await expect(dialog.getByLabel('Success criteria, one per line')).toHaveValue('An operator can tell the service is up without reading its logs');
  await dialog.getByRole('button', { name: 'Create goal' }).click();
  await expect(page).toHaveURL(/\/goals\/G-\d{4}$/);
  await expect(page.getByTestId('proposed-1').getByLabel('Title')).toHaveValue('The health route');
  await expect(page.getByTestId('proposed-2').getByLabel('Title')).toHaveValue('A failing database');
});

test('A failed draft call keeps the words with the daemon\'s message, and at 390 px each step of the builder has its actions in reach with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.keyboard.press('n');
  const dialog = page.getByRole('dialog', { name: 'What do you want done?' });
  await page.route('**/api/drafts', (route) => route.fulfill({ status: 502, json: { error: { code: 'adapter_unavailable', message: 'no model could draft this spec', hint: 'every host on the planner route refused' } } }), { times: 1 });
  await dialog.getByLabel('In a sentence or two').fill('Flow: a draft that fails once');
  await dialog.getByRole('button', { name: 'Draft it' }).click();
  await expect(dialog.getByTestId('builder-error')).toHaveText('Stint did not draft it: no model could draft this spec. every host on the planner route refused');
  await expect(dialog.getByLabel('In a sentence or two')).toHaveValue('Flow: a draft that fails once');
  await expect(dialog.getByRole('button', { name: 'Draft it' })).toBeInViewport();
  expect(await sideways(page)).toBeLessThanOrEqual(0);

  await dialog.getByRole('button', { name: 'Draft it' }).click();
  await expect(dialog.getByTestId('builder-question-Q1')).toBeVisible();
  await expect(dialog.getByTestId('builder-error')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Continue' })).toBeInViewport();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('button', { name: 'Create task' })).toBeInViewport();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await axe(page)).toEqual([]);
});
