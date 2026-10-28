import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { RunRegistry, Worktrees, startDaemon } from '../src/index';
import { fakeAdapter, newTask, withFixtureRepo } from './helpers';

/** A run a crash cut off: started in the log, its worktree dirty, and no run.finished. */
async function orphan(repo: string) {
  const ws = await Workspace.open(repo);
  const task = await ws.createTask({ ...newTask, testCommand: 'true' });
  const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
  await ws.runs(task.id).create({ run: 'r1', adapter: 'fake', vendor: 'local', role: 'implementer', host: 'local-cli', startedAt: new Date().toISOString(), worktree: `.stint/worktrees/${task.id}-r1` });
  await ws.events(task.id).append({ task: task.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.started', payload: { role: 'implementer', model: null, host: 'local-cli', worktree: `.stint/worktrees/${task.id}-r1`, handoffFrom: null, skills: [] } });
  await ws.writeTask(task.id, { status: 'building', assignee: { adapter: 'fake', role: 'implementer', run: 'r1' } });
  writeFileSync(join(path, 'half-done.ts'), 'export const x = 1;\n');
  return task;
}

test('on start, a run a crash left open is closed as killed with its work committed and a packet, and a new run can start', async () => {
  await withFixtureRepo(async (repo) => {
    const task = await orphan(repo);
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      let events = await d.ws.events(task.id).read();
      for (let i = 0; i < 400 && !events.some((e) => e.type === 'handoff.created'); i++) {
        await Bun.sleep(50);
        events = await d.ws.events(task.id).read();
      }
      const finished = events.find((e) => e.type === 'run.finished' && e.run === 'r1');
      expect(finished?.payload).toMatchObject({ endedBy: 'killed' });
      expect(typeof finished?.payload.commit).toBe('string');
      expect(events.some((e) => e.type === 'agent.message' && String(e.payload.text).includes('the daemon restarted'))).toBe(true);
      expect(events.some((e) => e.type === 'verification.ran' && e.run === 'r1')).toBe(true);
      expect((await d.ws.readTask(task.id)).status).not.toBe('verifying');
      const res = await fetch(`${d.url}/api/tasks/${task.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'fake', role: 'implementer' }) });
      expect(res.status).toBe(202);
    } finally {
      await d.stop();
    }
  });
}, 90_000);

test('on start, a task left verifying with no live verification is verified again', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const task = await ws.createTask({ ...newTask, testCommand: 'true' });
    const wts = new Worktrees(ws, new RunRegistry());
    const { path } = await wts.create(task, 'r1');
    await ws.events(task.id).append({ task: task.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.started', payload: { role: 'implementer', model: null, host: 'local-cli', worktree: `.stint/worktrees/${task.id}-r1` } });
    const commit = await wts.commit(task, 'r1', path, 'completed');
    await ws.events(task.id).append({ task: task.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 }, commit } });
    await ws.writeTask(task.id, { status: 'verifying', assignee: null });
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      for (let i = 0; i < 400 && (await d.ws.readTask(task.id)).status === 'verifying'; i++) await Bun.sleep(50);
      expect((await d.ws.readTask(task.id)).status).toBe('reviewing');
      expect((await d.ws.verification(task.id).latest())?.commit).toBe(commit);
    } finally {
      await d.stop();
    }
  });
}, 90_000);
