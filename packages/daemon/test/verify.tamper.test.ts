import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunContext, RunResult } from '../src/index';
import { fakeModels, setup } from './autopilot.fixtures';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

const GREEN = `printf ' 2 pass\\n 0 fail\\n'`;
const LOCKED = 'test/backoff.test.ts';

/** Edits a test file the plan-time lock covers; `explain` also records the escape-hatch decision. */
function tamperer(explain = false): Adapter {
  return {
    ...fakeAdapter('edit'),
    id: 'fake',
    async run(ctx: RunContext): Promise<RunResult> {
      const file = join(ctx.worktree, LOCKED);
      await Bun.write(file, `${readFileSync(file, 'utf8')}\n// the cap is read from the environment now\n`);
      await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
      if (explain) {
        await ctx.emit({ type: 'agent.message', payload: { text: `decision: tests: ${LOCKED} changed because the backoff cap is read from the environment now` } });
      }
      return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 0, outputTokens: 20, usd: 0.001 } };
    },
  };
}

async function untilVerified(ws: Awaited<ReturnType<typeof makeApp>>['ws'], id: string) {
  for (let i = 0; i < 600; i++) {
    const events = await ws.events(id).read();
    if (events.some((e) => e.type === 'handoff.created')) return events;
    await Bun.sleep(50);
  }
  return ws.events(id).read();
}

test('A run that edits a locked test file without a decision ends with verification.tampered and a red verification even though the tests pass', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [tamperer()]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After', `${LOCKED} still passes`], testCommand: GREEN });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilVerified(ws, t.id);

    // the first assign (no plan) locked the test files the task names, in one lock file
    expect(events.find((e) => e.type === 'acceptance.locked')?.payload).toMatchObject({ scope: 'plan' });
    const lockFile = join(await ws.taskDir(t.id), 'tests.lock.json');
    expect(existsSync(lockFile)).toBe(true);
    const locked = JSON.parse(readFileSync(lockFile, 'utf8')) as Array<{ path: string; sha256: string }>;
    expect(locked).toContainEqual({ path: LOCKED, sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });

    const tampered = events.find((e) => e.type === 'verification.tampered');
    expect(tampered?.payload).toMatchObject({ run: 'r1', files: [LOCKED] });
    expect(tampered?.payload.allowedBy).toBeUndefined();

    const v = await ws.verification(t.id).latest();
    expect(v).toMatchObject({ status: 'red', passed: 2, failed: 0, tamper: { files: [LOCKED] } });
    expect(events.find((e) => e.type === 'verification.ran')?.payload).toMatchObject({ status: 'red', reason: 'tampered', tamper: { files: [LOCKED] } });

    const approve = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(approve.status).not.toBe(200);
  });
}, 180_000);

test('The same edit with a decision: tests: test/x.test.ts changed because ... line is allowed and the card reads the decision', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [tamperer(true)]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After', `${LOCKED} still passes`], testCommand: GREEN });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilVerified(ws, t.id);

    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('green');
    expect(v?.tamper?.files).toEqual([LOCKED]);
    expect(v?.tamper?.allowedBy).toContain(`tests: ${LOCKED} changed because`);
    const tampered = events.find((e) => e.type === 'verification.tampered');
    expect(tampered?.payload.allowedBy).toContain(`tests: ${LOCKED} changed because`);
    expect(events.find((e) => e.type === 'verification.ran')?.payload.status).toBe('green');
  });
}, 180_000);

test('hash at plan time: when plan.json is written, the test files named by the plan and the task are locked with scope plan', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [fakeAdapter('edit')], models);
      const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After', `${LOCKED} still passes`], testCommand: GREEN });
      const res = await post(app, `/api/tasks/${t.id}/plan`, {});
      expect(res.status).toBe(200);
      const events = await ws.events(t.id).read();
      const lockedEvent = events.find((e) => e.type === 'acceptance.locked');
      expect(lockedEvent?.payload.scope).toBe('plan');
      const files = (lockedEvent?.payload.files as Array<{ path: string }>).map((f) => f.path);
      expect(files).toEqual([LOCKED]);
      // the plan names test/limiter.test.ts, which does not exist yet; a test nobody named is not locked
      expect(files).not.toContain('test/limiter.test.ts');
      expect(files).not.toContain('test/config.test.ts');
      const lock = JSON.parse(readFileSync(join(await ws.taskDir(t.id), 'tests.lock.json'), 'utf8')) as Array<{ path: string }>;
      expect(lock.map((f) => f.path).sort()).toEqual([...files].sort());
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('a decision that names only some changed locked files does not allow the rest', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter: Adapter = {
      ...fakeAdapter('edit'),
      id: 'fake',
      async run(ctx: RunContext): Promise<RunResult> {
        for (const p of [LOCKED, 'test/config.test.ts']) {
          const file = join(ctx.worktree, p);
          await Bun.write(file, `${readFileSync(file, 'utf8')}\n// touched\n`);
        }
        await ctx.emit({ type: 'agent.message', payload: { text: `decision: tests: ${LOCKED} changed because the cap moved` } });
        return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [adapter]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429', `${LOCKED} and test/config.test.ts keep passing`], testCommand: GREEN });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    await untilVerified(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v?.status).toBe('red');
    expect(v?.tamper?.files.sort()).toEqual([LOCKED, 'test/config.test.ts'].sort());
    expect(v?.tamper?.allowedBy).toBeUndefined();
  });
}, 180_000);

test('A new case added to a test file nobody named is not tampering: the card says the locked tests are unchanged', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter: Adapter = {
      ...fakeAdapter('edit'),
      id: 'fake',
      async run(ctx: RunContext): Promise<RunResult> {
        const file = join(ctx.worktree, 'test/webhooks.test.ts');
        await Bun.write(file, `${readFileSync(file, 'utf8')}\n// a new case for the limiter\n`);
        return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [adapter]);
    const t = await ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429', `${LOCKED} still passes`], testCommand: GREEN });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await untilVerified(ws, t.id);
    const v = await ws.verification(t.id).latest();
    expect(v).toMatchObject({ status: 'green', tamper: null });
    expect(events.some((e) => e.type === 'verification.tampered')).toBe(false);
  });
}, 180_000);
