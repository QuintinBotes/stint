import { expect, test } from 'bun:test';
import type { StintEvent } from '@stint-dev/core';
import type { Adapter, RunResult } from '../src/index';
import { fakeModels, setup, steps, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

/** An implementer that ends killed straight away, as if someone stopped it. */
const dies: Adapter = {
  ...fakeAdapter('edit'),
  id: 'muse-code',
  async run(): Promise<RunResult> {
    return { endedBy: 'killed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 }, inFlight: 'write_file src/lib/limiter.ts' };
  },
};

test('With fake adapters, a task on autopilot goes planned to awaiting_approval with events plan, build, verify, review in order and no approval', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const t = await ws.createTask(task('true'));
      expect((await post(app, `/api/tasks/${t.id}/autopilot`, { on: true })).status).toBe(200);
      const events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['plan', 'build', 'verify', 'review']);
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload).toMatchObject({ reason: 'Waiting for your approval.', needsYou: false });
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
      expect(events.some((e) => e.type === 'approval.granted' || e.type === 'merge.completed')).toBe(false);
      expect(models.asked).toEqual(['plan', 'review']);
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('A fake implementer that ends killed is followed by a hand to the next implementer from the packet the kill built', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [dies, { ...fakeAdapter('edit'), id: 'stint-agent' }], models);
      const t = await ws.createTask(task('true'));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      const killed = events.find((e) => e.type === 'run.finished' && e.payload.endedBy === 'killed');
      const packet = events.find((e) => e.type === 'handoff.created' && e.run === killed?.run);
      const second = events.find((e) => e.type === 'run.started' && e.adapter === 'stint-agent');
      expect(packet?.payload.name).toBeString();
      expect(second?.payload.handoffFrom).toBe(packet?.payload.name);
      expect(events.find((e) => e.type === 'autopilot.step' && e.payload.step === 'hand')?.payload).toMatchObject({ from: 'muse-code', to: 'stint-agent', handoffFrom: packet?.payload.name });
      expect(steps(events)).toEqual(['plan', 'build', 'hand', 'verify', 'review']);
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('Two red runs in a row with no progress stop autopilot with "Needs you" and the same failing tests named', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }], models);
      const t = await ws.createTask(task("printf '(fail) limiter > answers 429 [2.1ms]\\n 3 pass\\n 1 fail\\n'; exit 1"));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['plan', 'build', 'hand']);
      const stop = events.find((e) => e.type === 'autopilot.stopped')?.payload;
      expect(stop?.needsYou).toBe(true);
      expect(String(stop?.reason)).toBe('Needs you: two agents in a row got no further. The same test fails: limiter > answers 429.');
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('Three red hops that each make progress stop autopilot at the hop limit with "Needs you" and the reason', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }], models);
      // every run adds a commit, so the passing count rises each time: progress, but never green
      const t = await ws.createTask(task("printf ' %s pass\\n 1 fail\\n' \"$(git rev-list --count HEAD)\"; exit 1"));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['plan', 'build', 'hand', 'hand', 'hand']);
      const stop = events.find((e) => e.type === 'autopilot.stopped')?.payload;
      expect(String(stop?.reason)).toMatch(/^Needs you: (muse-code|stint-agent) r\d+ finished with a red verification, after 3 handoffs\.$/);
      expect(models.asked).toEqual(['plan']);
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('Two tasks on autopilot with parallel: 1 run one after the other, the second shown queued', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models, { implementers: ['muse-code'], maxHops: 3, parallel: 1 });
      const a = await ws.createTask(task('true', 'First task'));
      const b = await ws.createTask(task('true', 'Second task'));
      await post(app, `/api/tasks/${a.id}/autopilot`, { on: true });
      await until(ws, a.id, (ev) => ev.some((e) => e.type === 'autopilot.step'));
      await post(app, `/api/tasks/${b.id}/autopilot`, { on: true });
      // until its first step the second task is starting, which health counts as running; wait for that step
      await until(ws, b.id, (ev) => ev.some((e) => e.type === 'autopilot.step'));
      const health = (await (await app.request('/api/health')).json()) as { autopilot: { running: string[]; queued: string[] } };
      expect(health.autopilot).toEqual({ running: [a.id], queued: [b.id] });
      const first = await until(ws, a.id, stopped);
      const second = await until(ws, b.id, stopped);
      expect(steps(second)).toEqual(['wait', 'plan', 'build', 'verify', 'review']);
      const aStopped = first.find((e) => e.type === 'autopilot.stopped') as StintEvent;
      const bPlan = second.find((e) => e.type === 'autopilot.step' && e.payload.step === 'plan') as StintEvent;
      expect(bPlan.ts >= aStopped.ts).toBe(true);
      expect(second.find((e) => e.type === 'autopilot.step')?.payload).toMatchObject({ step: 'wait', queued: true });
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('Run all puts every planned task on autopilot and each reaches the approval gate', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models, { implementers: ['muse-code'], maxHops: 3, parallel: 1 });
      const a = await ws.createTask(task('true', 'First task'));
      const b = await ws.createTask(task('true', 'Second task'));
      const res = (await (await post(app, '/api/autopilot', { on: true })).json()) as { tasks: string[] };
      expect(res.tasks).toEqual([a.id, b.id]);
      await until(ws, a.id, stopped);
      await until(ws, b.id, stopped);
      expect((await ws.readTask(a.id)).status).toBe('awaiting_approval');
      expect((await ws.readTask(b.id)).status).toBe('awaiting_approval');
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('With autopilot.onCreate, a task created through the daemon starts on autopilot by itself', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models, { implementers: ['muse-code'], maxHops: 3, parallel: 2, onCreate: true });
      const created = (await (await post(app, '/api/tasks', task('true', 'Starts itself'))).json()) as { id: string };
      const events = await until(ws, created.id, stopped);
      expect(events[1]?.type === 'autopilot.started' || events.some((e) => e.type === 'autopilot.started')).toBe(true);
      expect((await ws.readTask(created.id)).status).toBe('awaiting_approval');
    });
  } finally {
    models.stop();
  }
}, 180_000);
