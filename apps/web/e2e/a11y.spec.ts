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
  await expect(page.getByPlaceholder('Search or run a command')).toBeFocused();
  const found = await axe(page);
  expect(found, found.join('\n')).toEqual([]);
});

test('The task view rewound to the kill, on the terminal tab, has no WCAG A or AA violations', async ({ page }) => {
  const { events } = (await (await page.request.get('/api/tasks/T-0042/events')).json()) as { events: Array<{ seq: number; ts: string; type: string; payload: Record<string, unknown> }> };
  const h1 = events.find((e) => e.type === 'handoff.created' && e.payload.name === 'h1');
  expect(h1).toBeDefined();
  await page.goto(`/t/T-0042?tab=terminal&asOf=${encodeURIComponent(h1?.ts ?? '')}&at=${h1?.seq}`);
  await expect(page.getByTestId('kill-notice')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const found = await axe(page);
  expect(found, found.join('\n')).toEqual([]);
});

test('The Add skill dialog, on each tab and with a preview, has no WCAG A or AA violations and no sideways scroll at 390 px', async ({ page }) => {
  await page.goto('/skills');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('add-skill').click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await dialog.getByTestId('skill-file').setInputFiles({ name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: a11y-check\ndescription: Checks the dialog.\n---\n\nRun scripts/run.sh first; see https://example.com for more.\n') });
  await expect(dialog.getByTestId('skill-preview')).toBeVisible();
  await dialog.getByTestId('add-skill-tab-write').click();
  await dialog.getByTestId('skill-name').fill('a11y-check');
  await dialog.getByTestId('skill-description').fill('Checks the dialog.');
  for (const tab of ['Upload', 'From git', 'Write']) {
    await dialog.getByRole('tab', { name: tab }).click();
    const found = await axe(page);
    expect(found, `${tab}: ${found.join('\n')}`).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['Upload', 'From git', 'Write']) {
    await dialog.getByRole('tab', { name: tab }).click();
    const sideways = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sideways, tab).toBeLessThanOrEqual(0);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-skill')).toBeFocused();
});
