import { expect, test } from 'bun:test';
import type { Adapter, RunResult } from '../src/index';
import { git } from '../src/git';
import { fakeModels, setup, steps, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, post, withFixtureRepo } from './helpers';

/** An implementer that writes the limiter with the given limit. */
const writes = (id: string, limit: number): Adapter => ({
  ...fakeAdapter('edit'),
  id,
  async run(ctx): Promise<RunResult> {
    await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, `export const LIMIT = ${limit};\n`);
    return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 0, outputTokens: 20, usd: 0.001 } };
  },
});

test('bestOf 2 runs two fakes, verifies both, picks the green one', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [writes('muse-code', 0), writes('stint-agent', 60)], models, { implementers: ['muse-code', 'stint-agent'], maxHops: 0, parallel: 2, bestOf: 2 });
      const t = await ws.createTask(task("grep -q 'LIMIT = 60' src/lib/limiter.ts"));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped, 120_000);

      const started = events.find((e) => e.type === 'bestofn.started')?.payload as { candidates: string[] };
      expect(started.candidates).toHaveLength(2);
      const [first, second] = started.candidates as [string, string];
      // each candidate is built by a different implementer and verified by the daemon
      for (const [c, adapter] of [[first, 'muse-code'], [second, 'stint-agent']] as const) {
        const ev = await ws.events(c).read();
        expect(ev.find((e) => e.type === 'run.started')?.adapter).toBe(adapter);
        expect(ev.some((e) => e.type === 'verification.ran')).toBe(true);
        expect((await ws.readTask(c)).parent).toBe(t.id);
      }
      expect(events.find((e) => e.type === 'bestofn.picked')?.payload).toMatchObject({ pick: second, candidates: [{ id: first, green: false }, { id: second, green: true }] });

      // the parent adopts the pick: its branch is the candidate's, verified again and reviewed
      const parent = await ws.readTask(t.id);
      const picked = await ws.readTask(second);
      const head = async (b: string) => (await git(repo, ['rev-parse', b])).stdout.trim();
      expect(await head(parent.branch)).toBe(await head(picked.branch));
      expect(events.find((e) => e.type === 'run.started' && e.payload.role === 'implementer')?.payload.adoptedFrom).toStartWith(`${second} `);
      expect(events.filter((e) => e.type === 'verification.ran').at(-1)?.payload.status).toBe('green');
      expect(steps(events)).toEqual(['plan', 'build', 'build', 'verify', 'review']);
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload.reason).toBe('Waiting for your approval.');
      expect(models.asked).toEqual(['plan', 'review']);
    });
  } finally {
    models.stop();
  }
}, 180_000);

test('bestOf with no green candidate stops the parent with Needs you', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [writes('muse-code', 0), writes('stint-agent', 1)], models, { implementers: ['muse-code', 'stint-agent'], maxHops: 0, parallel: 1, bestOf: 2 });
      const t = await ws.createTask(task("grep -q 'LIMIT = 60' src/lib/limiter.ts"));
      await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
      const events = await until(ws, t.id, stopped, 120_000);
      expect(events.find((e) => e.type === 'autopilot.stopped')?.payload).toMatchObject({ needsYou: true });
      expect(String(events.find((e) => e.type === 'autopilot.stopped')?.payload.reason)).toStartWith('Needs you: no candidate of ');
    });
  } finally {
    models.stop();
  }
}, 180_000);
