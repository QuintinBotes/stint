import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { type Adapter, assign, daemonContext, gitOk } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, tempDir, withFixtureRepo } from './helpers';

/** An agent that adds parts/<task>.txt and nothing else, so two tasks never conflict. */
const addsPart: Adapter = {
  ...fakeAdapter('edit'),
  async run(c) {
    await Bun.write(`${c.worktree}/parts/${c.task.id}.txt`, `${c.task.id}\n`);
    return { endedBy: 'completed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 } };
  },
};

/** Green with one part, red with two; every run of it adds a line to `log`. */
const testCommand = (log: string) => `echo ran >> '${log}' && test $(ls parts 2>/dev/null | wc -l) -le 1`;
const runs = (log: string) => readFileSync(log, 'utf8').split('\n').filter(Boolean).length;

/** A task the agent built on its branch, green by the daemon's own verification, waiting at the gate. */
async function atGate(app: Hono, ws: Workspace, log: string, command = testCommand(log), before?: (id: string) => unknown) {
  const t = await ws.createTask({ ...newTask, testCommand: command });
  await before?.(t.id);
  await (await assign(daemonContext(app), t.id, { adapter: 'fake', role: 'implementer' })).done;
  expect((await ws.verification(t.id).latest())?.status).toBe('green');
  await ws.writeTask(t.id, { status: 'awaiting_approval' });
  return t;
}

async function inRepo(fn: (repo: string, app: Hono, ws: Workspace, log: string) => Promise<void>, agent: Adapter = addsPart) {
  const scratch = tempDir('stint-suite-');
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo, [agent]);
      await fn(repo, app, ws, join(scratch.dir, 'runs.log'));
    });
  } finally {
    scratch.cleanup();
  }
}

const noScratchCheckout = async (repo: string) => expect(await gitOk(repo, ['worktree', 'list'])).not.toContain('-merge');

test('Two branches that are each green but merge into a red tree: the second approve is refused with merge_red and nothing moves', async () => {
  await inRepo(async (repo, app, ws, log) => {
    const first = await atGate(app, ws, log);
    const second = await atGate(app, ws, log);
    expect((await post(app, `/api/tasks/${first.id}/approve`, {})).status).toBe(200);
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const base = (await gitOk(repo, ['symbolic-ref', '--short', 'HEAD'])).trim();

    const res = await post(app, `/api/tasks/${second.id}/approve`, {});
    expect(res.status).toBe(409);
    const err = ((await res.json()) as { error: { code: string; message: string; hint: { checks: string[] } } }).error;
    expect(err.code).toBe('merge_red');
    expect(err.message).toBe(`${second.branch} passes on its own but fails merged with ${base}; ask for changes so an agent merges ${base} into it`);
    expect(err.hint.checks).toEqual(['tests']);
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await gitOk(repo, ['status', '--porcelain', '--untracked-files=no'])).trim()).toBe('');
    expect((await ws.readTask(second.id)).status).toBe('awaiting_approval');
    expect((await ws.events(second.id).read()).some((e) => e.type === 'merge.completed' || e.type === 'approval.granted')).toBe(false);
    await noScratchCheckout(repo);
  });
}, 120_000);

test('Main moved under a green branch and the merge is green too: approve tests the merged tree once and merges it', async () => {
  await inRepo(async (repo, app, ws, log) => {
    const t = await atGate(app, ws, log);
    writeFileSync(join(repo, 'NOTES.md'), 'Someone else landed this.\n');
    await gitOk(repo, ['add', 'NOTES.md']);
    await gitOk(repo, ['commit', '-qm', 'Land a note on main']);
    expect(runs(log)).toBe(1);

    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(200);
    expect(runs(log)).toBe(2);
    expect((await gitOk(repo, ['ls-tree', '--name-only', '-r', 'HEAD'])).split('\n')).toEqual(expect.arrayContaining(['NOTES.md', `parts/${t.id}.txt`]));
    expect((await ws.readTask(t.id)).status).toBe('done');
    await noScratchCheckout(repo);
  });
}, 120_000);

test('Main has not moved since the verified commit: approve merges with no extra test run', async () => {
  await inRepo(async (repo, app, ws, log) => {
    const t = await atGate(app, ws, log);
    expect(runs(log)).toBe(1);
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    expect(runs(log)).toBe(1);
    expect((await ws.readTask(t.id)).status).toBe('done');
    await noScratchCheckout(repo);
  });
}, 120_000);

test('Two branches whose tests pass merged but whose merged tree fails a held-out scenario: the second approve is refused with merge_red and nothing moves', async () => {
  await inRepo(async (repo, app, ws, log) => {
    // the held-out scenario holds with one part and fails with two; the tests pass either way
    ws.config.scenarios = { dir: '.stint/scenarios', command: 'sh holdout.sh' };
    const first = await atGate(app, ws, log, `echo ran >> '${log}'`);
    const second = await atGate(app, ws, log, `echo ran >> '${log}'`, (id) => post(app, `/api/tasks/${id}/scenarios`, { name: 'holdout.sh', content: 'test $(ls parts | wc -l) -le 1\n' }));
    expect((await ws.verification(second.id).latest())?.scenarios).toMatchObject({ passed: 1, failed: 0 });
    expect((await post(app, `/api/tasks/${first.id}/approve`, {})).status).toBe(200);
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const base = (await gitOk(repo, ['symbolic-ref', '--short', 'HEAD'])).trim();

    const res = await post(app, `/api/tasks/${second.id}/approve`, {});
    expect(res.status).toBe(409);
    const err = ((await res.json()) as { error: { code: string; message: string; hint: { checks: string[] } } }).error;
    expect(err.code).toBe('merge_red');
    expect(err.message).toBe(`${second.branch} passes on its own but fails merged with ${base}; ask for changes so an agent merges ${base} into it`);
    expect(err.hint.checks).toEqual(['scenarios']);
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await ws.readTask(second.id)).status).toBe('awaiting_approval');
    expect((await ws.events(second.id).read()).some((e) => e.type === 'merge.completed' || e.type === 'approval.granted')).toBe(false);
    await noScratchCheckout(repo);
  });
}, 120_000);
