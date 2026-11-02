import { expect, test } from 'bun:test';
import type { EndedBy } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';
import { type Adapter, assign, daemonContext, startDaemon } from '../src/index';
import { fakeAdapter, makeApp, newTask, withFixtureRepo } from './helpers';

const ENDINGS: EndedBy[] = ['completed', 'capped', 'killed', 'failed', 'handed'];

/** The packets built for a run's ending: after its run.finished, where a mid-run hook draft never is. */
async function endingPackets(ws: Workspace, task: string) {
  const events = await ws.events(task).read();
  const finished = events.find((e) => e.type === 'run.finished' && e.run === 'r1');
  return events.filter((e) => e.type === 'handoff.created' && e.run === 'r1' && finished && e.seq > finished.seq);
}

test('Every ending, completed, capped, killed, failed and handed, gets exactly one packet when the daemon died after the status moved on, across two restarts', async () => {
  await withFixtureRepo(async (repo) => {
    const endedBy = new Map<string, EndedBy>();
    const ends: Adapter = {
      ...fakeAdapter('edit'),
      async run(c) {
        await Bun.write(`${c.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
        return { endedBy: endedBy.get(c.task.id) as EndedBy, cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [ends]);
    // the daemon dies once the status has moved on, before the packet
    daemonContext(app).afterRun = async () => undefined;
    const tasks = [];
    for (const ending of ENDINGS) {
      const t = await ws.createTask({ ...newTask, title: `Ends ${ending}`, testCommand: 'true' });
      endedBy.set(t.id, ending);
      await (await assign(daemonContext(app), t.id, { adapter: 'fake', role: 'implementer' })).done;
      expect((await ws.readTask(t.id)).status).toBe('reviewing');
      expect(await endingPackets(ws, t.id)).toHaveLength(0);
      tasks.push(t);
    }

    for (let restart = 0; restart < 2; restart++) {
      const d = await startDaemon({ root: repo, quiet: true, adapters: [ends] });
      await d.stop();
      for (const t of tasks) {
        const packets = await endingPackets(ws, t.id);
        expect(packets).toHaveLength(1);
        expect(packets[0]?.payload).toMatchObject({ reason: endedBy.get(t.id), from: { run: 'r1', endedBy: endedBy.get(t.id) } });
        expect(await ws.handoffs(t.id).names()).toEqual(['h1']);
      }
    }
  });
}, 120_000);
