import { type Page, expect, test } from '@playwright/test';

const READ_ONLY = 'This is a read-only copy of the recorded story. Install Stint to run it.';

/** Every read the copy makes that the snapshot does not hold; the static client logs each one. */
function misses(page: Page): string[] {
  const found: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('is not in the snapshot')) found.push(m.text());
  });
  page.on('pageerror', (e) => found.push(`page error: ${e.message}`));
  return found;
}

test('R-069 Requirement 2: the snapshot holds every read the board, T-0040, T-0042 and T-0043 (each tab), Goals, the Factory and Skills make', async ({ page }) => {
  const missed = misses(page);
  await page.goto('/stint/demo/');
  await expect(page.getByTestId('task-card')).toHaveCount(3);
  for (const id of ['T-0040', 'T-0042', 'T-0043']) {
    await page.goto(`/stint/demo/t/${id}`);
    const tabs = page.getByRole('tablist', { name: 'Work area' }).getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    for (const tab of await tabs.all()) {
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#work-panel')).not.toBeEmpty();
      await page.waitForTimeout(300);
    }
  }
  for (const path of ['/stint/demo/goals', '/stint/demo/factory', '/stint/demo/skills']) {
    await page.goto(path);
    await expect(page.locator('main')).not.toBeEmpty();
    await page.waitForTimeout(1000);
  }
  expect(missed).toEqual([]);
});

test('R-069 Acceptance 1: the static copy shows the board, a task\'s tabs, the Factory and Skills with data, says it is the hand-written replay, and Approve is off with the reason', async ({ page }) => {
  const missed = misses(page);
  await page.goto('/stint/demo/');
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  await expect(page.locator('[data-task="T-0042"]')).toContainText('Rate-limit incoming webhooks per tenant');
  // a router link works under /stint/demo/
  await page.locator('[data-task="T-0043"]').getByRole('link').first().click();
  await expect(page).toHaveURL(/\/stint\/demo\/t\/T-0043/);

  // a deep link is a 404 on GitHub Pages, answered with 404.html, which boots the app on that route
  const deep = await page.goto('/stint/demo/t/T-0042?tab=verification');
  expect(deep?.status()).toBe(404);
  await expect(page.getByTestId('tab-verification')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#work-panel')).toContainText('passed');
  await page.getByTestId('tab-packet').click();
  await expect(page.locator('#work-panel')).toContainText('406 tokens, 1.4 KB');
  // the packet the killed run left, one click back
  await page.getByRole('group', { name: 'Packets' }).getByRole('button', { name: 'h1' }).click();
  await expect(page.locator('#work-panel')).toContainText('412 tokens');
  await page.getByTestId('tab-diff').click();
  await expect(page.locator('#work-panel')).toContainText('src/');

  await page.goto('/stint/demo/t/T-0043');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await expect(page.getByTestId('gate-evidence')).toContainText(READ_ONLY);
  // the other actions reach the static client, which refuses them with the same reason
  await page.getByRole('button', { name: 'Request changes' }).click();
  await page.locator('#gate-text').fill('Use the shared limiter.');
  await page.getByTestId('approval-gate').getByRole('button', { name: 'Request changes' }).click();
  await expect(page.getByTestId('approval-gate').getByRole('alert')).toHaveText(READ_ONLY);

  await page.goto('/stint/demo/factory');
  await expect(page.getByTestId('it-learned')).toContainText('limiter-config-via-env');
  await page.goto('/stint/demo/skills');
  await expect(page.getByTestId('skills')).toContainText('limiter-config-via-env');
  expect(missed).toEqual([]);
});

test('the landing page is the site root: it says what Stint is, links the demo, the film and the repository, and every image loads', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/stint/')) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/stint/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The task outlives the agent.');
  await expect(page.getByRole('link', { name: 'Open the live demo' })).toHaveAttribute('href', 'demo/');
  await expect(page.getByRole('link', { name: 'Watch the 3-minute film' })).toHaveAttribute('href', /youtu/);
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/QuintinBotes/stint');
  for (const img of await page.locator('img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.getByRole('link', { name: 'Open the live demo' }).click();
  await expect(page).toHaveURL(/\/stint\/demo\/$/);
  await expect(page.getByTestId('replay-strip')).toContainText('Replay, hand-written');
  expect(failed.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
});
