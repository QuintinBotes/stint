import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { daemonContext } from '../src/app';
import type { Adapter, RunResult } from '../src/index';
import { assessRisk, laneOpen, policyWould } from '../src/risk';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

/** One agent whose edit depends on the task's title, so each tier comes from a real diff. */
const edits: Record<string, (wt: string) => Promise<void>> = {
  small: (wt) => Bun.write(`${wt}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n').then(() => undefined),
  auth: (wt) => Bun.write(`${wt}/src/auth/session.ts`, 'export const TTL = 3600;\n').then(() => undefined),
  'drop tests': async (wt) => rmSync(`${wt}/test/webhooks.test.ts`),
  big: (wt) => Bun.write(`${wt}/src/lib/table.ts`, Array.from({ length: 450 }, (_, i) => `export const V${i} = ${i};`).join('\n')).then(() => undefined),
  spread: async (wt) => {
    for (let i = 0; i < 6; i++) await Bun.write(`${wt}/src/lib/part${i}.ts`, `export const P${i} = ${i};\n`);
  },
  entry: (wt) => Bun.write(`${wt}/src/index.ts`, 'export * from "./app";\n').then(() => undefined),
};
const agent: Adapter = {
  ...fakeAdapter('edit'),
  async run(ctx): Promise<RunResult> {
    await edits[ctx.task.title]?.(ctx.worktree);
    return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
  },
};

test('Risk tiers come from the diff and the reviews: sensitive paths, deleted tests and big changes are high; many files or an entry point medium; else low', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [agent]);
    const ctx = daemonContext(app);
    const tierOf = async (title: string) => {
      const t = await ws.createTask({ title, goal: 'Change something.', acceptance: ['changed'], testCommand: 'true' });
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      for (let i = 0; i < 600 && (ctx.runs.get(t.id) || !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran')); i++) await Bun.sleep(50);
      return assessRisk(ctx, t.id);
    };
    expect(await tierOf('small')).toEqual({ tier: 'low', reasons: ['1 file, 1 lines, nothing sensitive'] });
    expect(await tierOf('auth')).toEqual({ tier: 'high', reasons: ['touches src/auth/session.ts'] });
    expect((await tierOf('drop tests')).reasons).toEqual(['deletes tests: test/webhooks.test.ts']);
    expect((await tierOf('big')).reasons).toEqual(['450 changed lines, over 400']);
    expect(await tierOf('spread')).toEqual({ tier: 'medium', reasons: ['6 files, over 5'] });
    expect(await tierOf('entry')).toEqual({ tier: 'medium', reasons: ['changes what other code calls: src/index.ts'] });
  });
}, 120_000);

test('The policy would approve only an assessed tier in the lane with green tests and an approving review', () => {
  const ev = (type: string, payload: Record<string, unknown>) => ({ type, payload, ts: new Date().toISOString() }) as never;
  const task = { id: 'T-0001' } as never;
  const good = [ev('verification.ran', { status: 'green' }), ev('review.recorded', { verdict: 'approve' }), ev('risk.assessed', { tier: 'low' })];
  expect(policyWould(task, good, ['low'])).toEqual({ would: true, why: 'low risk, tests green, the review approves' });
  expect(policyWould(task, good, ['medium']).would).toBe(false);
  expect(policyWould(task, [ev('verification.ran', { status: 'green' }), ev('review.recorded', { verdict: 'request_changes' }), ev('risk.assessed', { tier: 'low' })], ['low']).why).toBe('the review says request_changes');
  expect(policyWould(task, [...good, ev('verification.tampered', {})], ['low']).why).toBe('an agent changed the locked tests');
});

test('The lane stays shut while it is off, with too few shadow decisions, or a window not yet covered', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [agent]);
    const ctx = daemonContext(app);
    expect((await laneOpen(ctx, 'low')).why).toBe('the auto-approve lane is off');
    ws.config.risk = { highPaths: [], autoApprove: { enabled: true, tiers: ['low'], shadowDays: 7 } };
    expect((await laneOpen(ctx, 'medium')).why).toBe('medium risk is not in the lane');
    expect((await laneOpen(ctx, 'low')).why).toBe('0 shadow decisions on low risk, fewer than 3');
  });
}, 60_000);
