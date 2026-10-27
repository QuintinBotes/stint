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
