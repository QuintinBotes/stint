import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { daemon } from './daemon';

type Skill = { id: string; description: string; origin: string; status: string; source?: { kind: string; ref: string }; findings?: Array<{ id: string; severity: string; file: string }> };

const enc = (s: string) => new TextEncoder().encode(s);
const skillMd = (name: string) => `---\nname: ${name}\ndescription: Run the project checks script before you hand off a task.\n---\n\n# ${name}\n\nRun scripts/run.sh before you stop. A red check is not finished work.\n`;
// a script is a warn, and there is no secret in the bundle, so it can be approved once the warn is acknowledged
const script = '#!/bin/sh\nbun test\n';

test('Upload a zip on the Setup sheet: its findings show, the warn is acknowledged, and the approved skill shows with origin import and a Download button', async ({ page, request }) => {
  const d = daemon(request);
  const zip = zipSync({ 'flow-run-checks/SKILL.md': enc(skillMd('flow-run-checks')), 'flow-run-checks/scripts/run.sh': enc(script) });

  await page.goto('/skills');
  await page.getByTestId('add-skill').click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await expect(dialog.getByRole('tab', { name: 'Upload' })).toBeFocused();
  await dialog.getByTestId('skill-file').setInputFiles({ name: 'flow-run-checks.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });

  // the preview, unzipped and scanned in the browser before anything is sent
  const preview = dialog.getByTestId('skill-preview');
  await expect(preview.getByTestId('skill-preview-files')).toContainText('SKILL.md');
  await expect(preview.getByTestId('skill-preview-files')).toContainText('scripts/run.sh');
  await expect(preview.locator('[data-finding="executable-script"]')).toContainText('Warn');
  await expect(preview.getByTestId('skill-prompt-line')).toHaveText('- flow-run-checks: Run the project checks script before you hand off a task.');
  await dialog.getByRole('tabpanel').getByTestId('add-skill-submit').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('add-skill')).toBeFocused();

  // the proposal waits in the queue, selected, with the daemon's findings
  const row = page.locator('[data-testid="skill-row"][data-skill="flow-run-checks"]');
  await expect(row.locator('[data-finding="executable-script"]')).toBeVisible();
  await expect(row).toContainText('Scanned by pattern; this is not a security review.');
  await expect(row.getByTestId('skill-eval')).toHaveText('not evaluated');
  await expect(row.getByTestId('approve-skill')).toBeDisabled();
  await row.getByTestId('ack-finding').check();
  await row.getByTestId('approve-skill').click();

  await expect.poll(async () => (await d.get<Skill[]>('/api/skills')).find((s) => s.id === 'flow-run-checks')).toMatchObject({ status: 'probation', origin: 'import', source: { kind: 'zip', ref: 'flow-run-checks.zip' } });
  await expect(row).toHaveAttribute('data-origin', 'import');
  await expect(row.getByTestId('skill-origin')).toHaveText('imported');
  const download = row.getByTestId('download-skill');
  await expect(download).toBeVisible();
  const zipped = await request.get((await download.getAttribute('href')) as string);
  expect(zipped.ok()).toBe(true);
  expect(zipped.headers()['content-type']).toContain('application/zip');
});

test('A folder upload keeps its paths, and Edit opens Write prefilled from the approved folder', async ({ page, request }) => {
  const d = daemon(request);
  const dir = join(mkdtempSync(join(tmpdir(), 'stint-skill-folder-')), 'flow-folder-checks');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd('flow-folder-checks'));
  writeFileSync(join(dir, 'scripts', 'run.sh'), script);

  await page.goto('/skills');
  await page.getByTestId('add-skill').click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await dialog.getByTestId('skill-folder').setInputFiles(dir);
  await expect(dialog.getByTestId('skill-preview-files')).toContainText('scripts/run.sh');
  await dialog.getByRole('tabpanel').getByTestId('add-skill-submit').click();
  await expect(dialog).toHaveCount(0);
  const queued = await d.get<Skill[]>('/api/skills').then((all) => all.find((s) => s.id === 'flow-folder-checks'));
  expect(queued).toMatchObject({ status: 'proposed', origin: 'import', source: { kind: 'folder', ref: 'flow-folder-checks' } });
  expect(queued?.findings).toContainEqual(expect.objectContaining({ id: 'executable-script', file: 'scripts/run.sh' }));

  const approved = (await d.get<Skill[]>('/api/skills')).find((s) => s.id === 'review-voice-policy') as Skill;
  await page.locator('[data-list-skill="review-voice-policy"]').getByRole('button').click();
  const row = page.locator('[data-testid="skill-row"][data-skill="review-voice-policy"]');
  await row.getByTestId('edit-skill').click();
  const edit = page.getByRole('dialog', { name: 'Edit review-voice-policy' });
  await expect(edit.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
  await expect(edit.getByTestId('skill-description')).toHaveValue(approved.description);
  await expect(edit.getByTestId('skill-prompt-line')).toHaveText(`- review-voice-policy: ${approved.description}`);
  await page.keyboard.press('Escape');
  await expect(edit).toHaveCount(0);
  await expect(row.getByTestId('edit-skill')).toBeFocused();
});
