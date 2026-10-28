import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

type LineComment = { id: string; file: string; line: number; text: string; at: string; handedTo?: string };

test('A line comment added in the Diff tab is stored by the daemon and handed to the next run in its ask', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: line comments');
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));

  const filePath = `src/lib/${t.id}.ts`;
  await page.goto(`/t/${t.id}`);
  const tree = page.getByTestId('diff-tree');
  await tree.locator(`[data-testid="diff-tree-file"][data-path="${filePath}"]`).click();
  const pane = page.getByTestId('diff-pane');
  // the keyboard reaches a line too: arrows choose it, Enter opens the field, Escape closes it
  await pane.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('diff-attribution')).toContainText('Line 1 selected');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('diff-comment-form')).toContainText(`Comment on ${filePath}:1`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('diff-comment-form')).toHaveCount(0);

  await pane.getByText('DONE').first().click();
  await expect(page.getByTestId('diff-comment-form')).toBeVisible();
  await expect(page.getByTestId('diff-comment-form')).toContainText(`Comment on ${filePath}:2`);
  await page.getByTestId('diff-comment-input').fill('Name the marker after the task');
  await page.getByTestId('diff-comment-save').click();
  await expect(page.getByTestId('diff-comment')).toContainText('Name the marker after the task');

  const stored = await d.get<LineComment[]>(`/api/tasks/${t.id}/comments`);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ file: filePath, line: 2, text: 'Name the marker after the task' });

  await page.goto(`/t/${t.id}?tab=packet`);
  const hand = page.getByTestId('hand-to');
  // at the gate the hand-off sits behind "Change driver instead"; elsewhere it is open
  await expect(hand).toBeVisible();
  const instead = hand.getByText('Change driver instead');
  if (await instead.isVisible()) await instead.click();
  await hand.locator('input[value="stint-agent"]').check();
  await hand.getByTestId('hand-button').click();

  // the fake writer says back the ask in its prompt, so its message proves the comment reached the new run
  const after = await d.until(t.id, (ev) => ev.filter((e) => e.type === 'verification.ran').length >= 2);
  const asked = after
    .filter((e) => e.type === 'agent.message')
    .map((e) => String(e.payload.text ?? ''))
    .at(-1);
  expect(asked).toContain(`Review comments: ${filePath}:2 Name the marker after the task`);
  const handed = await d.get<LineComment[]>(`/api/tasks/${t.id}/comments`);
  expect(handed[0]?.handedTo).toBe('r2');
});
