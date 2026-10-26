import { expect, test } from 'bun:test';
import type { Adapter, RunContext, RunResult } from '../src/index';
import { fakeModels, setup, steps, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

const RED_UNTIL_BUILT = `if [ -f src/lib/limiter.ts ]; then printf ' 2 pass\\n 0 fail\\n'; exit 0; else printf '(fail) limiter > answers 429 [1ms]\\n 1 pass\\n 1 fail\\n'; exit 1; fi`;
const ALWAYS_GREEN = `printf ' 3 pass\\n 0 fail\\n'`;

/** Writes the acceptance test when asked for tests, the limiter otherwise; `tamper` also edits the locked test while building. */
function implementer(tamper = false): Adapter {
  return {
    ...fakeAdapter('edit'),
    id: 'muse-code',
    async run(ctx: RunContext): Promise<RunResult> {
      const specifying = ctx.prompt.includes("Write tests for this task's acceptance criteria");
      if (specifying || tamper) await Bun.write(`${ctx.worktree}/test/acceptance.test.ts`, specifying ? "test('answers 429', () => { throw new Error('no limiter'); });\n" : "test('answers 429', () => {});\n");
      if (!specifying) await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
      return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 0, outputTokens: 20, usd: 0.001 } };
    },
  };
}

const settings = { implementers: ['muse-code'], maxHops: 3, parallel: 2, testsFirst: true };

test('With testsFirst on and fake adapters, the steps are plan, specify, build, verify, review, and acceptance.locked names the test file with its hash', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [implementer()], models, settings);
      const t = await ws.createTask(task(RED_UNTIL_BUILT));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['plan', 'specify', 'verify', 'build', 'verify', 'review']);
      const locked = events.find((e) => e.type === 'acceptance.locked')?.payload;
      expect(locked).toMatchObject({ files: [{ path: 'test/acceptance.test.ts', sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }], failing: ['limiter > answers 429'] });
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload.reason).toBe('Waiting for your approval.');
      expect(events.some((e) => e.type === 'acceptance.tampered')).toBe(false);
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('A specify run whose tests already pass stops autopilot with the "pass before any change" reason', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [implementer()], models, settings);
      const t = await ws.createTask(task(ALWAYS_GREEN));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['plan', 'specify']);
      expect(String(events.find((e) => e.type === 'autopilot.stopped')?.payload.reason)).toContain('the acceptance tests pass before any change');
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('A build run that edits a locked test file records acceptance.tampered and stops autopilot', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [implementer(true)], models, settings);
      const t = await ws.createTask(task(RED_UNTIL_BUILT));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(events.find((e) => e.type === 'acceptance.tampered')?.payload).toMatchObject({ files: ['test/acceptance.test.ts'] });
      expect(String(events.find((e) => e.type === 'autopilot.stopped')?.payload.reason)).toMatch(/^Needs you: muse-code r\d+ changed the acceptance tests \(test\/acceptance\.test\.ts\)\.$/);
    });
  } finally {
    models.stop();
  }
}, 180_000);
