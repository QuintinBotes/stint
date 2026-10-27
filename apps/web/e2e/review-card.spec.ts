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
