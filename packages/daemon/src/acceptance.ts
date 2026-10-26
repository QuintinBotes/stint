import { join } from 'node:path';
import type { Plan, StintEvent } from '@stint-dev/core';
import { readJsonIfExists, sha256Hex, writeJsonAtomic, type Workspace } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { git } from './git';
import { namedFiles } from './paths';

/** A path a test runner would pick up: a test folder, or a `.test.` or `.spec.` file. */
export const isTestPath = (p: string) => /(^|\/)(test|tests|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

export type LockedFile = { path: string; sha256: string };
export type LockScope = 'plan' | 'tests-first';
export type TamperResult = { files: string[]; allowedBy?: string };

type LockCtx = { ws: Workspace };

const lockFile = async (ws: Workspace, taskId: string) => join(await ws.taskDir(taskId), 'tests.lock.json');

/** The file as the ref has it now; a deleted file hashes as "deleted". */
async function hashAtRef(cwd: string, ref: string, path: string): Promise<string> {
  const r = await git(cwd, ['show', `${ref}:${path}`]);
  return r.code === 0 ? `sha256:${sha256Hex(r.stdout)}` : 'deleted';
}

const hashAtBranch = (ctx: LockCtx, branch: string, path: string) => hashAtRef(ctx.ws.root, branch, path);

const byPath = (files: LockedFile[]): LockedFile[] => {
  const map = new Map<string, LockedFile>();
  for (const f of files) if (f && typeof f.path === 'string' && typeof f.sha256 === 'string') map.set(f.path, { path: f.path, sha256: f.sha256 });
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
};

/** The one lock file (R-029): the plan-time lock and the tests-first lock merged, as `{path, sha256}` rows. */
export async function readTestsLock(ws: Workspace, taskId: string, events?: StintEvent[]): Promise<LockedFile[]> {
  const raw = await readJsonIfExists<unknown>(await lockFile(ws, taskId)).catch(() => null);
  const fromFile = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { files?: unknown }).files) ? (raw as { files: LockedFile[] }).files : null;
  if (fromFile) return byPath(fromFile as LockedFile[]);
  // tasks locked before the file existed: the lock events are the record, merged the same way
  const list = events ?? (await ws.events(taskId).read());
  return byPath(list.filter((e) => e.type === 'acceptance.locked').flatMap((e) => ((e.payload.files as LockedFile[] | undefined) ?? [])));
}

async function writeTestsLock(ws: Workspace, taskId: string, files: LockedFile[]): Promise<LockedFile[]> {
  const merged = byPath(files);
  await writeJsonAtomic(await lockFile(ws, taskId), merged);
  return merged;
}

/** Adds files to the one lock file and records which kind of lock added them. */
async function mergeLock(ws: Workspace, taskId: string, additions: LockedFile[], scope: LockScope, run: string | undefined, failing: string[]): Promise<LockedFile[]> {
  const existing = await readTestsLock(ws, taskId);
  await writeTestsLock(ws, taskId, [...existing, ...additions]);
  await ws.events(taskId).append({
    task: taskId,
    ...(run ? { run } : {}),
    vendor: 'daemon',
    type: 'acceptance.locked',
    payload: { scope, ...(run ? { run } : {}), files: byPath(additions), failing },
  });
  return additions;
}

/** The ref the lock is taken from: the commit the task starts from, so a later plan cannot bless edits already made. */
async function lockRef(ws: Workspace, taskId: string): Promise<string> {
  const task = await ws.readTask(taskId);
  if ((await git(ws.root, ['rev-parse', '--verify', '-q', `${task.baseCommit}^{commit}`])).code === 0) return task.baseCommit;
  if ((await git(ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code === 0) return task.branch;
  return 'HEAD';
}

/**
 * The plan-time lock (R-029): the test files the plan names (a step's files that are tests, a step's test) and
 * the test files the task's goal and acceptance name, as they are at the task's start commit. Tests nobody named
 * stay free to extend; deleting or shrinking them is the risk check's job (R-039).
 * Runs when plan.json is written, or at the first assign when there is no plan; a task locks this way once.
 */
export async function lockPlanTests(ctx: LockCtx, taskId: string, opts: { run?: string; plan?: Plan | null } = {}): Promise<LockedFile[]> {
  const ws = ctx.ws;
  const events = await ws.events(taskId).read();
  const locked = events.some((e) => e.type === 'acceptance.locked' && (e.payload.scope === 'plan' || e.payload.scope === undefined));
  const file = await readJsonIfExists<unknown>(await lockFile(ws, taskId)).catch(() => null);
  if (locked || file !== null) return readTestsLock(ws, taskId, events);
  const plan = opts.plan !== undefined ? opts.plan : await ws.readPlan(taskId);
  const task = await ws.readTask(taskId);
  const ref = await lockRef(ws, taskId);
  const inRepo = new Set((await git(ws.root, ['ls-tree', '-r', '--name-only', '-z', ref])).stdout.split('\0').filter(Boolean));
  const named = [...namedFiles(task, null), ...(plan?.steps ?? []).flatMap((s) => [...s.files, ...(s.test ? [s.test] : [])])];
  const candidates = new Set(named.filter((f) => isTestPath(f) && inRepo.has(f)));
  const files: LockedFile[] = [];
  for (const path of [...candidates].sort()) {
    const sha256 = await hashAtRef(ws.root, ref, path);
    if (sha256 !== 'deleted') files.push({ path, sha256 });
  }
  return mergeLock(ws, taskId, files, 'plan', opts.run, []);
}

/** Locks the tests a specify run wrote: their paths and hashes at the branch head, and the tests that failed. */
export async function lockAcceptance(ctx: DaemonContext, taskId: string, run: string): Promise<LockedFile[]> {
  const task = await ctx.ws.readTask(taskId);
  const events = await ctx.ws.events(taskId).read();
  // git's own names for the files the run's commit touched: numstat's display form quotes some names and folds renames
  const commit = events.find((e) => e.type === 'run.finished' && e.run === run)?.payload.commit;
  const listed = typeof commit === 'string' ? (await git(ctx.ws.root, ['diff-tree', '--no-commit-id', '--name-only', '-z', '-r', '--no-renames', '--root', commit])).stdout.split('\0') : [];
  const fromEvents = events.filter((e) => e.type === 'file.changed' && e.run === run).map((e) => String(e.payload.path));
  const paths = [...new Set((listed.some(Boolean) ? listed : fromEvents).filter(Boolean).filter(isTestPath))];
  const files: LockedFile[] = [];
  for (const path of paths) files.push({ path, sha256: await hashAtBranch(ctx, task.branch, path) });
  const failing = (events.filter((e) => e.type === 'verification.ran' && e.run === run).at(-1)?.payload.failing as string[] | undefined) ?? [];
  return mergeLock(ctx.ws, taskId, files, 'tests-first', run, failing);
}

/** What a changed locked file does to the verification; 'fail' unless the config says otherwise (R-029). */
export function tamperMode(ws: Workspace): 'off' | 'warn' | 'fail' {
  return ws.config.verify?.tamper ?? 'fail';
}

/**
 * The escape hatch: a `decision.recorded` after the lock whose text starts with `tests:` and names the file.
 * Every changed file needs one; returns the decisions that allowed the change, or undefined when some file has none.
 */
export function allowingDecision(events: StintEvent[], files: string[]): string | undefined {
  const used = new Map<string, string>();
  for (const path of files) {
    const lockSeq = events.filter((e) => e.type === 'acceptance.locked' && ((e.payload.files as LockedFile[] | undefined) ?? []).some((f) => f.path === path)).at(-1)?.seq ?? 0;
    const decision = events.find((e) => {
      if (e.type !== 'decision.recorded' || e.seq <= lockSeq) return false;
      const text = typeof e.payload.text === 'string' ? e.payload.text.trim() : '';
      return text.startsWith('tests:') && text.includes(path);
    });
    if (!decision) return undefined;
    const text = String(decision.payload.text).trim();
    const id = typeof decision.payload.id === 'string' ? decision.payload.id : '';
    used.set(decision.id, id ? `${id}: ${text}` : text);
  }
  return [...used.values()].join('; ');
}

/**
 * Compares the locked files at a ref with the lock (R-029). With `emit`, a change is recorded as
 * `verification.tampered { run, files, allowedBy? }`, once per run and changed set.
 */
export async function checkTamperAtRef(ws: Workspace, taskId: string, run: string, cwd: string, ref: string, emit = true): Promise<TamperResult | null> {
  if (tamperMode(ws) === 'off') return null;
  const events = await ws.events(taskId).read();
  const locked = await readTestsLock(ws, taskId, events);
  if (locked.length === 0) return null;
  const ownLock = new Set(
    events
      .filter((e) => e.type === 'acceptance.locked' && e.payload.run === run)
      .flatMap((e) => ((e.payload.files as LockedFile[] | undefined) ?? []).map((f) => f.path)),
  );
  const changed: string[] = [];
  for (const f of locked) {
    if (ownLock.has(f.path)) continue;
    if ((await hashAtRef(cwd, ref, f.path)) !== f.sha256) changed.push(f.path);
  }
  if (changed.length === 0) return null;
  const allowedBy = allowingDecision(events, changed);
  const result: TamperResult = { files: changed, ...(allowedBy ? { allowedBy } : {}) };
  if (emit) {
    const seen = events.some(
      (e) => e.type === 'verification.tampered' && e.run === run && JSON.stringify([...((e.payload.files as string[] | undefined) ?? [])].sort()) === JSON.stringify([...changed].sort()),
    );
    if (!seen) await ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: 'verification.tampered', payload: { run, ...result } });
  }
  return result;
}

/** After a run, any locked test file that changed on the branch is recorded: green bought by editing the tests is not done. */
export async function checkAcceptanceLock(ctx: DaemonContext, taskId: string, run: string): Promise<string[]> {
  const task = await ctx.ws.readTask(taskId);
  const tamper = await checkTamperAtRef(ctx.ws, taskId, run, ctx.ws.root, task.branch);
  return tamper?.files ?? [];
}
