import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Every main screen against WCAG 2.2 A and AA, as the replay shows it. A failure names the rule and the elements.
for (const [name, path] of [
  ['board', '/'],
  ['task view', '/t/T-0042'],
  ['packet', '/t/T-0042?tab=packet'],
  ['verification', '/t/T-0042?tab=verification'],
  ['review', '/t/T-0042?tab=review'],
  ['factory', '/factory'],
  ['skills', '/skills'],
] as const) {
  test(`The ${name} has no WCAG A or AA violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const found = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}

const axe = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
};

test('The command line, open over the task view, has no WCAG A or AA violations', async ({ page }) => {
  await page.goto('/t/T-0042');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Type a command or a task')).toBeFocused();
  const found = await axe(page);
  expect(found, found.join('\n')).toEqual([]);
});

test('The task view rewound to the red flag, on the terminal tab, has no WCAG A or AA violations', async ({ page }) => {
  const { events } = (await (await page.request.get('/api/tasks/T-0042/events')).json()) as { events: Array<{ seq: number; ts: string; type: string; payload: Record<string, unknown> }> };
  const h1 = events.find((e) => e.type === 'handoff.created' && e.payload.name === 'h1');
  expect(h1).toBeDefined();
  await page.goto(`/t/T-0042?tab=terminal&asOf=${encodeURIComponent(h1?.ts ?? '')}&at=${h1?.seq}`);
  await expect(page.getByTestId('red-flag')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const found = await axe(page);
  expect(found, found.join('\n')).toEqual([]);
});
