import { expect, test } from '@playwright/test';

// The replay's T-0042 change, as demo/recording.jsonl has it: r2 wrote four files, r3 added the rate limit tests,
// and the latest packet (h2) left one thing out.
test('The Diff tab lists the changed files, names who wrote a file on hover, switches layout, and shows what the packet left out', async ({ page }) => {
  await page.goto('/t/T-0042');
  const tree = page.getByTestId('diff-tree');
  await expect(tree).toBeVisible();
  const paths = await tree.getByTestId('diff-tree-file').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));
  expect(paths).toEqual(['src/app.ts', 'src/lib/limiter.ts', 'src/routes/webhooks.ts', 'test/limiter.test.ts', 'test/ratelimit.test.ts']);
  await expect(page.getByTestId('viewed-count')).toContainText('0 of 5 viewed');

  const leftOut = page.getByTestId('left-out');
  await expect(leftOut.getByRole('heading', { name: 'Left out' })).toBeVisible();
  await expect(leftOut.locator('li')).toHaveCount(1);
  await expect(leftOut).toContainText('Limiter state across restarts was not looked at');

  await tree.locator('[data-testid="diff-tree-file"][data-path="src/lib/limiter.ts"]').click();
  await expect(page).toHaveURL(/file=src%2Flib%2Flimiter\.ts/);
  const pane = page.getByTestId('diff-pane');
  await pane.getByText('SlidingWindowLimiter').first().hover();
  await expect(page.getByTestId('diff-attribution')).toContainText('Written by Muse Code r2');

  await page.getByTestId('mark-viewed').click();
  await expect(page.getByTestId('mark-viewed')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('viewed-count')).toContainText('1 of 5 viewed');

  await page.getByTestId('diff-layout-split').click();
  await expect(page.getByTestId('diff-layout-split')).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByText('SlidingWindowLimiter').first()).toBeVisible();
  await page.getByTestId('diff-layout-stacked').click();
  await expect(page.getByTestId('diff-layout-stacked')).toHaveAttribute('aria-pressed', 'true');
  await expect(pane.getByText('SlidingWindowLimiter').first()).toBeVisible();

  // the layout choice and the viewed mark survive a reload
  await page.getByTestId('diff-layout-split').click();
  await page.reload();
  await expect(page.getByTestId('diff-layout-split')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('viewed-count')).toContainText('1 of 5 viewed');
});

test('Hovering a hunk names the run whose commit last wrote its lines, from blame (R-052)', async ({ page }) => {
  await page.goto('/t/T-0042');
  const tree = page.getByTestId('diff-tree');
  await expect(tree).toBeVisible();
  const attribution = page.getByTestId('diff-attribution');

  // the limiter was written by the killed Muse Code run r2; with blame the hint speaks of lines, not files
  await tree.locator('[data-testid="diff-tree-file"][data-path="src/lib/limiter.ts"]').click();
  await expect(attribution).toContainText('Hover a line to see which run wrote it.');
  const pane = page.getByTestId('diff-pane');
  await pane.getByText('SlidingWindowLimiter').first().hover();
  await expect(attribution).toContainText('Written by Muse Code r2');

  // the rate limit tests were added by the Stint agent continuing as r3, so their lines name r3
  await tree.locator('[data-testid="diff-tree-file"][data-path="test/ratelimit.test.ts"]').click();
  await pane.getByText('answers 429 with Retry-After').first().hover();
  await expect(attribution).toContainText('Written by Stint agent r3');
});
