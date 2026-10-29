import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { fakeModels, task, until } from './autopilot.fixtures';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

function config(repo: string, reviewer: string[], url = 'http://127.0.0.1:9/v1') {
  const c = structuredClone(DEFAULT_CONFIG);
  c.hosts.ollama = { ...(c.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: url, models: { fake: 'fake' } };
  c.routes.reviewer = reviewer;
  c.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(c));
}

const atGate = (events: Array<{ type: string }>) => events.some((e) => e.type === 'approval.requested');

test('A run assigned by hand that ends green is reviewed by the reviewer chain and reaches the gate, with autopilot never on', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      config(repo, ['ollama/fake'], models.url);
      const { app, ws } = await makeApp(repo, [fakeAdapter('edit')], { autoReview: true });
      const t = await ws.createTask(task('true'));
      expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).status).toBe(202);
      const events = await until(ws, t.id, atGate);
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
      expect(models.asked).toEqual(['review']);
      expect(events.filter((e) => e.type === 'run.started').map((e) => [e.run, e.payload.role])).toEqual([
        ['r1', 'implementer'],
        ['r2', 'reviewer'],
      ]);
      expect(events.find((e) => e.type === 'approval.requested')?.payload).toMatchObject({ review: 'approve', verification: { status: 'green' } });
      expect(events.some((e) => e.type.startsWith('autopilot.'))).toBe(false);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('With no reviewer to answer, a green run assigned by hand goes to the gate with the reason on its approval request', async () => {
  await withFixtureRepo(async (repo) => {
    config(repo, []);
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')], { autoReview: true });
    const t = await ws.createTask(task('true'));
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await until(ws, t.id, atGate);
    expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
    expect(events.find((e) => e.type === 'approval.requested')?.payload).toEqual({
      verification: { passed: 1, failed: 0, status: 'green' },
      review: null,
      reason: 'No reviewer could answer (routes.reviewer names no model).',
    });
  });
}, 60_000);

test('A red run assigned by hand is not reviewed and stays building', async () => {
  await withFixtureRepo(async (repo) => {
    config(repo, []);
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')], { autoReview: true });
    const t = await ws.createTask(task('false'));
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const events = await until(ws, t.id, (ev) => ev.some((e) => e.type === 'handoff.created'));
    for (let i = 0; i < 20; i++) await Bun.sleep(25);
    expect((await ws.readTask(t.id)).status).toBe('building');
    expect(events.some((e) => e.type === 'approval.requested')).toBe(false);
  });
}, 60_000);
