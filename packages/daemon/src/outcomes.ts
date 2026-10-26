import { join } from 'node:path';
import { canonicalJSON, sha256Hex, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { gh, ghOk, git } from './git';
import { triggerLearn } from './learn';
import { releaseWorktrees } from './lifecycle';
import { parseTrailers } from './routes/approve';
import { updateSkillStatuses } from './skills';

/**
 * Outcomes after merge (R-030) and release signals (R-042): the daemon watches what happens to a
 * merged change - a revert on the base branch, a follow-up task touching the same files, a failed
 * CI run, an incident reported against the merge commit - and records it on the task that made the
 * change. Every scan is idempotent through the events already recorded.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export type ScanResult = { reverted: number; followup: number; ci: number };

function logLine(message: string): void {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message })}\n`);
}

type MergeRecord = { task: string; commit: string; into: string | null; ts: string };
type RevertCommit = { commit: string; by: string; reverts: string };

/** Commits on a branch whose message says `This reverts commit <sha>`, newest first as git prints them. */
async function revertCommits(root: string, branch: string): Promise<RevertCommit[]> {
  const r = await git(root, ['log', branch, '--grep=This reverts commit', '--format=%H%x1f%an%x1f%B%x1e']);
  if (r.code !== 0) return [];
  const out: RevertCommit[] = [];
  for (const entry of r.stdout.split('\x1e')) {
    const trimmed = entry.replace(/^\n+/, '');
    if (!trimmed.trim()) continue;
    const [commit, by, ...rest] = trimmed.split('\x1f');
    const m = /This reverts commit ([0-9a-fA-F]{7,40})/.exec(rest.join('\x1f'));
    if (commit && m?.[1]) out.push({ commit: commit.trim(), by: (by ?? '').trim(), reverts: m[1] });
  }
  return out;
}

async function scanRevertsAndFollowups(ctx: DaemonContext, result: ScanResult): Promise<MergeRecord[]> {
  const tasks = await ctx.ws.listTasks();
  const eventsByTask = new Map<string, Awaited<ReturnType<ReturnType<DaemonContext['ws']['events']>['read']>>>();
  const merges: MergeRecord[] = [];
  const filesByTask = new Map<string, Set<string>>();
  for (const task of tasks) {
    const events = await ctx.ws.events(task.id).read();
    eventsByTask.set(task.id, events);
    const files = new Set<string>();
    for (const e of events) {
      if (e.type === 'merge.completed' && str(e.payload.commit)) {
        merges.push({ task: task.id, commit: str(e.payload.commit) as string, into: str(e.payload.into), ts: e.ts });
      }
      if (e.type === 'file.changed' && str(e.payload.path)) files.add(str(e.payload.path) as string);
    }
    filesByTask.set(task.id, files);
  }

  const revertsByBranch = new Map<string, RevertCommit[]>();
  const currentBase = async (): Promise<string | null> => {
    const r = await git(ctx.ws.root, ['symbolic-ref', '-q', '--short', 'HEAD']);
    return r.stdout.trim() || null;
  };
  let fallbackBase: string | null | undefined;

  for (const merge of merges) {
    const events = eventsByTask.get(merge.task) ?? [];
    const branch = merge.into ?? ctx.ws.config.release?.base ?? (fallbackBase ??= await currentBase());
    if (branch) {
      let reverts = revertsByBranch.get(branch);
      if (!reverts) revertsByBranch.set(branch, (reverts = await revertCommits(ctx.ws.root, branch)));
      for (const revert of reverts) {
        const reverted = revert.reverts.toLowerCase();
        if (!merge.commit.toLowerCase().startsWith(reverted) && !reverted.startsWith(merge.commit.toLowerCase())) continue;
        const recorded = events.some(
          (e) =>
            e.type === 'outcome.reverted' &&
            (str(e.payload.commit) === revert.commit || str(e.payload.mergeCommit) === merge.commit || str(e.payload.revertedCommit) === merge.commit || str(e.payload.commit) === merge.commit),
        );
        if (recorded) continue;
        await ctx.ws.events(merge.task).append({
          task: merge.task,
          vendor: 'daemon',
          type: 'outcome.reverted',
          payload: { task: merge.task, commit: revert.commit, mergeCommit: merge.commit, revertedCommit: merge.commit, by: revert.by || 'unknown' },
          links: [{ kind: 'commit', ref: revert.commit }],
        });
        events.push(...(await ctx.ws.events(merge.task).read()).slice(events.length));
        result.reverted += 1;
      }
    }

    const mergedFiles = filesByTask.get(merge.task) ?? new Set<string>();
    if (mergedFiles.size === 0) continue;
    const mergedAt = Date.parse(merge.ts);
    for (const other of tasks) {
      if (other.id === merge.task) continue;
      const createdAt = Date.parse(other.createdAt);
      if (Number.isNaN(createdAt) || createdAt < mergedAt || createdAt - mergedAt > WEEK_MS) continue;
      const overlap = [...(filesByTask.get(other.id) ?? [])].filter((f) => mergedFiles.has(f)).sort();
      if (overlap.length === 0) continue;
      if (events.some((e) => e.type === 'outcome.followup' && str(e.payload.followup) === other.id)) continue;
      await ctx.ws.events(merge.task).append({
        task: merge.task,
        vendor: 'daemon',
        type: 'outcome.followup',
        payload: { task: merge.task, followup: other.id, files: overlap, mergeCommit: merge.commit },
      });
      events.push(...(await ctx.ws.events(merge.task).read()).slice(events.length));
      result.followup += 1;
    }
  }
  return merges;
}

type CiRun = { headSha?: string; conclusion?: string; databaseId?: number | string; url?: string; name?: string; status?: string };

/** The task a commit came from: its `Stint-Task:` trailer, or a recorded merge of the same sha. */
export async function taskForCommit(ctx: DaemonContext, commit: string): Promise<string | null> {
  // a commit id reaches git as an argument, so anything but hex is refused before git sees it
  if (!COMMIT.test(commit)) return null;
  const shown = await git(ctx.ws.root, ['show', '-s', '--format=%B', commit]);
  if (shown.code === 0) {
    const task = parseTrailers(shown.stdout)['Stint-Task'];
    if (task) return task;
  }
  for (const task of await ctx.ws.listTasks()) {
    const events = await ctx.ws.events(task.id).read();
    if (events.some((e) => e.type === 'merge.completed' && str(e.payload.commit) === commit)) return task.id;
  }
  return null;
}

/** Failed workflow runs on the base branch, linked to tasks by the trailer on their commit (R-042). */
async function scanCi(ctx: DaemonContext, merges: MergeRecord[], result: ScanResult): Promise<void> {
  // CI is read from GitHub only for a workspace that set up a release; nothing else calls out
  if (merges.length === 0 || !ctx.ws.config.release) return;
  const branches = new Set<string>();
  for (const m of merges) if (m.into) branches.add(m.into);
  if (ctx.ws.config.release?.base) branches.add(ctx.ws.config.release.base);
  if (branches.size === 0) {
    const r = await git(ctx.ws.root, ['symbolic-ref', '-q', '--short', 'HEAD']);
    if (r.stdout.trim()) branches.add(r.stdout.trim());
  }
  const eventsByTask = new Map<string, Awaited<ReturnType<ReturnType<DaemonContext['ws']['events']>['read']>>>();
  for (const branch of branches) {
    const r = await gh(ctx.ws.root, ['run', 'list', '--branch', branch, '--json', 'headSha,conclusion,databaseId,url,name']);
    if (r.code !== 0) {
      // Fail open loudly: the merge scan still ran, but CI on this branch was NOT checked.
      logLine(`outcome scan: CI runs on ${branch} were NOT checked: gh run list failed: ${r.stderr.trim() || r.stdout.trim()}`);
      continue;
    }
    let runs: CiRun[] = [];
    try {
      runs = JSON.parse(r.stdout) as CiRun[];
    } catch {
      logLine(`outcome scan: CI runs on ${branch} were NOT checked: gh run list did not return JSON`);
      continue;
    }
    if (!Array.isArray(runs)) continue;
    for (const run of runs) {
      const conclusion = (run.conclusion ?? run.status ?? '').toLowerCase();
      if (!['failure', 'failed', 'error', 'timed_out'].includes(conclusion)) continue;
      if (!run.headSha || run.databaseId === undefined) continue;
      const task = await taskForCommit(ctx, run.headSha);
      if (!task) continue;
      let events = eventsByTask.get(task);
      if (!events) eventsByTask.set(task, (events = await ctx.ws.events(task).read()));
      if (events.some((e) => e.type === 'outcome.ci' && String(e.payload.run) === String(run.databaseId))) continue;
      const event = await ctx.ws.events(task).append({
        task,
        vendor: 'daemon',
        type: 'outcome.ci',
        payload: {
          task,
          run: run.databaseId,
          status: conclusion,
          commit: run.headSha,
          mergeCommit: run.headSha,
          ...(run.url ? { url: run.url } : {}),
          ...(run.name ? { name: run.name } : {}),
        },
        links: [{ kind: 'commit', ref: run.headSha }],
      });
      events.push(event);
      result.ci += 1;
    }
  }
}

/** One full outcomes scan: reverts and follow-ups from git, then failing CI from `gh`. */
export async function scanOutcomes(ctx: DaemonContext): Promise<ScanResult> {
  const result: ScanResult = { reverted: 0, followup: 0, ci: 0 };
  const merges = await scanRevertsAndFollowups(ctx, result);
  await scanCi(ctx, merges, result);
  // a revert is a hurt for every skill mounted on that task (R-031)
  if (result.reverted > 0) await updateSkillStatuses(ctx);
  return result;
}

type PrCheck = { name: string; status: string };
type PrView = {
  state?: string;
  mergeCommit?: { oid?: string; sha?: string } | string | null;
  statusCheckRollup?: Array<Record<string, unknown>>;
};

const FAILING = new Set(['failure', 'failed', 'fail', 'error', 'timed_out', 'timed out']);

/** Normalises one statusCheckRollup entry (a check run or a status context) to a name and a status. */
function normaliseCheck(entry: Record<string, unknown>): PrCheck {
  const name = str(entry.name) ?? str(entry.context) ?? 'check';
  const status = (str(entry.conclusion) ?? str(entry.state) ?? str(entry.status) ?? 'unknown').toLowerCase();
  return { name, status };
}

export type ReleaseRefresh = { task: string; status: string; state: string | null; number: number | null; checks: PrCheck[]; failing: string[]; commit: string | null };

/**
 * Reads one task's pull request once: records changed checks, completes the task when the PR has
 * merged, and sends it back to Needs you (awaiting_approval) when a check failed (R-042).
 */
export async function refreshRelease(ctx: DaemonContext, id: string): Promise<ReleaseRefresh> {
  const task = await ctx.ws.readTask(id);
  const events = await ctx.ws.events(id).read();
  const opened = events.filter((e) => e.type === 'release.pr_opened').at(-1);
  if (!opened) throw new DaemonError('not_found', `${id} has no pull request`, 'approve it in PR release mode first');
  const number = typeof opened.payload.number === 'number' ? opened.payload.number : Number(opened.payload.number ?? NaN);
  if (!Number.isFinite(number)) throw new DaemonError('invalid', `${id} has a pull request with no number`);
  const out = await ghOk(ctx.ws.root, ['pr', 'view', String(number), '--json', 'state,mergeCommit,statusCheckRollup']);
  const view = JSON.parse(out) as PrView;
  const state = (view.state ?? '').toUpperCase() || null;
  const checks = (view.statusCheckRollup ?? []).map(normaliseCheck);
  const failing = checks.filter((c) => FAILING.has(c.status)).map((c) => c.name);
  const lastByName = new Map<string, string>();
  for (const e of events) if (e.type === 'release.checks' && str(e.payload.name)) lastByName.set(str(e.payload.name) as string, str(e.payload.status) ?? '');
  for (const check of checks) {
    if (lastByName.get(check.name) === check.status) continue;
    await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'release.checks', payload: { name: check.name, status: check.status, number, checks } });
    lastByName.set(check.name, check.status);
  }

  const mergeCommit =
    typeof view.mergeCommit === 'string' ? view.mergeCommit : (view.mergeCommit?.oid ?? view.mergeCommit?.sha ?? null);
  if (state === 'MERGED') {
    const commit = mergeCommit ?? '';
    const already = events.some((e) => e.type === 'merge.completed');
    if (!already) {
      const base = str(opened.payload.base) ?? ctx.ws.config.release?.base ?? 'main';
      const trailers = (opened.payload.trailers ?? { 'Stint-Task': id }) as Record<string, string>;
      await ctx.ws.events(id).append({
        task: id,
        vendor: 'daemon',
        type: 'merge.completed',
        payload: { branch: task.branch, into: base, commit, pr: number, ...(str(opened.payload.url) ? { url: str(opened.payload.url) } : {}), trailers },
      });
      void ctx.otel.task(id).catch(() => undefined);
      const v = await ctx.ws.verification(id).latest();
      const granted = events.filter((e) => e.type === 'approval.granted').at(-1);
      await writeJsonAtomic(join(await ctx.ws.taskDir(id), 'signoff.json'), {
        by: str(granted?.payload.by) ?? 'you',
        at: new Date().toISOString(),
        verificationHash: v ? `sha256:${sha256Hex(canonicalJSON(v))}` : null,
        commit,
      });
    }
    if (task.status !== 'done') {
      await ctx.ws.writeTask(id, { status: 'done', assignee: null, pendingAsk: null });
      try {
        await releaseWorktrees(ctx, await ctx.ws.readTask(id));
      } catch (err) {
        logLine(`release: ${id} merged but its worktrees were not removed: ${err instanceof Error ? err.message : String(err)}`);
      }
      triggerLearn(ctx, id);
    }
    return { task: id, status: 'done', state, number, checks, failing, commit: commit || null };
  }

  if (failing.length > 0) {
    const pendingAsk = `Pull request check failed: ${failing[0]}`.slice(0, 400);
    await ctx.ws.writeTask(id, { status: 'awaiting_approval', pendingAsk });
    return { task: id, status: 'awaiting_approval', state, number, checks, failing, commit: null };
  }
  if (state === 'CLOSED') {
    await ctx.ws.writeTask(id, { status: 'awaiting_approval', pendingAsk: 'The pull request was closed without merging.' });
    return { task: id, status: 'awaiting_approval', state, number, checks, failing, commit: null };
  }
  if (task.status !== 'in_review' && task.status !== 'done') await ctx.ws.writeTask(id, { status: 'in_review' });
  return { task: id, status: 'in_review', state, number, checks, failing, commit: null };
}

/** The release poller: every task waiting in review gets one refresh. */
export async function pollReleases(ctx: DaemonContext): Promise<void> {
  for (const task of await ctx.ws.listTasks()) {
    if (task.status !== 'in_review') continue;
    try {
      await refreshRelease(ctx, task.id);
    } catch (err) {
      logLine(`release: the pull request for ${task.id} was NOT checked: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const IncidentBody = z.strictObject({
  commit: z.string().regex(COMMIT).optional(),
  task: z.string().regex(/^T-[0-9]{4,}$/).optional(),
  kind: z.literal('incident'),
  summary: z.string().min(1).max(400),
  url: z.url().optional(),
});

export function outcomeRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/outcomes/scan', async (c) => c.json(await scanOutcomes(ctx)));

  app.post('/api/outcomes', async (c) => {
    const body = IncidentBody.parse(await c.req.json());
    let task = body.task ?? null;
    if (task) await ctx.ws.readTask(task);
    else if (body.commit) task = await taskForCommit(ctx, body.commit);
    if (!task) throw new DaemonError('not_found', 'no task matches that commit', 'send a task id, or a merge commit carrying a Stint-Task trailer');
    const event = await ctx.ws.events(task).append({
      task,
      vendor: 'daemon',
      type: 'outcome.incident',
      payload: {
        task,
        kind: 'incident',
        summary: body.summary,
        ...(body.url ? { url: body.url } : {}),
        ...(body.commit ? { commit: body.commit, mergeCommit: body.commit } : {}),
      },
      ...(body.url ? { links: [{ kind: 'url' as const, ref: body.url }] } : {}),
    });
    return c.json(event, 201);
  });

  app.post('/api/tasks/:id/release/refresh', async (c) => c.json(await refreshRelease(ctx, c.req.param('id'))));
}
