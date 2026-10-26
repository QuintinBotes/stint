import { expect, test } from 'bun:test';
import type { StintEvent } from '@stint-dev/core';
import { fakeAdapter, post, withFixtureRepo, makeApp } from './helpers';
import { stopped, until } from './autopilot.fixtures';
import { plan, planner, writeConfig } from './plan.fixtures';

const split = plan({
  subtasks: [
    { title: 'Add the limiter', goal: 'A per-tenant limiter in src/lib/limiter.ts.', acceptance: ['limits a tenant'], dependsOn: [] },
    { title: 'Read limits from config', goal: 'Limits through loadConfig().', acceptance: ['configurable'], dependsOn: [] },
    { title: 'Wire it into the webhook route', goal: 'POST /webhooks answers 429.', acceptance: ['429 with Retry-After'], dependsOn: [0, 2, 5] },
  ],
});

test('A plan with three subtasks (one depending on another) creates three tasks; the dependent one starts only after its dependency is done', async () => {
  const models = planner([split, plan(), plan(), plan()]);
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url, { implementers: ['muse-code'], maxHops: 1, parallel: 1 });
      const { app, ws } = await makeApp(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }]);
      const parent = await ws.createTask({ title: 'Rate-limit webhooks end to end', goal: 'Limiter, config and route.', acceptance: ['429 with Retry-After'], testCommand: 'true', tags: ['limits'] });
      await post(app, `/api/tasks/${parent.id}/autopilot`, { on: true });

      const events = await until(ws, parent.id, (ev) => ev.some((e) => e.type === 'task.decomposed'));
      const children = events.find((e) => e.type === 'task.decomposed')?.payload.children as [string, string, string];
      expect(children).toHaveLength(3);
      const [a, b, c] = children;
      // a dependency on a later subtask, or one that does not exist, is dropped: only earlier ones count
      expect((await ws.readTask(c)).dependsOn).toEqual([a]);
      expect((await ws.readTask(a)).parent).toBe(parent.id);
      expect((await ws.readTask(b)).tags).toContain('subtask');

      // the two free subtasks reach the gate one after the other (parallel 1); the dependent one waits
      await until(ws, a, stopped);
      await until(ws, b, stopped);
      const waiting = await ws.events(c).read();
      expect(waiting.some((e) => e.type === 'run.started')).toBe(false);
      expect(waiting.filter((e) => e.type === 'autopilot.step').at(-1)?.payload).toMatchObject({ step: 'wait', queued: true, blocked: [a] });

      // once its dependency is merged, it starts by itself
      expect((await post(app, `/api/tasks/${a}/approve`, {})).status).toBe(200);
      const after = await until(ws, c, stopped);
      expect(after.some((e) => e.type === 'run.started' && e.payload.role === 'implementer')).toBe(true);
      const startedAt = (after.find((e) => e.type === 'run.started') as StintEvent).ts;
      const mergedAt = ((await ws.events(a).read()).find((e) => e.type === 'merge.completed') as StintEvent).ts;
      expect(startedAt >= mergedAt).toBe(true);

      // the parent is done once every subtask is merged
      expect((await post(app, `/api/tasks/${b}/approve`, {})).status).toBe(200);
      expect((await post(app, `/api/tasks/${c}/approve`, {})).status).toBe(200);
      const end = await until(ws, parent.id, stopped);
      expect(end.find((e) => e.type === 'autopilot.stopped')?.payload).toMatchObject({ reason: 'All 3 subtasks are merged.', needsYou: false });
      expect((await ws.readTask(parent.id)).status).toBe('done');
    });
  } finally {
    models.stop();
  }
}, 240_000);
