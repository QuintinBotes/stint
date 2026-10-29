import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

test('R-068 Acceptance 3: the Tests tab shows a failed visual check with its marked screenshot and alt text', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.create('Flow: visual check', ['[looks wrong] The admin page tells an over-limit tenant when to try again']);
  await d.post(`/api/tasks/${t.id}/proofs`, { proofs: [{ criterion: 1, kind: 'visual', ref: '/admin :: a 429 banner saying try again in 60 s' }] });
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  const events = await d.until(t.id, (ev) => ev.some((e) => e.type === 'verification.ran'));
  expect(events.find((e) => e.type === 'verification.ran')?.payload).toMatchObject({ status: 'red', reason: '[looks wrong] The admin page tells an over-limit tenant when to try again: The banner says NaN s where it should say 60 s.' });

  await page.goto(`/t/${t.id}?tab=verification`);
  const check = page.getByTestId('visual-check-1');
  await expect(check).toContainText('looks wrong');
  await expect(check.getByTestId('visual-problem')).toHaveText('The banner says NaN s where it should say 60 s.');
  await expect(check).toContainText('Muse Spark saw: A yellow banner says to try again in NaN s.');
  const shot = check.getByTestId('visual-screenshot');
  await expect(shot).toHaveAttribute('alt', 'A yellow banner says to try again in NaN s.');
  await expect(shot).toHaveAttribute('src', `/api/tasks/${t.id}/verification/r1/visual/visual-1-marked.png`);
  // the marked copy itself loaded, at the screenshot's size
  await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.getByTestId('visual-checks').screenshot({ path: test.info().outputPath('visual-check.png') });
});
