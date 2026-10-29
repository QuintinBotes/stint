import { expect, test } from 'bun:test';
import { LIMIT_DEFAULTS, type SharpenState, type StintEvent, type Task } from '@stint-dev/core';
import { type Workspace, costs } from '@stint-dev/core/node';
import { nextStep } from '../src/autopilot';
import { fakeModels, setup, stopped, task, until } from './autopilot.fixtures';
import { auth, fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';
import { plan, planner, writeConfig } from './plan.fixtures';

const GOAL = { title: 'Webhooks survive a noisy tenant', outcome: 'One noisy tenant slows only itself.', criteria: ['429 with Retry-After', 'Other tenants are served as before'], nonGoals: ['Billing for extra webhooks'] };

test('A goal is sharpened by the same engine as a task: its round and answers go to the workspace log with payload.goal, its answers to goal.decisions, and proofs make it ready', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const g = await ws.createGoal(GOAL);
      const res = await post(app, `/api/goals/${g.id}/sharpen`, {});
      expect(res.status).toBe(200);
      const st = (await res.json()) as SharpenState;
      expect(st).toMatchObject({ round: 1, open: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], openMaterial: ['Q1'], ready: false });
      // the prompt is about the goal, with its outcome, criteria and what is out of scope
      expect(models.prompts[0]).toContain('You sharpen a goal for Stint');
      expect(models.prompts[0]).toContain('Outcome: One noisy tenant slows only itself.');
      expect(models.prompts[0]).toContain('2. Other tenants are served as before');
      expect(models.prompts[0]).toContain('Not in scope: Billing for extra webhooks');

      const asked = (await ws.workspaceEvents().read()).find((e) => e.type === 'sharpen.asked');
      expect(asked).toMatchObject({ task: 'workspace', payload: { goal: g.id, round: 1, host: 'ollama', model: 'fake', dropped: [{ text: 'Which file holds the limiter?', reason: 'the repository can answer it' }] } });
      expect((await costs(ws, { group: 'model' })).find((r) => r.key === 'ollama/fake')?.roles).toEqual(['sharpen']);
      // a goal id names no task, and a task route does not take one
      expect((await app.request(`/api/tasks/${g.id}/sharpen`)).status).toBe(404);

      const answered = (await (await post(app, `/api/goals/${g.id}/sharpen/answer`, { question: 'Q1', option: 'Retries do not count' })).json()) as { decision: string };
      expect(answered.decision).toBe('D1');
      expect((await ws.readGoal(g.id)).decisions).toEqual([{ id: 'D1', text: 'Do retries of a failed webhook count towards the limit? Answer: Retries do not count', by: 'you', at: expect.any(String) }]);
      expect((await ws.workspaceEvents().read()).find((e) => e.type === 'sharpen.answered')).toMatchObject({ vendor: 'human', payload: { goal: g.id, question: 'Q1', decision: 'D1', by: 'you' } });

      const rec = (await (await post(app, `/api/goals/${g.id}/sharpen/recommended`, {})).json()) as { decisions: string[] };
      expect(rec.decisions).toEqual(['D2', 'D3', 'D4', 'D5']);
      // answered and nothing material open, but a criterion has no proof: still a draft
      expect((await ws.readGoal(g.id)).status).toBe('draft');

      const proofs = [
        { criterion: 1, kind: 'test', ref: '429 with Retry-After' },
        { criterion: 2, kind: 'human', ref: 'An operator watches a load test' },
      ];
      expect((await post(app, `/api/goals/${g.id}/proofs`, { proofs: [{ criterion: 3, kind: 'test', ref: 'x' }] })).status).toBe(400);
      expect((await post(app, `/api/goals/${g.id}/proofs`, { proofs })).status).toBe(200);
      const goal = await ws.readGoal(g.id);
      expect(goal.criteria).toEqual([
        { text: '429 with Retry-After', proof: { kind: 'test', ref: '429 with Retry-After' } },
        { text: 'Other tenants are served as before', proof: { kind: 'human', ref: 'An operator watches a load test' } },
      ]);
      expect(goal.status).toBe('ready');
      const ws2 = await ws.workspaceEvents().read();
      expect(ws2.find((e) => e.type === 'goal.status')?.payload).toMatchObject({ goal: g.id, from: 'draft', to: 'ready' });
      expect(((await (await app.request(`/api/goals/${g.id}/sharpen`)).json()) as SharpenState).ready).toBe(true);

      // changing an assumption again: the latest answer stands, and both stay in goal.decisions
      await post(app, `/api/goals/${g.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 30 seconds.' });
      await post(app, `/api/goals/${g.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 90 seconds.' });
      expect((await ws.readGoal(g.id)).decisions.map((d) => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
      expect((await post(app, `/api/goals/${g.id}/sharpen`, {}, {})).status).toBe(401);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('A goal made, sharpened, answered and split into two tasks: the proposal creates nothing, and each created task carries the goal, its criteria, the goal decisions and its share of the limits', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const made = await post(app, '/api/goals', { ...GOAL, limits: { usd: 5, builds: 5 } });
      expect(made.status).toBe(201);
      const g = (await made.json()) as { id: string; status: string };
      expect(g).toMatchObject({ id: 'G-0001', status: 'draft' });
      expect((await post(app, '/api/goals', { ...GOAL, criteria: [] })).status).toBe(400);
      expect((await post(app, '/api/goals', GOAL, {})).status).toBe(401);
      expect((await ws.workspaceEvents().read()).find((e) => e.type === 'goal.created')?.payload).toMatchObject({ goal: 'G-0001', title: GOAL.title });

      await post(app, `/api/goals/${g.id}/sharpen`, {});
      await post(app, `/api/goals/${g.id}/sharpen/answer`, { question: 'Q1', option: 'Retries do not count' });
      await post(app, `/api/goals/${g.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 30 seconds.' });
      // changed again: only the latest answer is copied into the tasks
      await post(app, `/api/goals/${g.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 90 seconds.' });

      const before = (await ws.listTasks()).length;
      const planned = await post(app, `/api/goals/${g.id}/plan`, {});
      expect(planned.status).toBe(200);
      const { tasks: proposal } = (await planned.json()) as { tasks: Array<{ title: string; covers: number[]; dependsOn: number[] }> };
      // the model's numbers that mean nothing are dropped: a criterion the goal does not have, a task waiting on itself
      expect(proposal.map((t) => [t.title, t.covers, t.dependsOn])).toEqual([
        ['Count webhooks per tenant', [1], []],
        ['Serve the other tenants', [2], [0]],
      ]);
      expect((await ws.listTasks()).length).toBe(before);
      expect(models.prompts.at(-1)).toContain('You split a goal into tasks for Stint');
      expect(models.prompts.at(-1)).toContain('Do retries of a failed webhook count towards the limit? Answer: Retries do not count');
      const plannedEvent = (await ws.workspaceEvents().read()).find((e) => e.type === 'goal.planned');
      expect(plannedEvent?.payload).toMatchObject({ goal: g.id, host: 'ollama', model: 'fake', cost: { inputTokens: 100 } });
      expect((await costs(ws, { group: 'model' })).find((r) => r.key === 'ollama/fake')?.roles).toEqual(['planner', 'sharpen']);
      // choosing to split makes a draft goal ready
      expect((await ws.readGoal(g.id)).status).toBe('ready');

      // the person edits a title before creating them; a split that names a criterion the goal lacks is refused
      const edited = proposal.map((t, i) => ({ ...t, ...(i === 1 ? { title: 'Serve every other tenant' } : {}) }));
      expect((await post(app, `/api/goals/${g.id}/tasks`, { tasks: [{ ...edited[0], covers: [3] }] })).status).toBe(400);
      expect((await post(app, `/api/goals/${g.id}/tasks`, { tasks: [{ ...edited[0], dependsOn: [0] }] })).status).toBe(400);
      const created = await post(app, `/api/goals/${g.id}/tasks`, { tasks: edited });
      expect(created.status).toBe(201);
      const { tasks } = (await created.json()) as { tasks: Array<{ id: string }> };
      const [a, b] = await Promise.all(tasks.map((t) => ws.readTask(t.id)));
      expect(a).toMatchObject({ title: 'Count webhooks per tenant', goalId: g.id, goalCriteria: [1], limits: { usd: 2.5, builds: 2 } });
      expect(b).toMatchObject({ title: 'Serve every other tenant', goalId: g.id, goalCriteria: [2], dependsOn: [a?.id] });
      for (const t of [a, b]) {
        const ledger = await ws.decisions(t?.id as string).read();
        expect(ledger.map((d) => [d.text, d.by])).toEqual([
          ['Do retries of a failed webhook count towards the limit? Answer: Retries do not count', 'goal'],
          ['Assumed: The window is 60 seconds. Changed to: The window is 90 seconds.', 'goal'],
        ]);
        expect(ledger[0]?.evidence).toEqual([`goal:${g.id}/D1`]);
      }
      const goal = await ws.readGoal(g.id);
      expect(goal).toMatchObject({ status: 'running', tasks: [a?.id, b?.id] });
      const events = await ws.workspaceEvents().read();
      expect(events.find((e) => e.type === 'goal.tasks_created')?.payload).toEqual({ goal: g.id, tasks: [a?.id, b?.id] });
      expect(events.filter((e) => e.type === 'goal.status').map((e) => [e.payload.from, e.payload.to])).toEqual([
        ['draft', 'ready'],
        ['ready', 'running'],
      ]);

      // the task's own plan starts from what the goal settled
      expect((await post(app, `/api/tasks/${a?.id}/plan`, {})).status).toBe(200);
      expect(models.prompts.at(-1)).toContain('Settled before work started:');
      expect(models.prompts.at(-1)).toContain('Answer: Retries do not count');

      // a person raises the goal's spend limit; the change is recorded, and the goal's builds stay as they were
      const raised = await app.request(`/api/goals/${g.id}/limits`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ usd: 8 }) });
      expect(raised.status).toBe(200);
      expect((await ws.readGoal(g.id)).limits).toEqual({ usd: 8, builds: 5 });
      expect((await ws.workspaceEvents().read()).find((e) => e.type === 'limits.changed')?.payload).toEqual({ goal: g.id, from: { usd: 5, builds: 5 }, to: { usd: 8, builds: 5 }, by: 'you' });

      // a person abandons it; an abandoned goal is not split again
      expect((await post(app, `/api/goals/${g.id}/abandon`, {})).status).toBe(200);
      expect((await ws.readGoal(g.id)).status).toBe('abandoned');
      expect((await post(app, `/api/goals/${g.id}/plan`, {})).status).toBe(400);
      expect((await post(app, '/api/goals/G-0009/plan', {})).status).toBe(404);
    });
  } finally {
    models.stop();
  }
}, 60_000);

/** A verification the daemon ran, red with the names that failed or green when none did, `secs` after a fixed start. */
async function verified(ws: Workspace, task: string, run: string, secs: number, failing: string[] = []) {
  const status = failing.length ? 'red' : 'green';
  const at = new Date(Date.parse('2026-10-29T10:00:00Z') + secs * 1000).toISOString();
  await ws.verification(task).write({ run, command: 'bun run test', exitCode: failing.length ? 1 : 0, passed: 3, failed: failing.length, durationMs: 100, runBy: 'daemon', status, outputRef: `verification/${run}.out.txt`, at });
  await ws.events(task).append({ task, run, vendor: 'daemon', type: 'verification.ran', payload: { status, passed: 3, failed: failing.length, failing } });
}

test("A goal's proofs reach the tasks that cover it: split, each task merged with a green verification, and the goal is done", async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const g = await ws.createGoal(GOAL);
      const proofs = [
        { criterion: 1, kind: 'test', ref: '429 with Retry-After' },
        { criterion: 2, kind: 'human', ref: 'An operator watches a load test' },
      ];
      expect((await post(app, `/api/goals/${g.id}/proofs`, { proofs })).status).toBe(200);
      const { tasks: proposal } = (await (await post(app, `/api/goals/${g.id}/plan`, {})).json()) as { tasks: unknown[] };
      const { tasks } = (await (await post(app, `/api/goals/${g.id}/tasks`, { tasks: proposal })).json()) as { tasks: Array<{ id: string }> };
      const [a, b] = (await Promise.all(tasks.map((t) => ws.readTask(t.id)))) as [Task, Task];
      // the first task already says criterion 1 in its own words, so the proof goes on that line; the second gets the line added
      expect([a.acceptance, a.proofs]).toEqual([['429 with Retry-After'], [{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }]]);
      expect([b.acceptance, b.proofs]).toEqual([['Other tenants get 200', 'Other tenants are served as before'], [{ criterion: 2, kind: 'human', ref: 'An operator watches a load test' }]]);
      expect((await ws.events(b.id).read()).find((e) => e.type === 'proofs.set')?.payload).toEqual({ proofs: b.proofs, from: [], goal: g.id });

      // the test fails first and passes after; the other task is green once; each is approved by a person and merged
      await verified(ws, a.id, 'r1', 0, ['webhooks > 429 with Retry-After']);
      await verified(ws, a.id, 'r2', 1);
      await verified(ws, b.id, 'r1', 2);
      for (const t of [a, b]) {
        await ws.events(t.id).append({ task: t.id, vendor: 'human', type: 'approval.granted', payload: { by: 'human' } });
        await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: t.branch, into: 'main', commit: 'abc1234' } });
        await ws.writeTask(t.id, { status: 'done' });
      }
      const view = (await (await app.request(`/api/goals/${g.id}`)).json()) as { goal: { status: string }; outcome: { result: string; met: number; criteria: Array<{ state: string; evidence: string }> } };
      expect(view.outcome.criteria.map((c) => [c.state, c.evidence])).toEqual([
        ['proven', `${a.id}: webhooks > 429 with Retry-After failed in r1 and passes in r2.`],
        ['checked_by_you', `${b.id}: Checked by you at approval.`],
      ]);
      expect([view.outcome.result, view.outcome.met, view.goal.status]).toEqual(['done', 2, 'done']);

      // proven criteria that would take a task past 12 acceptance lines refuse the split, and no task is made
      const six = await ws.createGoal({ ...GOAL, criteria: Array.from({ length: 6 }, (_, i) => `criterion ${i + 1}`) });
      await post(app, `/api/goals/${six.id}/proofs`, { proofs: Array.from({ length: 6 }, (_, i) => ({ criterion: i + 1, kind: 'check', ref: `c${i + 1}` })) });
      const crowded = { title: 'Too much', goal: 'Everything at once.', acceptance: Array.from({ length: 8 }, (_, i) => `check ${i + 1}`), covers: [1, 2, 3, 4, 5, 6], dependsOn: [] };
      const before = (await ws.listTasks()).length;
      const refused = await post(app, `/api/goals/${six.id}/tasks`, { tasks: [{ ...crowded, covers: [1] }, crowded] });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("task 2 would have 14 criteria once the goal's proven ones are added; a task holds at most 12");
      expect((await ws.listTasks()).length).toBe(before);
    });
  } finally {
    models.stop();
  }
}, 60_000);

/** A finished run with what it cost, written as the daemon writes one. */
async function spent(ws: Workspace, task: string, run: string, role: 'planner' | 'implementer', usd: number) {
  await ws.events(task).append({ task, run, vendor: 'daemon', type: 'run.started', payload: { role } });
  await ws.events(task).append({ task, run, vendor: 'daemon', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 10, usd } } });
}

test("Two tasks whose spend reaches the goal's spend limit stop the next build with limit.reached scope goal, though neither task is at its own limit", async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const g = await ws.createGoal({ ...GOAL, limits: { usd: 3 } });
      const [a, b] = await Promise.all(['Count webhooks per tenant', 'Serve the other tenants'].map((title) => ws.createTask({ title, goal: `${title}.`, acceptance: ['it works'], testCommand: 'true', goalId: g.id, goalCriteria: [1] })));
      await ws.updateGoal(g.id, () => ({ tasks: [a?.id as string, b?.id as string], status: 'running' }));
      await spent(ws, a?.id as string, 'r1', 'implementer', 2);
      await spent(ws, b?.id as string, 'r1', 'planner', 1);
      await post(app, `/api/tasks/${b?.id}/autopilot`, { on: true });
      const events = await until(ws, b?.id as string, stopped);
      expect(events.find((e) => e.type === 'limit.reached')?.payload).toEqual({ limit: 'usd', used: 3, cap: 3, scope: 'goal', goal: g.id });
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload).toMatchObject({ reason: `Needs you: the goal's $3.00 spend limit is reached ($3.00 spent across ${g.id}'s tasks).`, needsYou: true, limit: 'usd' });
      // nothing was built
      expect(events.filter((e) => e.type === 'run.started').length).toBe(1);
      // the stop kicks the goal's other task to see if a slot opened; let that tick end before the repo goes
      await Bun.sleep(200);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test("nextStep stops a build at the goal's builds and at the expected cost of one more, and checks no goal limit before planning", () => {
  const t = { id: 'T-0002', acceptance: ['it works'], status: 'planned', tags: [] } as unknown as Parameters<typeof nextStep>[1];
  const s = { implementers: ['muse-code'], maxHops: 3, parallel: 1 };
  let seq = 0;
  const ev = (type: StintEvent['type'], payload: Record<string, unknown> = {}, run?: string): StintEvent => ({ id: '01M5WBKEC0GGGGGGGGGGGG0001', seq: ++seq, ts: '2026-10-28T10:00:00Z', task: 'T-0002', vendor: 'daemon', type, payload, ...(run ? { run } : {}) });
  const on = [ev('autopilot.started')];
  const goal = (usd: number, builds: number, limits: { usd: number | null; builds: number | null }) => ({ goal: { id: 'G-0001', usage: { usd, builds }, limits } });
  // before the plan, a goal over its limits does not stop anything: only a build is checked
  expect(nextStep(on, t, s, false, LIMIT_DEFAULTS, goal(9, 9, { usd: 1, builds: 1 }))).toEqual({ kind: 'plan' });
  const planned = [...on, ev('run.started', { role: 'planner' }, 'r1'), ev('run.finished', { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } }, 'r1')];
  expect(nextStep(planned, t, s, false, LIMIT_DEFAULTS, goal(0, 4, { usd: null, builds: 4 }))).toMatchObject({ kind: 'stop', limit: 'builds', used: 4, cap: 4, scope: 'goal', goal: 'G-0001', reason: "Needs you: the goal's build limit is reached (4 of 4 across G-0001's tasks)." });
  expect(nextStep(planned, t, s, false, LIMIT_DEFAULTS, goal(0, 3, { usd: null, builds: 4 })).kind).toBe('build');
  // a task that built before: one more build at its usual cost would pass the goal's spend
  const built = [...planned, ev('run.started', { role: 'implementer' }, 'r2'), ev('run.finished', { endedBy: 'failed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0.5 } }, 'r2')];
  expect(nextStep(built, t, s, false, LIMIT_DEFAULTS, goal(2.7, 1, { usd: 3, builds: null }))).toMatchObject({ kind: 'stop', limit: 'usd', scope: 'goal', reason: "Needs you: the next build would pass the goal's $3.00 spend limit ($2.70 spent across G-0001's tasks; builds here cost about $0.50)." });
  expect(nextStep(built, t, s, false, LIMIT_DEFAULTS, goal(2.4, 1, { usd: 3, builds: null })).kind).toBe('hand');
});

test('GET /api/goals/:id rolls the goal up from its tasks; once every task is merged and every criterion checked, the goal is done', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const g = (await (await post(app, '/api/goals', { ...GOAL, limits: { usd: 5 } })).json()) as { id: string };
      expect(((await (await app.request(`/api/goals/${g.id}`)).json()) as { proposal: unknown }).proposal).toBeNull();
      await post(app, `/api/goals/${g.id}/plan`, {});
      const pending = (await (await app.request(`/api/goals/${g.id}`)).json()) as { proposal: Array<{ title: string }> };
      expect(pending.proposal.map((t) => t.title)).toEqual(['Count webhooks per tenant', 'Serve the other tenants']);
      const { tasks } = (await (await post(app, `/api/goals/${g.id}/tasks`, { tasks: pending.proposal })).json()) as { tasks: Array<{ id: string }> };
      const ids = tasks.map((t) => t.id);
      const [first, second] = ids as [string, string];

      type View = { goal: { status: string }; outcome: { result: string; met: number; criteria: Array<{ state: string; tasks: string[] }>; tasks: Array<{ id: string; resultLabel: string }>; spend: { limit: number | null } }; titles: Record<string, string>; proposal: unknown };
      const view = async () => (await (await app.request(`/api/goals/${g.id}`)).json()) as View;
      const running = await view();
      expect(running.proposal).toBeNull();
      expect(running.goal.status).toBe('running');
      expect(running.outcome).toMatchObject({ result: 'in_progress', met: 0, spend: { limit: 5 } });
      expect(running.outcome.criteria.map((c) => [c.state, c.tasks])).toEqual([
        ['not_checked', [first]],
        ['not_checked', [second]],
      ]);
      expect(running.outcome.tasks.map((t) => [t.id, t.resultLabel])).toEqual([
        [first, 'In progress'],
        [second, 'In progress'],
      ]);
      expect(running.titles[first]).toBe('Count webhooks per tenant');

      // a person checks each by hand and approves, and each is merged
      for (const id of ids) {
        await ws.writeTask(id, { proofs: [{ criterion: 1, kind: 'human', ref: 'Someone tries it' }] });
        await ws.events(id).append({ task: id, vendor: 'human', type: 'approval.granted', payload: { by: 'human' } });
        await ws.writeTask(id, { status: 'done' });
      }
      const done = await view();
      expect(done.outcome).toMatchObject({ result: 'done', met: 2, merged: 2 });
      expect(done.goal.status).toBe('done');
      expect((await ws.workspaceEvents().read()).filter((e) => e.type === 'goal.status').at(-1)?.payload).toMatchObject({ from: 'running', to: 'done' });
      const list = (await (await app.request('/api/goals')).json()) as { goals: Array<{ goal: { id: string; status: string }; outcome: { met: number } }> };
      expect(list.goals.map((x) => [x.goal.id, x.goal.status, x.outcome.met])).toEqual([[g.id, 'done', 2]]);
      expect((await app.request('/api/goals/G-0042')).status).toBe(404);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test("The subtasks a goal task's plan splits it into keep the goal, its criteria and a share of its limits, and their spend counts against the goal's limits", async () => {
  const subtasks = [
    { title: 'Add the limiter', goal: 'A per-tenant limiter.', acceptance: ['limits a tenant'], dependsOn: [] },
    { title: 'Read limits from config', goal: 'Limits through loadConfig().', acceptance: ['configurable'], dependsOn: [0] },
  ];
  const models = planner([plan({ subtasks })]);
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url, { implementers: ['muse-code'], maxHops: 1, parallel: 2 });
      const { app, ws } = await makeApp(repo, []);
      const g = await ws.createGoal({ ...GOAL, limits: { usd: 3, builds: 6 } });
      const [p, b] = await Promise.all([
        ws.createTask({ title: 'Count webhooks per tenant', goal: 'Each tenant has its own counter.', acceptance: ['429 with Retry-After'], testCommand: 'true', goalId: g.id, goalCriteria: [1, 2], limits: { usd: 1.5, builds: 3 } }),
        ws.createTask({ title: 'Serve the other tenants', goal: 'A tenant under its limit is served.', acceptance: ['Other tenants get 200'], testCommand: 'true', goalId: g.id, goalCriteria: [2] }),
      ]);
      await ws.updateGoal(g.id, () => ({ tasks: [p.id, b.id], status: 'running' }));
      expect((await post(app, `/api/tasks/${p.id}/plan`, {})).status).toBe(200);
      const children = (await ws.events(p.id).read()).find((e) => e.type === 'task.decomposed')?.payload.children as [string, string];
      const kids = await Promise.all(children.map((c) => ws.readTask(c)));
      expect(kids.map((k) => [k.parent, k.goalId, k.goalCriteria, k.limits])).toEqual([
        [p.id, g.id, [1, 2], { usd: 0.75, builds: 1 }],
        [p.id, g.id, [1, 2], { usd: 0.75, builds: 1 }],
      ]);

      // a subtask built for $2 and the other goal task planned for $1: the goal's $3 is spent, so the next build stops
      await spent(ws, children[0], 'r1', 'implementer', 2);
      await spent(ws, b.id, 'r1', 'planner', 1);
      const view = (await (await app.request(`/api/goals/${g.id}`)).json()) as { outcome: { spend: { usd: number }; builds: { used: number }; tasks: Array<{ id: string }> } };
      expect([view.outcome.spend.usd, view.outcome.builds.used, view.outcome.tasks.map((t) => t.id)]).toEqual([3, 1, [p.id, b.id]]);
      await post(app, `/api/tasks/${b.id}/autopilot`, { on: true });
      const events = await until(ws, b.id, stopped);
      expect(events.find((e) => e.type === 'limit.reached')?.payload).toEqual({ limit: 'usd', used: 3, cap: 3, scope: 'goal', goal: g.id });
      await Bun.sleep(200);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test("The best-of candidates of a goal task keep the goal, its criteria and a share of its limits", async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }], models, { implementers: ['muse-code', 'stint-agent'], maxHops: 0, parallel: 2, bestOf: 2 });
      const g = await ws.createGoal({ ...GOAL, limits: { usd: 4, builds: 8 } });
      const t = await ws.createTask({ ...task('true'), goalId: g.id, goalCriteria: [1], limits: { usd: 1, builds: 4 } });
      await ws.updateGoal(g.id, () => ({ tasks: [t.id], status: 'running' }));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped, 120_000);
      const candidates = events.find((e) => e.type === 'bestofn.started')?.payload.candidates as string[];
      const made = await Promise.all(candidates.map((c) => ws.readTask(c)));
      expect(made.map((c) => [c.parent, c.goalId, c.goalCriteria, c.limits])).toEqual([
        [t.id, g.id, [1], { usd: 0.5, builds: 2 }],
        [t.id, g.id, [1], { usd: 0.5, builds: 2 }],
      ]);
    });
  } finally {
    models.stop();
  }
}, 180_000);

test("POST /api/goals/:id/run starts every open task in the goal's order; raising the goal limit a task stopped at resumes it; the view's task rows carry status and dependsOn", async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models, { implementers: ['muse-code'], maxHops: 0, parallel: 2 });
      const g = (await (await post(app, '/api/goals', { ...GOAL, limits: { builds: 1 } })).json()) as { id: string };
      expect((await post(app, `/api/goals/${g.id}/run`, {})).status).toBe(400);
      const { tasks: proposal } = (await (await post(app, `/api/goals/${g.id}/plan`, {})).json()) as { tasks: unknown[] };
      const { tasks } = (await (await post(app, `/api/goals/${g.id}/tasks`, { tasks: proposal })).json()) as { tasks: Array<{ id: string; title: string }> };
      const [a, b] = tasks.map((t) => t.id) as [string, string];
      type View = { tasks: Array<{ id: string; title: string; status: string; dependsOn: string[] }> };
      const rows = async () => ((await (await app.request(`/api/goals/${g.id}`)).json()) as View).tasks.map((t) => [t.id, t.status, t.dependsOn]);
      expect(await rows()).toEqual([
        [a, 'planned', []],
        [b, 'planned', [a]],
      ]);

      const run = (await (await post(app, `/api/goals/${g.id}/run`, {})).json()) as { started: string[] };
      expect(run.started).toEqual([a, b]);
      // the first reaches the gate; the second waits on autopilot for the first to be merged
      expect((await until(ws, a, stopped)).find((e) => e.type === 'autopilot.stopped')?.payload.reason).toBe('Waiting for your approval.');
      expect((await ws.events(b).read()).filter((e) => e.type === 'autopilot.step').at(-1)?.payload).toMatchObject({ step: 'wait', queued: true, blocked: [a] });

      // merged, the second goes on and stops at the goal's one build
      expect((await post(app, `/api/tasks/${a}/approve`, {})).status).toBe(200);
      const atLimit = await until(ws, b, stopped);
      expect(atLimit.find((e) => e.type === 'limit.reached')?.payload).toEqual({ limit: 'builds', used: 1, cap: 1, scope: 'goal', goal: g.id });

      const patch = async (body: unknown) => (await (await app.request(`/api/goals/${g.id}/limits`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body) })).json()) as { resumed: string[] };
      // a limit it did not stop at resumes nothing; raising the one it stopped at does
      expect((await patch({ usd: 5 })).resumed).toEqual([]);
      expect((await patch({ builds: 3 })).resumed).toEqual([b]);
      const resumed = await until(ws, b, (ev) => ev.filter((e) => e.type === 'autopilot.stopped').length >= 2);
      expect(resumed.filter((e) => e.type === 'autopilot.stopped').at(-1)?.payload.reason).toBe('Waiting for your approval.');
      expect(await rows()).toEqual([
        [a, 'done', []],
        [b, 'awaiting_approval', [a]],
      ]);
      // what is merged is not started again, nor what waits at the gate
      expect(((await (await post(app, `/api/goals/${g.id}/run`, {})).json()) as { started: string[] }).started).toEqual([]);
      expect((await ws.events(b).read()).filter((e) => e.type === 'autopilot.started')).toHaveLength(2);
    });
  } finally {
    models.stop();
  }
}, 180_000);
