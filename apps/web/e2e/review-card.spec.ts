import { expect, test } from '@playwright/test';

test('The T-0042 review card shows it ran on this machine and the finding routed to the queue against D3', async ({ page }) => {
  await page.goto('/t/T-0042?tab=review');
  const card = page.getByTestId('review-card');
  // the recording's reviewer ran locally on Glimmer, so the card says it ran on this machine
  await expect(card.getByText('on this machine', { exact: true })).toBeVisible();
  // the verdict is a recommendation, not a verified result, so nothing on the card is green
  await expect(card.locator('.text-green')).toHaveCount(0);
  const finding = card.getByTestId('finding').filter({ hasText: 'A fixed window counter would use less memory' });
  await expect(finding).toBeVisible();
  await expect(finding.getByTestId('contradicted-decision')).toContainText('Would reverse decision D3');
  await expect(finding.getByTestId('finding-queue')).toContainText('Settle it in the queue');
  // D3 itself stands in the timeline beside the card, in its own words
  await expect(page.getByText('Sliding window over fixed window, so a burst at a window edge cannot double the limit').first()).toBeVisible();
});

test('A review with blockers shows them above the findings, counted and in the bad tone', async ({ page }) => {
  // the replay review has no blockers, so this one is served with two
  await page.route('**/api/tasks/T-0042', async (route) => {
    const res = await route.fetch();
    const bundle = (await res.json()) as { review: Record<string, unknown> };
    bundle.review = { ...bundle.review, blockers: ['The limiter counts retries as new requests.', 'The window is read once at startup and cannot change.'] };
    await route.fulfill({ response: res, json: bundle });
  });
  await page.goto('/t/T-0042?tab=review');
  const blockers = page.getByTestId('review-blockers');
  await expect(blockers).toContainText('2 blockers');
  await expect(blockers).toContainText('The limiter counts retries as new requests.');
  await expect(blockers).toContainText('The window is read once at startup and cannot change.');
  await expect(blockers.locator('li').first()).toHaveClass(/text-red/);
  const blockersBox = await blockers.boundingBox();
  const findingBox = await page.getByTestId('finding').first().boundingBox();
  expect(blockersBox).not.toBeNull();
  expect(findingBox).not.toBeNull();
  expect((blockersBox as { y: number }).y).toBeLessThan((findingBox as { y: number }).y);
});

test("A finding that would reverse D3 shows D3's text, links to the Factory queue, and its file opens in the diff", async ({ page }) => {
  await page.goto('/t/T-0042?tab=review');
  const finding = page.getByTestId('finding').filter({ has: page.getByTestId('finding-queue') }).first();
  await expect(finding.getByTestId('contradicted-decision')).toContainText('D3: Sliding window over fixed window');
  await expect(finding.getByTestId('finding-queue')).toHaveAttribute('href', '/factory');
  const file = page.getByTestId('finding-file').first();
  const path = ((await file.textContent()) ?? '').split(':')[0] as string;
  await file.click();
  await expect(page).toHaveURL(new RegExp(`tab=diff&file=${encodeURIComponent(path).replace(/%2F/g, '(%2F|/)')}`));
});
