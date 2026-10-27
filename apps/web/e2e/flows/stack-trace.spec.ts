import { expect, test } from '@playwright/test';
import { daemon } from './daemon';

type Task = { id: string };

// The flows fixture's tests are shell one-liners, so a recorded Vitest failure stands in for the output request.
test('A failing verification shows a Stack Trace with the test, its message and the first project frame', async ({ page, request }) => {
  const d = daemon(request);
  const t = await d.post<Task>('/api/tasks', { title: 'Flow: stack trace', goal: 'Show the failure plainly.', acceptance: ['the stack trace names the failing test'], testCommand: 'false' });
  await d.post(`/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
  await d.until(t.id, (ev) => ev.some((e) => e.type === 'verification.ran' && e.payload.status === 'red'));

  const output = [
    ' RUN  v3.2.0',
    ' FAIL  test/ratelimit.test.ts > rate limit > answers 429 over the limit',
    'AssertionError: expected 200 to be 429',
    ' ❯ test/ratelimit.test.ts:42:18',
    ` ❯ src/lib/${t.id}.ts:3:7`,
    ' ❯ node_modules/vitest/dist/runner.js:10:2',
    '    at node:internal/main/run_main_module:28:49',
    '',
    ' Test Files  1 failed | 3 passed (4)',
    '      Tests  1 failed | 32 passed (33)',
  ].join('\n');
  await page.route(`**/api/tasks/${t.id}/verification/*/output`, (route) => route.fulfill({ contentType: 'text/plain', body: output }));

  await page.goto(`/t/${t.id}?tab=verification`);
  const trace = page.getByTestId('stack-trace');
  await expect(trace).toBeVisible();
  await expect(trace.getByTestId('stack-name')).toContainText('answers 429 over the limit');
  await expect(trace.getByTestId('stack-message')).toContainText('expected 200 to be 429');
  await expect(trace.getByTestId('stack-first-frame')).toContainText('test/ratelimit.test.ts:42:18');

  // a frame in a file this run changed links to that file in the diff
  const link = trace.getByTestId('stack-diff-link');
  await expect(link).toContainText(`src/lib/${t.id}.ts:3:7`);
  expect(await link.getAttribute('href')).toContain(`tab=diff&file=${encodeURIComponent(`src/lib/${t.id}.ts`)}`);

  // library frames wait behind the toggle, and the raw output is still there
  await expect(trace).not.toContainText('node_modules/vitest/dist/runner.js:10:2');
  await trace.getByTestId('stack-library-toggle').click();
  await expect(trace).toContainText('node_modules/vitest/dist/runner.js:10:2');
  await expect(trace).toContainText('node:internal/main/run_main_module:28:49');
  await page.getByTestId('toggle-output').click();
  await expect(page.getByTestId('verification-output')).toContainText('AssertionError: expected 200 to be 429');
});
