import { expect, test } from '@playwright/test';

// The replay's review is a single general one, so the task bundle gets a combined review from three lenses and two general reviewers.
test('The review tab shows each lens with its verdict, which lens found each finding, how many reviewers agreed, and a split verdict', async ({ page }) => {
  await page.route('**/api/tasks/T-0042', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { review: Record<string, unknown> };
    body.review = {
      version: 'stint.review/1',
      verdict: 'block',
      summary: 'general: request changes; security: block; spec-fit: approve',
      findings: [
        { id: 'F1', severity: 'blocker', text: 'The webhook signing secret is written to the log', file: 'src/routes/webhooks.ts', line: 12, lens: 'security' },
        { id: 'F2', severity: 'major', text: 'A tenant over the limit still gets 200', lens: 'general', agreement: 2 },
      ],
      blockers: ['The signing secret is logged'],
      model: 'ollama/muse-glimmer:30b-mlx, fireworks/muse-spark-open',
      offline: false,
      lens: 'combined',
      lenses: [
        { lens: 'general', verdict: 'approve', model: 'ollama/muse-glimmer:30b-mlx', findings: 1 },
        { lens: 'general', verdict: 'request_changes', model: 'fireworks/muse-spark-open', findings: 1 },
        { lens: 'security', verdict: 'block', model: 'ollama/muse-glimmer:30b-mlx', findings: 1 },
        { lens: 'spec-fit', verdict: 'approve', model: 'ollama/muse-glimmer:30b-mlx', findings: 0 },
      ],
      disagreement: true,
    };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/t/T-0042?tab=review');
  const card = page.getByTestId('review-card');
  await expect(card).toContainText('combined from the reviews below');
  await expect(card.getByTestId('review-lenses').locator('li')).toHaveCount(4);
  await expect(card.locator('[data-lens="security"]')).toContainText('block');
  await expect(card.getByTestId('review-disagreement')).toContainText('did not agree');
  const findings = card.getByTestId('finding');
  await expect(findings.nth(0)).toContainText('Security');
  await expect(findings.nth(1)).toContainText('found by 2 reviewers');
});
