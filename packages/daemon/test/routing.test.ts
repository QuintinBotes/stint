import { expect, test } from 'bun:test';
import { daemonContext } from '../src/app';
import { betaSample, chooseLearned } from '../src/routing';
import { fakeModels, setup, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

/** A small seeded generator, so the counts below are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('A Beta draw has the mean of its counts', () => {
  const rng = seeded(7);
  let sum = 0;
  for (let i = 0; i < 4000; i++) sum += betaSample(10, 2, rng);
  expect(sum / 4000).toBeCloseTo(10 / 12, 1);
});

test('With one agent at 9 of 10 green and another at 1 of 10 for a tag, learned routing picks the first most of the time and still explores', () => {
  const rng = seeded(42);
  const records = { strong: { passed: 9, attempts: 10 }, weak: { passed: 1, attempts: 10 } };
  const picks = { strong: 0, weak: 0, explored: 0 };
  for (let i = 0; i < 1000; i++) {
    const p = chooseLearned(['strong', 'weak'], records, 0.1, rng);
    picks[p.agent as 'strong' | 'weak'] += 1;
    if (p.explored) picks.explored += 1;
  }
  expect(picks.strong).toBeGreaterThan(900);
  expect(picks.weak).toBeGreaterThan(20);
  expect(picks.explored).toBeGreaterThan(60);
  // an agent nobody has tried yet is what exploring goes to first
  const fresh = chooseLearned(['strong', 'new'], { strong: { passed: 9, attempts: 10 } }, 1, rng);
  expect(fresh).toMatchObject({ agent: 'new', explored: true });
});

test('Autopilot in learned mode builds with the agent the evals favour and records why', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }, { ...fakeAdapter('edit'), id: 'stint-agent' }], models, { implementers: ['muse-code', 'stint-agent'], maxHops: 2, parallel: 1 });
      ws.config.routing = { mode: 'learned', explore: 0 };
      daemonContext(app).autopilot.rng = seeded(3);
      // what an eval measured before any real task ran
      const earlier = await ws.createTask(task('true', 'An eval task'));
      await ws.events(earlier.id).append({ task: earlier.id, vendor: 'daemon', type: 'eval.ran', payload: { agent: 'stint-agent', passed: 10, attempts: 10 } });
      await ws.events(earlier.id).append({ task: earlier.id, vendor: 'daemon', type: 'eval.ran', payload: { agent: 'muse-code', passed: 0, attempts: 10 } });
      const t = await ws.createTask(task('true'));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped);
      expect(events.find((e) => e.type === 'run.started' && e.payload.role === 'implementer')?.adapter).toBe('stint-agent');
      expect(events.find((e) => e.type === 'routing.chosen')?.payload).toMatchObject({ agent: 'stint-agent', explored: false, records: { 'stint-agent': { passed: 10, attempts: 10 } } });
      const board = (await (await app.request('/api/scoreboard')).json()) as { rows: Array<{ agent: string; tag: string }>; routing: { mode: string } };
      expect(board.routing.mode).toBe('learned');
      expect(board.rows.some((r) => r.agent === 'stint-agent' && r.tag === '*')).toBe(true);
    });
  } finally {
    models.stop();
  }
}, 120_000);
