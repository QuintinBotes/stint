import { expect, test } from 'bun:test';
import { LIMIT_DEFAULTS, type SharpenState, type StintEvent, sharpenState } from '@stint-dev/core';
import { costs } from '@stint-dev/core/node';
import { nextStep } from '../src/autopilot';
import { fakeModels, setup, steps, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, newTask, post, withFixtureRepo } from './helpers';

test('A round from a fake planner keeps five valid questions, material first, drops one with its reason and records its cost; answers, recommendations and proofs make it ready', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const t = await ws.createTask(task('true'));
      const res = await post(app, `/api/tasks/${t.id}/sharpen`, {});
      expect(res.status).toBe(200);
      const state = (await res.json()) as SharpenState;
      expect(models.asked).toEqual(['sharpen']);
      // the prompt carries the task, the tracked files and the rules
      expect(models.prompts[0]).toContain('Title: Rate-limit incoming webhooks');
      expect(models.prompts[0]).toContain('- src/routes/webhooks.ts');

      const asked = (await ws.events(t.id).read()).find((e) => e.type === 'sharpen.asked')?.payload as Record<string, unknown>;
      expect((asked.questions as Array<{ id: string; text: string; material: boolean }>).map((q) => [q.id, q.material])).toEqual([
        ['Q1', true],
        ['Q2', false],
        ['Q3', false],
        ['Q4', false],
        ['Q5', false],
      ]);
      expect((asked.questions as Array<{ text: string }>)[0]?.text).toBe('Do retries of a failed webhook count towards the limit?');
      expect(asked.dropped).toEqual([{ text: 'Which file holds the limiter?', reason: 'the repository can answer it' }]);
      expect(asked).toMatchObject({ round: 1, host: 'ollama', model: 'fake', cost: { inputTokens: 100, outputTokens: 20, usd: 0 } });
      expect((await costs(ws, { group: 'model' })).find((r) => r.key === 'ollama/fake')?.roles).toEqual(['sharpen']);
      expect(state).toMatchObject({ round: 1, open: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], openMaterial: ['Q1'], ready: false, assumed: [{ id: 'A1', text: 'The window is 60 seconds.' }] });

      // a person answers Q1: sharpen.answered and a decision that pairs the question with the answer
      const answered = await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1', option: 'Retries do not count' });
      expect(answered.status).toBe(200);
      const { decision } = (await answered.json()) as { decision: string };
      expect(decision).toBe('D1');
      const events = await ws.events(t.id).read();
      expect(events.find((e) => e.type === 'sharpen.answered')).toMatchObject({ vendor: 'human', payload: { question: 'Q1', option: 'Retries do not count', decision: 'D1', by: 'you' } });
      const [d1] = await ws.decisions(t.id).validAt();
      expect(d1).toMatchObject({ id: 'D1', by: 'you', text: 'Do retries of a failed webhook count towards the limit? Answer: Retries do not count', evidence: ['sharpen:Q1'] });

      // the rest are not material, so their recommendations can be taken in one go
      const rec = (await (await post(app, `/api/tasks/${t.id}/sharpen/recommended`, {})).json()) as { decisions: string[] };
      expect(rec.decisions).toEqual(['D2', 'D3', 'D4', 'D5']);
      const after = (await (await app.request(`/api/tasks/${t.id}/sharpen`)).json()) as SharpenState;
      expect(after).toMatchObject({ open: [], openMaterial: [], ready: false, proofs: { missing: [1], suggested: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }] } });

      const set = await post(app, `/api/tasks/${t.id}/proofs`, { proofs: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }] });
      expect(set.status).toBe(200);
      expect((await ws.readTask(t.id)).proofs).toEqual([{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }]);
      expect((await ws.events(t.id).read()).find((e) => e.type === 'proofs.set')?.payload.proofs).toEqual([{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }]);
      expect(sharpenState(await ws.events(t.id).read(), await ws.readTask(t.id)).ready).toBe(true);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('The sharpen routes refuse what they cannot do: no token, a live run, a bad answer, a criterion the task does not have', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [fakeAdapter('sleep')], models);
      const t = await ws.createTask(task('true'));
      expect((await post(app, `/api/tasks/${t.id}/sharpen`, {}, {})).status).toBe(401);
      expect((await post(app, `/api/tasks/${t.id}/proofs`, { proofs: [] }, {})).status).toBe(401);
      await post(app, `/api/tasks/${t.id}/sharpen`, {});
      expect((await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1', option: 'Maybe' })).status).toBe(400);
      expect((await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q9', option: 'Retries count' })).status).toBe(404);
      expect((await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1' })).status).toBe(400);
      expect((await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1', assumption: 'A1', text: 'both' })).status).toBe(400);
      expect((await post(app, `/api/tasks/${t.id}/proofs`, { proofs: [{ criterion: 2, kind: 'test', ref: 'x' }] })).status).toBe(400);
      expect((await post(app, `/api/tasks/${t.id}/proofs`, { proofs: [{ criterion: 1, kind: 'test', ref: 'x' }, { criterion: 1, kind: 'human', ref: 'y' }] })).status).toBe(400);

      // changing an assumption is an answer too, and answering again supersedes the earlier decision
      const a = (await (await post(app, `/api/tasks/${t.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 30 seconds.' })).json()) as { decision: string };
      const again = (await (await post(app, `/api/tasks/${t.id}/sharpen/answer`, { assumption: 'A1', text: 'The window is 90 seconds.' })).json()) as { decision: string };
      const valid = await ws.decisions(t.id).validAt();
      expect(valid.map((d) => d.id)).toEqual([again.decision]);
      expect((await ws.decisions(t.id).read()).find((d) => d.id === again.decision)).toMatchObject({ supersedes: a.decision, text: 'Assumed: The window is 60 seconds. Changed to: The window is 90 seconds.' });

      const { run } = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).json()) as { run: string };
      const live = await post(app, `/api/tasks/${t.id}/sharpen`, {});
      expect(live.status).toBe(409);
      expect(((await live.json()) as { error: { code: string } }).error.code).toBe('run_active');
      await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {});
      await until(ws, t.id, (es) => es.some((e) => e.type === 'handoff.created'));
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('The first build starts from what sharpening settled: the answers, the assumptions and the accepted proofs follow its ask', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const builder = fakeAdapter('edit');
      const { app, ws } = await setup(repo, [builder], models);
      const t = await ws.createTask(task('true'));
      await post(app, `/api/tasks/${t.id}/sharpen`, {});
      await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1', text: 'Only first attempts count' });
      await post(app, `/api/tasks/${t.id}/proofs`, { proofs: [{ criterion: 1, kind: 'test', ref: '429 with Retry-After' }] });
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      for (let i = 0; i < 200 && builder.seen.length === 0; i++) await Bun.sleep(25);
      const prompt = await Bun.file(builder.seen[0]?.promptPath as string).text();
      const ask = prompt.split('\n## Ask\n')[1] ?? '';
      expect(ask).toContain('Settled before work started:');
      expect(ask).toContain('- D1: Do retries of a failed webhook count towards the limit? Answer: Only first attempts count');
      expect(ask).toContain('- Assumed A1: The window is 60 seconds.');
      expect(ask).toContain('- Criterion 1 (429 with Retry-After): test "429 with Retry-After"');
      await until(ws, t.id, (es) => es.some((e) => e.type === 'handoff.created'));
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('With beforeAutopilot on, autopilot sharpens first and stops for an open material question; answered and switched on again, it plans with the answer in the prompt', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models, undefined, { beforeAutopilot: true, maxQuestions: 5 });
      const t = await ws.createTask(task('true'));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      let events = await until(ws, t.id, stopped);
      expect(steps(events)).toEqual(['sharpen']);
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload).toMatchObject({ reason: 'Needs you: 1 question to answer before it starts.', needsYou: true });
      expect(models.asked).toEqual(['sharpen']);

      await post(app, `/api/tasks/${t.id}/sharpen/answer`, { question: 'Q1', option: 'Retries do not count' });
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      events = await until(ws, t.id, (es) => es.filter((e) => e.type === 'autopilot.stopped').length === 2);
      expect(steps(events)).toEqual(['sharpen', 'sharpen', 'plan', 'build', 'verify', 'review']);
      // autopilot took the recommendation for the four that are not material, as itself
      const byAutopilot = events.filter((e) => e.type === 'sharpen.answered' && e.payload.by === 'autopilot');
      expect(byAutopilot.map((e) => e.payload.question)).toEqual(['Q2', 'Q3', 'Q4', 'Q5']);
      expect(byAutopilot.every((e) => e.vendor === 'daemon' && e.payload.recommended === true)).toBe(true);
      expect((await ws.decisions(t.id).read()).find((d) => d.evidence.includes('sharpen:Q2'))?.by).toBe('autopilot');
      const plan = models.prompts[models.asked.indexOf('plan')] ?? '';
      expect(plan).toContain('## Before work started');
      expect(plan).toContain('Do retries of a failed webhook count towards the limit? Answer: Retries do not count');
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('nextStep sharpens before the plan only when beforeAutopilot is on, and plans as before when it is off', () => {
  const t = { id: 'T-0001', acceptance: ['429 with Retry-After'], status: 'planned', tags: [] } as unknown as Parameters<typeof nextStep>[1];
  const s = { implementers: ['muse-code'], maxHops: 3, parallel: 1 };
  const on: StintEvent[] = [{ id: '01M5WBKEC0GGGGGGGGGGGG0001', seq: 1, ts: '2026-10-28T10:00:00Z', task: 'T-0001', vendor: 'daemon', type: 'autopilot.started', payload: {} }];
  expect(nextStep(on, t, s, false, LIMIT_DEFAULTS)).toEqual({ kind: 'plan' });
  expect(nextStep(on, t, s, false, LIMIT_DEFAULTS, { sharpenFirst: false })).toEqual({ kind: 'plan' });
  expect(nextStep(on, t, s, false, LIMIT_DEFAULTS, { sharpenFirst: true })).toEqual({ kind: 'sharpen' });
  // a round that could not be asked does not hold the plan up
  const failed = [...on, { ...(on[0] as StintEvent), seq: 2, type: 'autopilot.step' as const, payload: { step: 'sharpen', reason: 'No model could sharpen it' } }];
  expect(nextStep(failed, t, s, false, LIMIT_DEFAULTS, { sharpenFirst: true })).toEqual({ kind: 'plan' });
  // a task already planned is not sharpened by autopilot
  const planned = [...on, { ...(on[0] as StintEvent), seq: 2, run: 'r1', type: 'run.started' as const, payload: { role: 'planner' } }];
  expect(nextStep(planned, t, s, false, LIMIT_DEFAULTS, { sharpenFirst: true }).kind).not.toBe('sharpen');
});

test('A task never sharpened is planned from the same prompt as before', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [], models);
      const t = await ws.createTask(newTask);
      expect((await post(app, `/api/tasks/${t.id}/plan`, {})).status).toBe(200);
      expect(models.prompts[0]).not.toContain('Before work started');
    });
  } finally {
    models.stop();
  }
}, 60_000);
