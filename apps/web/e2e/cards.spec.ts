import { expect, test } from '@playwright/test';

test('The T-0042 verification card shows the passed count and who ran it, and the packet card highlights the ask of next with its token count', async ({ page }) => {
  await page.goto('/t/T-0042?tab=verification');
  const card = page.getByTestId('verification-card');
  await expect(card.getByTestId('verification-summary')).toContainText('33 passed');
  await expect(card.getByTestId('verification-summary')).toContainText('run by Stint');

  await page.goto('/t/T-0042?tab=packet');
  // the killed run's packet is h1; the recording counted it at 412 tokens and the header agrees
  await page.getByRole('button', { name: 'h1', exact: true }).click();
  await expect(page.getByTestId('packet-size')).toContainText('412 tokens');
  await expect(page.getByTestId('ask-of-next')).toBeVisible();
  await expect(page.getByTestId('ask-of-next')).toContainText('Check the unknown step first');
  // the ask is for the next agent, not for you, so it takes no amber
  await expect(page.getByTestId('handoff-card').locator('.border-amber, .bg-amber-wash')).toHaveCount(0);
});

test("After the replay, T-0042's gate shows who, when, the verification hash and the commit", async ({ page, request }) => {
  const bundle = (await (await request.get('/api/tasks/T-0042')).json()) as { merge: { by: string | null; at: string; commit: string; verificationHash: string | null } | null };
  expect(bundle.merge).not.toBeNull();
  const merge = bundle.merge as { by: string | null; at: string; commit: string; verificationHash: string | null };
  expect(merge.verificationHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  await page.goto('/t/T-0042');
  const signoff = page.getByTestId('signoff');
  await expect(signoff).toBeVisible();
  await expect(signoff.getByTestId('signoff-by')).toHaveText(!merge.by || merge.by === 'human' ? 'you' : merge.by);
  await expect(signoff.getByTestId('signoff-commit')).toHaveText(merge.commit.slice(0, 10));
  // the first 12 characters on the card, the full hash on hover
  const hash = signoff.getByTestId('signoff-hash');
  await expect(hash).toHaveText((merge.verificationHash as string).slice(0, 12));
  await expect(hash).toHaveAttribute('title', merge.verificationHash as string);
  // when, in local time: the date and a clock reading of the merge moment
  await expect(signoff.getByTestId('signoff-at')).toContainText(String(new Date(merge.at).getFullYear()));
  await expect(signoff.getByTestId('signoff-at')).toContainText(/\d{1,2}:\d{2}/);
});

test("T-0042's plan card marks the steps the last packet lists as done, and shows its files, risks and similar tasks", async ({ page, request }) => {
  const bundle = (await (await request.get('/api/tasks/T-0042')).json()) as { handoff: { done: string[]; open: string[] } | null };
  expect(bundle.handoff?.done.length).toBeGreaterThan(0);
  expect(bundle.handoff?.open).toEqual([]);
  await page.goto('/t/T-0042?tab=plan');
  const steps = page.getByTestId('plan-step');
  await expect(steps).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(steps.nth(i)).toHaveAttribute('data-state', 'done');
    await expect(steps.nth(i)).toContainText('done');
  }
  await expect(page.getByTestId('plan-files')).toContainText('src/lib/limiter.ts');
  await expect(page.getByTestId('plan-risks')).toContainText('Limiter state is in memory');
  await expect(page.getByTestId('plan-similar')).toContainText('T-0040');
});

test('The packet card shows the raw packet as a tree that folds', async ({ page }) => {
  await page.goto('/t/T-0042?tab=packet');
  await page.getByRole('tab', { name: 'Raw JSON' }).or(page.getByRole('button', { name: 'Raw JSON' })).first().click();
  const tree = page.getByTestId('packet-json');
  await expect(tree).toContainText('askOfNext');
  await expect(tree.getByRole('button').first()).toBeVisible();
});
