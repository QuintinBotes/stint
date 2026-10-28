import { expect, test } from 'bun:test';
import type { SharpenState } from '@stint-dev/core';
import { costs } from '@stint-dev/core/node';
import { fakeModels, setup } from './autopilot.fixtures';
import { post, withFixtureRepo } from './helpers';

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
