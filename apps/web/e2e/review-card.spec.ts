import { expect, test } from '@playwright/test';

test('The T-0042 review card shows the offline badge and the finding routed to the queue against D3', async ({ page }) => {
  await page.goto('/t/T-0042?tab=review');
  const card = page.getByTestId('review-card');
  // the recording's reviewer ran locally on Glimmer, so the card carries the offline badge
  await expect(card.getByText('offline', { exact: true })).toBeVisible();
  const finding = card.getByTestId('finding').filter({ hasText: 'A fixed window counter would use less memory' });
  await expect(finding).toBeVisible();
  await expect(finding).toContainText('contradicts D3, routed to the queue');
  // D3 itself stands in the timeline beside the card, in its own words
  await expect(page.getByText('Sliding window over fixed window, so a burst at a window edge cannot double the limit').first()).toBeVisible();
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
