import { describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { DaemonError, RunRegistry, Worktrees, gitOk } from '../src/index';
import { newTask, tempDir, withFixtureRepo } from './helpers';

const setup = async (repo: string) => {
  const ws = await Workspace.open(repo);
  const runs = new RunRegistry();
  return { ws, runs, wt: new Worktrees(ws, runs), task: await ws.createTask(newTask) };
};

describe('worktrees', () => {
  test('On a copy of the fixture, create makes .stint/worktrees/T-0001-r1 on branch stint/T-0001 at baseCommit; a second run after remove reuses the branch and keeps the first run\'s commit', async () => {
    await withFixtureRepo(async (repo) => {
      const { ws, wt, task } = await setup(repo);
      const r1 = await wt.create(task, 'r1');
      expect(r1).toEqual({ path: join(ws.worktreesDir, 'T-0001-r1'), branch: 'stint/T-0001' });
      expect((await gitOk(r1.path, ['rev-parse', 'HEAD'])).trim()).toBe(task.baseCommit);
      expect((await gitOk(r1.path, ['branch', '--show-current'])).trim()).toBe('stint/T-0001');

      appendFileSync(join(r1.path, 'src/config.ts'), '\n// limits arrive here\n');
      const c1 = await wt.commit(task, 'r1', r1.path, 'started the limiter');
      expect((await gitOk(r1.path, ['log', '-1', '--format=%s'])).trim()).toBe('wip(T-0001 r1): started the limiter');
      await wt.remove(task, 'r1');
      expect(existsSync(r1.path)).toBe(false);

      const r2 = await wt.create(task, 'r2');
      expect((await gitOk(r2.path, ['rev-parse', 'HEAD'])).trim()).toBe(c1);
      expect((await gitOk(repo, ['log', '--format=%s', `${task.baseCommit}..stint/T-0001`])).trim()).toBe('wip(T-0001 r1): started the limiter');
    });
  });

  test('A dirty main tree yields dirty_tree and a run.refused event; a repo with no commits yields no_commits', async () => {
    await withFixtureRepo(async (repo) => {
      const { ws, wt, task } = await setup(repo);
      appendFileSync(join(repo, 'README.md'), 'uncommitted\n');
      const err = await wt.create(task, 'r1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DaemonError);
      expect((err as DaemonError).code).toBe('dirty_tree');
      const refused = (await ws.events(task.id).read()).filter((e) => e.type === 'run.refused');
      expect(refused.map((e) => e.payload.code)).toEqual(['dirty_tree']);
      expect(typeof refused[0]?.payload.hint).toBe('string');
    });

    const empty = tempDir();
    try {
      await gitOk(empty.dir, ['init', '-q']);
      const ws = await Workspace.open(empty.dir);
      const task = await ws.createTask({ ...newTask, baseCommit: 'deadbeefdeadbeef' });
      const err = await new Worktrees(ws, new RunRegistry()).create(task, 'r1').catch((e: unknown) => e);
      expect((err as DaemonError).code).toBe('no_commits');
    } finally {
      empty.cleanup();
    }
  });

  test('a directory in the way that is not a worktree yields path_in_use, and it is not deleted', async () => {
    await withFixtureRepo(async (repo) => {
      const { ws, wt, task } = await setup(repo);
      const path = join(ws.worktreesDir, 'T-0001-r1');
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'keep.txt'), 'mine');
      const err = await wt.create(task, 'r1').catch((e: unknown) => e);
      expect((err as DaemonError).code).toBe('path_in_use');
      expect(existsSync(join(path, 'keep.txt'))).toBe(true);
    });
  });

  test('remove refuses run_active while a run holds the worktree', async () => {
    await withFixtureRepo(async (repo) => {
      const { runs, wt, task } = await setup(repo);
      const r1 = await wt.create(task, 'r1');
      runs.add({ task: task.id, run: 'r1', adapter: 'fake', worktree: r1.path, startedAt: new Date().toISOString(), abort: new AbortController(), done: Promise.resolve() });
      const err = await wt.remove(task, 'r1').catch((e: unknown) => e);
      expect((err as DaemonError).code).toBe('run_active');
      expect(existsSync(r1.path)).toBe(true);
    });
  });
});
