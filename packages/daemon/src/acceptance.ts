import { sha256Hex } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { git } from './git';

/** A path a test runner would pick up: a test folder, or a `.test.` or `.spec.` file. */
export const isTestPath = (p: string) => /(^|\/)(test|tests|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

type Locked = { path: string; sha256: string };

/** The file as the task branch has it now; a deleted file hashes as "deleted". */
async function hashAtBranch(ctx: DaemonContext, branch: string, path: string): Promise<string> {
  const r = await git(ctx.ws.root, ['show', `${branch}:${path}`]);
  return r.code === 0 ? `sha256:${sha256Hex(r.stdout)}` : 'deleted';
}

/** Locks the tests a specify run wrote: their paths and hashes at the branch head, and the tests that failed. */
export async function lockAcceptance(ctx: DaemonContext, taskId: string, run: string): Promise<Locked[]> {
  const task = await ctx.ws.readTask(taskId);
  const events = await ctx.ws.events(taskId).read();
  // git's own names for the files the run's commit touched: numstat's display form quotes some names and folds renames
  const commit = events.find((e) => e.type === 'run.finished' && e.run === run)?.payload.commit;
  const listed = typeof commit === 'string' ? (await git(ctx.ws.root, ['diff-tree', '--no-commit-id', '--name-only', '-z', '-r', '--no-renames', '--root', commit])).stdout.split('\0') : [];
  const fromEvents = events.filter((e) => e.type === 'file.changed' && e.run === run).map((e) => String(e.payload.path));
  const paths = [...new Set((listed.some(Boolean) ? listed : fromEvents).filter(Boolean).filter(isTestPath))];
  const files: Locked[] = [];
  for (const path of paths) files.push({ path, sha256: await hashAtBranch(ctx, task.branch, path) });
  const failing = (events.filter((e) => e.type === 'verification.ran' && e.run === run).at(-1)?.payload.failing as string[] | undefined) ?? [];
  await ctx.ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: 'acceptance.locked', payload: { run, files, failing } });
  return files;
}

/** After a run, any locked test file that changed on the branch is recorded: green bought by editing the tests is not done. */
export async function checkAcceptanceLock(ctx: DaemonContext, taskId: string, run: string): Promise<string[]> {
  const events = await ctx.ws.events(taskId).read();
  const lock = events.filter((e) => e.type === 'acceptance.locked').at(-1);
  if (!lock || lock.run === run) return [];
  const task = await ctx.ws.readTask(taskId);
  const changed: string[] = [];
  for (const f of (lock.payload.files as Locked[] | undefined) ?? []) if ((await hashAtBranch(ctx, task.branch, f.path)) !== f.sha256) changed.push(f.path);
  if (changed.length) await ctx.ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: 'acceptance.tampered', payload: { run, files: changed } });
  return changed;
}
