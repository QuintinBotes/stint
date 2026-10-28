import { expect, test } from 'bun:test';
import { type Cost, DEFAULT_CONFIG, type Limits, LIMIT_DEFAULTS, type StintEvent, type Task } from '@stint-dev/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTOPILOT_DEFAULTS, nextStep } from '../src/index';
import { fakeModels, setup, stopped, task as newTask, until } from './autopilot.fixtures';
import { TOKEN, fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

const cost = (usd: number): Cost => ({ inputTokens: 100, cachedTokens: 0, outputTokens: 10, usd });
const task = { id: 'T-0001', status: 'building', tags: [], budgets: { planner: 1, implementer: 1, reviewer: 1 } } as unknown as Task;
const limits = (l: Partial<Limits>): Limits => ({ ...LIMIT_DEFAULTS, ...l });

type Line = Partial<StintEvent> & { type: string };
const log = (lines: Line[]): StintEvent[] => lines.map((l, i) => ({ id: `E${i}`, seq: i + 1, ts: new Date(Date.UTC(2026, 9, 28, 10, i)).toISOString(), task: 'T-0001', payload: {}, ...l }) as StintEvent);
const planned: Line[] = [
  { type: 'run.started', run: 'r1', payload: { role: 'planner' } },
  { type: 'run.finished', run: 'r1', payload: { endedBy: 'completed', cost: cost(0) } },
];
/** An implementer run that ends with a red or green verification. */
const build = (run: string, green: boolean, usd = 0, adapter = 'muse-code'): Line[] => [
  { type: 'run.started', run, adapter, payload: { role: 'implementer' } },
  { type: 'run.finished', run, adapter, payload: { endedBy: 'completed', cost: cost(usd) } },
  { type: 'verification.ran', run, payload: { status: green ? 'green' : 'red', passed: green ? 1 : Number(run.slice(1)), failed: green ? 0 : 1 } },
];
const asks: Line = { type: 'review.recorded', payload: { verdict: 'request_changes', review: { verdict: 'request_changes', findings: [{ text: 'Name it LIMIT.' }] } } };
const step = (kind: string, extra: Record<string, unknown> = {}): Line => ({ type: 'autopilot.step', payload: { step: kind, ...extra } });

test('With builds: 2, two failed builds stop with limit builds rather than a hand-off, and a restart of autopilot does not reset the count', () => {
  const once = log([{ type: 'autopilot.started' }, ...planned, step('build'), ...build('r2', false), step('hand'), ...build('r3', false, 0, 'stint-agent')]);
  expect(nextStep(once, task, AUTOPILOT_DEFAULTS, false, limits({})).kind).toBe('hand');
  expect(nextStep(once, task, AUTOPILOT_DEFAULTS, false, limits({ builds: 2 }))).toEqual({ kind: 'stop', needsYou: true, limit: 'builds', used: 2, cap: 2, reason: 'Needs you: the build limit is reached (2 of 2).' });
  const restarted = log([
    { type: 'autopilot.started' },
    ...planned,
    step('build'),
    ...build('r2', false),
    { type: 'autopilot.stopped', payload: { reason: 'Turned off by you.' } },
    { type: 'autopilot.started' },
    step('hand'),
    ...build('r3', false, 0, 'stint-agent'),
  ]);
  expect(nextStep(restarted, task, AUTOPILOT_DEFAULTS, false, limits({ builds: 2 }))).toMatchObject({ kind: 'stop', limit: 'builds', used: 2 });
  // no limit is no limit
  expect(nextStep(restarted, task, AUTOPILOT_DEFAULTS, false, limits({ builds: null })).kind).toBe('hand');
});

test('With usd: 1, builds at $0.40 and $0.50 stop before a third build; with no earlier build and $0.20 spent it builds', () => {
  const two = log([{ type: 'autopilot.started' }, ...planned, step('build'), ...build('r2', false, 0.4), step('hand'), ...build('r3', false, 0.5, 'stint-agent')]);
  expect(nextStep(two, task, AUTOPILOT_DEFAULTS, false, limits({ usd: 1 }))).toEqual({
    kind: 'stop',
    needsYou: true,
    limit: 'usd',
    used: 0.9,
    cap: 1,
    reason: 'Needs you: the next build would pass the $1.00 spend limit ($0.90 spent; builds here cost about $0.45).',
  });
  // spend alone, under the limit, would let it go on
  expect(nextStep(two, task, AUTOPILOT_DEFAULTS, false, limits({ usd: 2 })).kind).toBe('hand');
  const none = log([{ type: 'autopilot.started' }, { type: 'run.started', run: 'r1', payload: { role: 'planner' } }, { type: 'run.finished', run: 'r1', payload: { endedBy: 'completed', cost: cost(0.2) } }]);
  expect(nextStep(none, task, AUTOPILOT_DEFAULTS, false, limits({ usd: 1 })).kind).toBe('build');
  // once spend reaches the limit nothing new starts, not even a review
  expect(nextStep(log([...none.map((e) => ({ ...e }) as Line), ...build('r2', true, 0.8)]), task, AUTOPILOT_DEFAULTS, false, limits({ usd: 1 }))).toMatchObject({ kind: 'stop', limit: 'usd', reason: 'Needs you: the $1.00 spend limit is reached ($1.00 spent).' });
});

test('With reviewRounds: 2 a second changes build is allowed and the third request stops; the default stops after one round with the old words', () => {
  const lines: Line[] = [{ type: 'autopilot.started' }, ...planned, step('build'), ...build('r2', true), asks];
  expect(nextStep(log(lines), task, AUTOPILOT_DEFAULTS, false, limits({ reviewRounds: 2 }))).toMatchObject({ kind: 'build', ask: 'Name it LIMIT.' });
  lines.push(step('build', { changes: true }), ...build('r3', true), asks);
  expect(nextStep(log(lines), task, AUTOPILOT_DEFAULTS, false, limits({ reviewRounds: 2 }))).toMatchObject({ kind: 'build', ask: 'Name it LIMIT.' });
  expect(nextStep(log(lines), task, AUTOPILOT_DEFAULTS, false, limits({}))).toEqual({ kind: 'stop', needsYou: true, limit: 'reviewRounds', used: 1, cap: 1, reason: 'Needs you: the review still asks for changes after one round.' });
  lines.push(step('build', { changes: true }), ...build('r4', true), asks);
  expect(nextStep(log(lines), task, AUTOPILOT_DEFAULTS, false, limits({ reviewRounds: 2 }))).toMatchObject({ kind: 'stop', limit: 'reviewRounds', used: 2, cap: 2, reason: 'Needs you: the review still asks for changes after 2 rounds.' });
});

test('With minutes: 10, nothing new starts once the task has used 10 minutes of agent time', () => {
  const long = log([{ type: 'autopilot.started' }, { type: 'run.started', run: 'r1', payload: { role: 'planner' } }, ...Array.from({ length: 10 }, (): Line => ({ type: 'agent.message' })), { type: 'run.finished', run: 'r1', payload: { endedBy: 'completed', cost: cost(0) } }]);
  expect(nextStep(long, task, AUTOPILOT_DEFAULTS, false, limits({ minutes: 20 })).kind).toBe('build');
  expect(nextStep(long, task, AUTOPILOT_DEFAULTS, false, limits({ minutes: 10 }))).toMatchObject({ kind: 'stop', limit: 'minutes', reason: 'Needs you: the agent time limit is reached (11 of 10 min).' });
});

test('A task created with builds: 1 stops after one failed build with limit.reached and the stop naming the limit; its status is not changed', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }], models);
      const res = await post(app, '/api/tasks', { ...newTask("printf ' 0 pass\\n 1 fail\\n'; exit 1"), limits: { builds: 1 } });
      expect(res.status).toBe(201);
      const t = (await res.json()) as Task;
      expect(t.limits).toEqual({ builds: 1 });
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      const reached = events.find((e) => e.type === 'limit.reached');
      expect(reached?.payload).toEqual({ limit: 'builds', used: 1, cap: 1 });
      const stop = events.find((e) => e.type === 'autopilot.stopped');
      expect(stop?.payload).toEqual({ reason: 'Needs you: the build limit is reached (1 of 1).', needsYou: true, limit: 'builds' });
      expect(stop?.seq).toBe((reached?.seq ?? 0) + 1);
      const before = events.filter((e) => e.type === 'task.status').at(-1)?.payload.to;
      expect((await ws.readTask(t.id)).status).toBe(before as Task['status']);
      expect((await post(app, '/api/tasks', { ...newTask('true'), limits: { builds: 0 } })).status).toBe(400);
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('PATCH /api/tasks/:id/limits needs the token, answers 400 naming a bad field, and writes task.json and limits.changed by a person', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const t = await ws.createTask({ title: 'Limits', goal: 'Change them.', acceptance: ['changed'], limits: { builds: 1 } });
    const patch = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) =>
      app.request(`/api/tasks/${t.id}/limits`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await patch({ builds: 2 }, {})).status).toBe(401);
    for (const [body, field] of [
      [{ builds: 0 }, 'builds'],
      [{ usd: 'lots' }, 'usd'],
      [{ turns: 3 }, 'turns'],
    ] as const) {
      const bad = await patch(body);
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: { message: string } }).error.message).toStartWith(`${field}:`);
    }
    expect((await ws.events(t.id).read()).some((e) => e.type === 'limits.changed')).toBe(false);
    const ok = await patch({ builds: 2, usd: 3, minutes: null });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ limits: { builds: 2, handoffs: DEFAULT_CONFIG.autopilot?.maxHops, reviewRounds: 1, usd: 3, minutes: null }, used: { builds: 0 }, own: { builds: 2, usd: 3, minutes: null } });
    const onDisk = JSON.parse(readFileSync(join(await ws.taskDir(t.id), 'task.json'), 'utf8')) as Task;
    expect(onDisk.limits).toEqual({ builds: 2, usd: 3, minutes: null });
    const changed = (await ws.events(t.id).read()).find((e) => e.type === 'limits.changed');
    expect(changed).toMatchObject({ vendor: 'human', payload: { from: { builds: 1 }, to: { builds: 2, usd: 3, minutes: null }, by: 'you' } });
    // raising a limit does not put the task on autopilot
    expect((await ws.events(t.id).read()).some((e) => e.type === 'autopilot.started')).toBe(false);
    expect(((await (await app.request(`/api/tasks/${t.id}/limits`)).json()) as { limits: Limits }).limits.builds).toBe(2);
  });
});
