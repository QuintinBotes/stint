import { expect, test } from 'bun:test';
import { execInGroup, failingTests, parseTestSummary } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('a test run that prints 5 MB keeps a 64 KB head and a 512 KB tail, and its counts and failing names still parse', async () => {
  const print = `head -c 5000000 /dev/zero | tr '\\0' x; echo; echo '(fail) limiter > answers 429'; echo ' 26 pass'; echo ' 1 fail'`;
  const r = await execInGroup(print, process.cwd(), { PATH: process.env.PATH ?? '' }, 30_000);
  expect(r.exitCode).toBe(0);
  expect(r.output.length).toBeLessThan(64 * 1024 + 512 * 1024 + 200);
  expect(r.output).toContain('bytes of output were left out here');
  expect(r.output.startsWith('x'.repeat(64 * 1024))).toBe(true);
  expect(parseTestSummary(r.output)).toEqual({ passed: 26, failed: 1 });
  expect(failingTests(r.output)).toEqual(['limiter > answers 429']);
}, 60_000);

test('two concurrent assigns of one task start one run; the other is refused with run_active', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('sleep')]);
    const t = await ws.createTask(newTask);
    const [a, b] = await Promise.all([1, 2].map(() => post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })));
    expect([a?.status, b?.status].sort()).toEqual([202, 409]);
    const refused = [a, b].find((r) => r?.status === 409) as Response;
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('run_active');
    expect((await ws.events(t.id).read()).filter((e) => e.type === 'run.started')).toHaveLength(1);
    const run = ((await [a, b].find((r) => r?.status === 202)?.json()) as { run: string }).run;
    expect((await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {})).status).toBe(202);
  });
}, 60_000);
