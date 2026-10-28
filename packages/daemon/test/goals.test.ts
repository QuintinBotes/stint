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
