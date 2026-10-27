import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Task } from '@stint-dev/core';
import { closeTerminalsIn } from './pty';
import type { Workspace } from '@stint-dev/core/node';
import { DaemonError, type ErrorCode } from './errors';
import { type NumstatEntry, git, gitOk, identityArgs, parseNumstat } from './git';
import type { RunRegistry } from './runs';

/** Lines on the new side of one file that one run last wrote (R-052). */
export type BlameRange = { start: number; end: number; run: string };
export type DiffBlameEntry = NumstatEntry & { hunks?: BlameRange[] };

export interface WorktreeManager {
  create(task: Task, run: string): Promise<{ path: string; branch: string }>;
  remove(task: Task, run: string): Promise<void>;
  diff(task: Task, format: 'unified' | 'json'): Promise<string | NumstatEntry[]>;
  diffBlame(task: Task, commitToRun: ReadonlyMap<string, string>): Promise<DiffBlameEntry[]>;
}

export function worktreePath(ws: Workspace, task: string, run: string): string {
  return join(ws.worktreesDir, `${task}-${run}`);
}

async function registeredWorktrees(root: string): Promise<Set<string>> {
  const out = await gitOk(root, ['worktree', 'list', '--porcelain']);
  return new Set(out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => resolve(l.slice('worktree '.length))));
}

/** Every run happens in its own git worktree on the task branch `stint/<task>`. */
export class Worktrees implements WorktreeManager {
  constructor(
    private readonly ws: Workspace,
    private readonly runs: RunRegistry,
  ) {}

  private async refuse(task: Task, run: string, code: ErrorCode, message: string, hint: string): Promise<never> {
    await this.ws.events(task.id).append({ task: task.id, run, vendor: 'daemon', type: 'run.refused', payload: { code, message, hint } });
    throw new DaemonError(code, message, hint);
  }

  async create(task: Task, run: string): Promise<{ path: string; branch: string }> {
    const root = this.ws.root;
    if ((await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])).code !== 0) {
      return this.refuse(task, run, 'no_commits', 'the repository has no commits', 'commit once, then assign again');
    }
    if ((await git(root, ['symbolic-ref', '-q', 'HEAD'])).code !== 0) {
      return this.refuse(task, run, 'dirty_tree', 'the main tree is on a detached HEAD', 'check out a branch first; a rebase in progress would rewrite the commit the task starts from');
    }
    const status = await gitOk(root, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).stint']);
    if (status.trim().length > 0) {
      return this.refuse(task, run, 'dirty_tree', 'the main tree has uncommitted changes to tracked files', 'commit or stash them; Stint never runs on top of your uncommitted work');
    }
    const path = worktreePath(this.ws, task.id, run);
    if (existsSync(path) && !(await registeredWorktrees(root)).has(resolve(path))) {
      return this.refuse(task, run, 'path_in_use', `${path} exists and is not a git worktree`, 'move it away; Stint does not delete directories it did not create');
    }
    const branchExists = (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code === 0;
    const args = branchExists
      ? ['worktree', 'add', '-q', path, task.branch]
      : ['worktree', 'add', '-q', '-b', task.branch, path, task.baseCommit];
    const r = await git(root, args);
    if (r.code !== 0) {
      return this.refuse(task, run, 'path_in_use', `git worktree add failed: ${r.stderr.trim()}`, 'remove the previous run\'s worktree first');
    }
    await installDependencies(path);
    return { path, branch: task.branch };
  }

  async remove(task: Task, run: string): Promise<void> {
    const path = worktreePath(this.ws, task.id, run);
    if (this.runs.holds(path)) {
      throw new DaemonError('run_active', `${task.id} ${run} is still running in ${path}`, 'stop the run first');
    }
    if (!existsSync(path)) return;
    closeTerminalsIn(path);
    // never --force: a worktree with uncommitted changes stays, and git says why
    const r = await git(this.ws.root, ['worktree', 'remove', path]);
    if (r.code !== 0) throw new DaemonError('dirty_tree', `git refused to remove ${path}: ${r.stderr.trim()}`, 'commit the run first');
  }

  /** The task's change as git sees it on the branch: `git diff <baseCommit>..stint/<task>`. */
  async diff(task: Task, format: 'unified' | 'json'): Promise<string | NumstatEntry[]> {
    const range = `${task.baseCommit}..${task.branch}`;
    if ((await git(this.ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code !== 0) {
      return format === 'json' ? [] : '';
    }
    if (format === 'unified') return gitOk(this.ws.root, ['diff', range]);
    return parseNumstat(await gitOk(this.ws.root, ['diff', '--numstat', range]));
  }

  /**
   * The task's change with each new-side line range attributed to the run whose commit last wrote it
   * (R-052): `git blame` on the task branch in the main repository, so it still works after the
   * run's worktree is gone. A file git cannot blame (binary, vanished) keeps no ranges and the
   * caller falls back to per-file attribution.
   */
  async diffBlame(task: Task, commitToRun: ReadonlyMap<string, string>): Promise<DiffBlameEntry[]> {
    const files = (await this.diff(task, 'json')) as NumstatEntry[];
    if (files.length === 0 || commitToRun.size === 0) return files;
    const out: DiffBlameEntry[] = [];
    for (const f of files) {
      const r = await git(this.ws.root, ['blame', '--porcelain', task.branch, '--', f.path]);
      if (r.code !== 0) {
        out.push(f);
        continue;
      }
      const hunks: BlameRange[] = [];
      for (const line of r.stdout.split('\n')) {
        // porcelain headers repeat per line; only the first line of a group carries the group size
        const m = /^\^?([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
        if (!m) continue;
        const run = commitToRun.get(m[1] as string);
        if (!run) continue;
        const at = Number(m[2]);
        const last = hunks.at(-1);
        if (last && last.run === run && last.end === at - 1) last.end = at;
        else hunks.push({ start: at, end: at, run });
      }
      out.push(hunks.length ? { ...f, hunks } : f);
    }
    return out;
  }

  /** The live state of a worktree against the base, untracked files included. */
  async snapshot(task: Task, path: string): Promise<NumstatEntry[]> {
    await git(path, ['add', '-A', '-N']);
    return parseNumstat(await gitOk(path, ['diff', '--numstat', task.baseCommit]));
  }

  /** Commits whatever the run left as `wip(<task> <run>): <summary>`, so the branch never depends on a live process. */
  async commit(task: Task, run: string, path: string, summary: string): Promise<string> {
    const message = `wip(${task.id} ${run}): ${summary.replace(/\s+/g, ' ').trim().slice(0, 72)}`;
    await gitOk(path, ['add', '-A']);
    await gitOk(path, [...(await identityArgs(path)), 'commit', '-q', '--allow-empty', '--no-verify', '-m', message]);
    return (await gitOk(path, ['rev-parse', 'HEAD'])).trim();
  }

  /** Emits `file.changed` for files whose numstat moved; every 5 s while the run lives, and once when stopped. */
  startSnapshots(task: Task, run: string, path: string, everyMs = 5_000): { stop: () => Promise<void> } {
    const seen = new Map<string, string>();
    let busy: Promise<void> = Promise.resolve();
    const tick = () => {
      busy = busy.then(async () => {
        if (!existsSync(path)) return;
        for (const f of await this.snapshot(task, path).catch(() => [])) {
          const key = `${f.added}/${f.removed}`;
          if (seen.get(f.path) === key) continue;
          seen.set(f.path, key);
          await this.ws.events(task.id).append({ task: task.id, run, vendor: 'daemon', type: 'file.changed', payload: { ...f, run }, links: [{ kind: 'file', ref: f.path }] });
        }
      });
      return busy;
    };
    const timer = setInterval(() => void tick(), everyMs);
    return {
      stop: async () => {
        clearInterval(timer);
        await tick();
      },
    };
  }
}

/** A fresh worktree has no dependencies; without them neither the agent nor the verifier can run the tests. */
export async function installDependencies(path: string): Promise<void> {
  if (!existsSync(join(path, 'bun.lock')) || existsSync(join(path, 'node_modules'))) return;
  const p = Bun.spawn(['bun', 'install', '--frozen-lockfile'], { cwd: path, stdout: 'ignore', stderr: 'pipe' });
  if ((await p.exited) !== 0) {
    const err = await new Response(p.stderr).text();
    throw new DaemonError('invalid', `bun install failed in the worktree: ${err.trim().slice(0, 300)}`);
  }
}
