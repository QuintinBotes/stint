import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutcomeSchema } from '@stint-dev/core';
import { DEFAULT_RECORDING, Replayer, gitOk } from '../src/index';
import { makeApp, newTask, post, withFixtureRepo } from './helpers';

test('R-063: GET /api/tasks/:id/outcome answers stint.outcome/1 for the replayed tasks and 404 for an unknown task', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const r = new Replayer(ws);
    r.load(DEFAULT_RECORDING);
    await r.play({ speed: 0 });
    const gate = await app.request('/api/tasks/T-0043/outcome');
    expect(gate.status).toBe(200);
    const atGate = OutcomeSchema.parse(await gate.json());
    expect(atGate).toMatchObject({ task: 'T-0043', result: 'waiting_for_you', loops: { builds: 1, handoffs: 0, reviewRounds: 0 } });
    expect(atGate.criteria.map((c) => c.state)).toEqual(['passing', 'passing']);
    const merged = OutcomeSchema.parse(await (await app.request('/api/tasks/T-0042/outcome')).json());
    expect(merged.result).toBe('merged');
    expect(merged.afterMerge).toMatchObject({ reverted: false, followups: [], incidents: [], window: { days: 7, mature: false } });
    expect(merged.handoffs[0]).toEqual({ from: 'muse-code', to: 'stint-agent', packetTokens: 412 });
    const missing = await app.request('/api/tasks/T-9999/outcome');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
}, 60_000);

test('R-063 Requirement 5: with outcomeWindowDays 3, a follow-up created on day 2 is recorded and one on day 4 is not', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    await ws.writeConfig((raw) => {
      raw.metrics = { outcomeWindowDays: 3 };
    });
    const base = (await gitOk(repo, ['symbolic-ref', '-q', '--short', 'HEAD'])).trim();
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const first = await ws.createTask(newTask);
    await ws.events(first.id).append({ task: first.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 4, removed: 1 } });
    await ws.events(first.id).append({ task: first.id, vendor: 'daemon', type: 'merge.completed', payload: { branch: first.branch, into: base, commit: head, trailers: { 'Stint-Task': first.id } } });
    const createdOn = async (title: string, days: number) => {
      const t = await ws.createTask({ ...newTask, title });
      await ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'file.changed', payload: { path: 'src/lib/limiter.ts', added: 1, removed: 0 } });
      const path = join(await ws.taskDir(t.id), 'task.json');
      const json = JSON.parse(readFileSync(path, 'utf8')) as { createdAt: string };
      json.createdAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
      return t;
    };
    const day2 = await createdOn('Follow up on day 2', 2);
    await createdOn('Follow up on day 4', 4);
    expect((await post(app, '/api/outcomes/scan', {})).status).toBe(200);
    const followups = (await ws.events(first.id).read()).filter((e) => e.type === 'outcome.followup');
    expect(followups.map((e) => e.payload.followup)).toEqual([day2.id]);
  });
}, 60_000);
