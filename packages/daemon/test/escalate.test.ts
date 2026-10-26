import { expect, test } from 'bun:test';
import { fakeModels, setup, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

// every run adds a commit, so each red run makes progress and the stuck rule never fires first
const progressingRed = "printf ' %s pass\\n 1 fail\\n' \"$(git rev-list --count HEAD)\"; exit 1";

test('Two failed verifications hand the third run to the escalate entry', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const adapters = [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }, { ...fakeAdapter('edit'), id: 'codex' }];
      const { app, ws } = await setup(repo, adapters, models, { implementers: ['muse-code', 'stint-agent'], maxHops: 3, parallel: 1, escalateAfter: 2, escalate: ['codex'] });
      const t = await ws.createTask(task(progressingRed));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      const builders = events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').map((e) => e.adapter);
      expect(builders.slice(0, 3)).toEqual(['muse-code', 'stint-agent', 'codex']);
      const escalations = events.filter((e) => e.type === 'escalation.triggered');
      expect(escalations).toHaveLength(1);
      expect(escalations[0]?.payload).toMatchObject({ from: 'stint-agent', to: 'codex', failures: 2 });
      // escalation happens once; after that the chain carries on as usual
      expect(builders[3]).toBe('muse-code');
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('With nothing to escalate to available, autopilot records it and hands to the next implementer', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const adapters = [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }];
      const { app, ws } = await setup(repo, adapters, models, { implementers: ['muse-code', 'stint-agent'], maxHops: 2, parallel: 1, escalateAfter: 2, escalate: ['codex'] });
      const t = await ws.createTask(task(progressingRed));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(events.find((e) => e.type === 'escalation.triggered')?.payload).toMatchObject({ to: 'muse-code', unavailable: ['codex'] });
    });
  } finally {
    models.stop();
  }
}, 180_000);
