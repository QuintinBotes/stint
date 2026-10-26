import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG, type StintEvent } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

const PLAN = {
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Add a per-tenant limiter', files: ['src/lib/limiter.ts'], test: 'test/limiter.test.ts' }],
  filesToTouch: ['src/lib/limiter.ts'],
  risks: [],
  decisions: [],
  similarTasks: [],
};
const APPROVE = { version: 'stint.review/1', verdict: 'approve', summary: 'Looks right.', findings: [], blockers: [] };

/** Plays the planner and the reviewer: answers plan or review by the schema it is asked for. */
function fakeModels() {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const review = JSON.stringify((await req.json()) as unknown).includes('"verdict"');
        asked.push(review ? 'review' : 'plan');
        return Response.json({ message: { content: JSON.stringify(review ? APPROVE : PLAN) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, stop: () => server.stop(true) };
}

async function setup(repo: string, adapters: Adapter[], models: { url: string }, autopilot?: Config['autopilot']) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: models.url, models: { fake: 'fake' } };
  config.routes.planner = ['ollama/fake'];
  config.routes.reviewer = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  if (autopilot) config.autopilot = autopilot;
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  return makeApp(repo, adapters);
}

const task = (testCommand: string, title = 'Rate-limit incoming webhooks') => ({ title, goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After'], testCommand });

async function until(ws: Workspace, id: string, done: (events: StintEvent[]) => boolean, ms = 60_000): Promise<StintEvent[]> {
  const end = Date.now() + ms;
  for (;;) {
    const events = await ws.events(id).read();
    if (done(events) || Date.now() > end) return events;
    await Bun.sleep(50);
  }
}
const stopped = (events: StintEvent[]) => events.some((e) => e.type === 'autopilot.stopped');
const steps = (events: StintEvent[]) => events.filter((e) => e.type === 'autopilot.step').map((e) => e.payload.step);

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
