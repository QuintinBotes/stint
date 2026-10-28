import { type Page, expect, test } from '@playwright/test';

// T-0043 waits at the gate after the replay. Approve calls are answered here, so no test merges it for the others.
const refuse = (page: Page, message: string, onCall?: () => void) =>
  page.route('**/api/tasks/T-0043/approve', (r) => {
    onCall?.();
    return r.fulfill({ status: 409, json: { error: { code: 'verification_red', message, hint: null } } });
  });

test('Approve is offered only while the task waits at the gate', async ({ page }) => {
  await page.goto('/t/T-0043');
  await expect(page.getByTestId('approve')).toBeEnabled();

  // the same task, green and reviewed, but building again after a request for changes: the gate stays shut
  await page.route('**/api/tasks/T-0043', async (route) => {
    const res = await route.fetch();
    const bundle = (await res.json()) as { task: Record<string, unknown> };
    bundle.task.status = 'building';
    await route.fulfill({ response: res, json: bundle });
  });
  await page.reload();
  await expect(page.getByTestId('approval-gate')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await expect(page.getByTestId('approval-gate')).toContainText('A run is going on this task.');
});

test('While the request form is open, a does not approve; Escape closes the form and puts focus back on its button', async ({ page }) => {
  let approves = 0;
  await refuse(page, 'should not be called', () => approves++);
  await page.goto('/t/T-0043');
  await expect(page.getByTestId('approve')).toBeEnabled();
  await page.keyboard.press('r');
  const text = page.getByLabel('What should change? This becomes the next ask.');
  await expect(text).toBeFocused();
  // focus out of the textarea, as a click elsewhere on the gate leaves it, then the approve key
  await page.getByTestId('approval-gate').locator('caption').click();
  await page.keyboard.press('a');
  await page.waitForTimeout(300);
  expect(approves).toBe(0);
  await page.keyboard.press('Escape');
  await expect(text).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Request changes/ })).toBeFocused();
});

test('A refused approval shows the daemon’s reason at the gate', async ({ page }) => {
  await refuse(page, 'changes were asked for after the last green verification');
  await page.goto('/t/T-0043');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('approval-gate').getByRole('alert')).toContainText('changes were asked for after the last green verification');
});

test('A failed write says what the daemon said: turning on autopilot', async ({ page }) => {
  await page.route('**/api/tasks/T-0043/autopilot', (r) => r.fulfill({ status: 409, json: { error: { code: 'busy', message: 'a run is already on track', hint: 'Stop it first.' } } }));
  await page.goto('/t/T-0043');
  await page.getByTestId('autopilot-switch').click();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'a run is already on track' })).toBeVisible();
});

for (const [width, height] of [
  [1600, 1000],
  [390, 844],
] as const) {
  test(`At ${width} px the page never scrolls past its content: the document is exactly the window`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of ['/', '/t/T-0042', '/factory', '/skills']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
      expect(scroll, `${path} scrolls past the window`).toBe(inner);
    }
  });
}

test('Single-key shortcuts can be turned off in the palette, stay off after a reload, and come back on', async ({ page }) => {
  const palette = async (query: string) => {
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder('Search or run a command').fill(query);
    await page.keyboard.press('Enter');
  };
  await page.goto('/t/T-0042');
  // m shows or hides memory
  const memory = page.getByTestId('memory-toggle');
  await expect(memory).toHaveAttribute('aria-expanded', 'true');
  await palette('single-key shortcuts off');
  await page.keyboard.press('m');
  await expect(memory).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(memory).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('m');
  await expect(memory).toHaveAttribute('aria-expanded', 'true');
  // the palette and Cmd+K still work, and they turn the keys back on
  await palette('single-key shortcuts on');
  await page.keyboard.press('m');
  await expect(memory).toHaveAttribute('aria-expanded', 'false');
});
