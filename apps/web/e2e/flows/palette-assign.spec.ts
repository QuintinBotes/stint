import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('The palette offers Assign to each agent that can build, with its CLI command, and choosing one starts a run; the terminal and diff show their command beside their key', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: assign from the palette');
  await page.goto(`/t/${t.id}`);
  await page.keyboard.press('Meta+k');
  const assign = page.getByRole('option', { name: /Assign to Muse Code/ });
  await expect(assign).toContainText(`stint assign ${t.id} muse-code`);
  await expect(page.getByRole('option', { name: /Show the diff/ })).toContainText(`..stint/${t.id}`);
  await expect(page.getByRole('option', { name: /Open the terminal/ })).toContainText(`cd .stint/worktrees/${t.id}-`);
  await assign.click();
  const events = await d.until(t.id, (ev) => ev.some((e) => e.type === 'run.started'));
  expect(events.find((e) => e.type === 'run.started')?.adapter).toBe('muse-code');
  // the fake builder finishes at once; wait for it so the next flow starts from a quiet daemon
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'run.finished'));
});
