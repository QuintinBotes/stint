import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { type Adapter, RunRegistry, Worktrees, assign, daemonContext, startDaemon } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

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

test('on start, a task left verifying gets the packet its run never built, and a later restart builds no second one', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const task = await ws.createTask({ ...newTask, testCommand: 'true' });
    const wts = new Worktrees(ws, new RunRegistry());
    const { path } = await wts.create(task, 'r1');
    await ws.events(task.id).append({ task: task.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.started', payload: { role: 'implementer', model: null, host: 'local-cli', worktree: `.stint/worktrees/${task.id}-r1` } });
    const commit = await wts.commit(task, 'r1', path, 'completed');
    await ws.events(task.id).append({ task: task.id, run: 'r1', adapter: 'fake', vendor: 'local', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 }, commit } });
    await ws.writeTask(task.id, { status: 'verifying', assignee: null });
    const packets = async (w: Workspace) => (await w.events(task.id).read()).filter((e) => e.type === 'handoff.created' && e.run === 'r1');

    const first = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      for (let i = 0; i < 400 && (await packets(first.ws)).length === 0; i++) await Bun.sleep(50);
      const [created] = await packets(first.ws);
      expect(created?.payload).toMatchObject({ name: 'h1', reason: 'completed', from: { run: 'r1', endedBy: 'completed' } });
      expect((await first.ws.handoffs(task.id).latest())?.verification).toMatchObject({ runBy: 'daemon', exitCode: 0 });
    } finally {
      await first.stop();
    }

    // the packet is there, so a restart that finds the task verifying again only verifies
    await ws.writeTask(task.id, { status: 'verifying' });
    const second = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      for (let i = 0; i < 400 && (await second.ws.readTask(task.id)).status === 'verifying'; i++) await Bun.sleep(50);
    } finally {
      await second.stop();
    }
    expect(await packets(ws)).toHaveLength(1);
    expect(await ws.handoffs(task.id).names()).toEqual(['h1']);
  });
}, 90_000);

test('on start, a done task whose last run has no packet gets none, so a restart spends nothing on finished work', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    daemonContext(app).afterRun = async () => undefined;
    const task = await ws.createTask({ ...newTask, testCommand: 'true' });
    await (await assign(daemonContext(app), task.id, { adapter: 'fake', role: 'implementer' })).done;
    await ws.writeTask(task.id, { status: 'done' });
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    await d.stop();
    expect((await ws.events(task.id).read()).filter((e) => e.type === 'handoff.created')).toHaveLength(0);
    expect((await ws.readTask(task.id)).status).toBe('done');
  });
}, 90_000);

test('on start, a run whose daemon died after the task moved to reviewing gets its packet once, and the PreCompact draft from mid-run does not count as it', async () => {
  await withFixtureRepo(async (repo) => {
    const holder: { app?: Hono } = {};
    const drafting: Adapter = {
      ...fakeAdapter('edit'),
      async run(c) {
        // the agent's PreCompact hook drafts a packet while the run is live
        expect((await post(holder.app as Hono, `/api/tasks/${c.task.id}/handoff`, { run: c.run, reason: 'precompact' })).status).toBe(200);
        return fakeAdapter('edit').run(c);
      },
    };
    const { app, ws } = await makeApp(repo, [drafting]);
    holder.app = app;
    daemonContext(app).afterRun = async () => undefined;
    const task = await ws.createTask({ ...newTask, testCommand: 'true' });
    await (await assign(daemonContext(app), task.id, { adapter: 'fake', role: 'implementer' })).done;
    expect((await ws.readTask(task.id)).status).toBe('reviewing');
    const packets = async () => (await ws.events(task.id).read()).filter((e) => e.type === 'handoff.created');
    expect((await packets()).map((e) => e.payload.reason)).toEqual(['precompact']);

    for (let restart = 0; restart < 2; restart++) {
      const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
      await d.stop();
      const events = await ws.events(task.id).read();
      const finished = events.find((e) => e.type === 'run.finished' && e.run === 'r1');
      const all = await packets();
      expect(all).toHaveLength(2);
      const [draft, ending] = all;
      expect(draft?.seq).toBeLessThan(finished?.seq as number);
      expect(ending?.seq).toBeGreaterThan(finished?.seq as number);
      expect(ending?.payload).toMatchObject({ name: 'h2', reason: 'completed', from: { run: 'r1', endedBy: 'completed' } });
      // the status had moved on, so the restart neither verifies again nor moves it
      expect(events.filter((e) => e.type === 'verification.ran')).toHaveLength(1);
      expect((await ws.readTask(task.id)).status).toBe('reviewing');
    }
  });
}, 90_000);
