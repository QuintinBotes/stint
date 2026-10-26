import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJSON, runsFromEvents, sha256Hex, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { ghOk, git, gitOk, identityArgs } from '../git';
import { triggerLearn } from '../learn';
import { releaseWorktrees } from '../lifecycle';
import { updateSkillStatuses } from '../skills';

/** Skill statuses follow task outcomes; a status pass that fails is said out loud, never hidden. */
async function skillStatuses(ctx: DaemonContext): Promise<void> {
  try {
    await updateSkillStatuses(ctx);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `skill statuses were NOT updated after the outcome: ${err instanceof Error ? err.message : String(err)}` })}\n`);
  }
}

const ApproveBody = z.strictObject({ squash: z.boolean().optional(), by: z.string().min(1).max(80).optional() });
const ReasonBody = z.strictObject({ reason: z.string().min(1).max(400) });
const TextBody = z.strictObject({ text: z.string().min(1).max(400) });

export type Trailers = { 'Stint-Task': string; 'Stint-Runs': string; 'Stint-Handoff': string; 'Stint-Verified': string };

/** The trailers any tool can read back with `git interpret-trailers --parse`. */
export function parseTrailers(body: string): Partial<Trailers> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^(Stint-[A-Za-z]+): (.+)$/gm)) out[m[1] as string] = (m[2] as string).trim();
  return out as Partial<Trailers>;
}

/** One line: a newline in a title or summary could otherwise start a trailer block of its own. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Approval is a real merge into the branch checked out in the main tree, of exactly the commit the daemon
 * verified. The merge is computed with `git merge-tree` first, so a conflict leaves every tree as it was; the
 * main tree only moves by a fast-forward to the finished merge commit, and only when nothing in it is in the way.
 */
async function merge(ctx: DaemonContext, id: string, squash: boolean, verifiedCommit: string | undefined): Promise<{ commit: string; base: string; trailers: Trailers }> {
  const root = ctx.ws.root;
  const task = await ctx.ws.readTask(id);
  const base = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  if (!base) throw new DaemonError('invalid', 'the main tree is not on a branch', 'check out the branch to merge into');
  const dirty = await gitOk(root, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).stint']);
  if (dirty.trim()) throw new DaemonError('dirty_tree', 'the main tree has uncommitted changes to tracked files', 'commit or stash them; approve merges into the checked-out branch');

  const branchHead = (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).stdout.trim();
  if (!branchHead) throw new DaemonError('not_found', `the task branch ${task.branch} does not exist`);
  // only the commit the tests ran on is merged; a run that committed after them has not been verified
  if (verifiedCommit && verifiedCommit !== branchHead) {
    throw new DaemonError('verification_red', `${task.branch} moved after the last verification`, `verified ${verifiedCommit.slice(0, 10)}, the branch is at ${branchHead.slice(0, 10)}; run the tests again`);
  }
  if ((await git(root, ['merge-base', '--is-ancestor', branchHead, 'HEAD'])).code === 0) {
    throw new DaemonError('invalid', `${task.branch} is already merged into ${base}`, 'nothing to merge');
  }
  const baseSha = (await gitOk(root, ['rev-parse', '--verify', `refs/heads/${base}^{commit}`])).trim();

  const mt = await git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', baseSha, branchHead]);
  if (mt.code === 1) {
    const files = mt.stdout.trim().split('\n').slice(1).filter(Boolean);
    throw new DaemonError('merge_conflict', `${task.branch} conflicts with ${base}`, { files });
  }
  if (mt.code !== 0) throw new Error(`git merge-tree failed: ${mt.stderr.trim()}`);
  const tree = mt.stdout.trim().split('\n')[0] as string;

  // a file the merge adds that already exists here (ignored or untracked) would be overwritten by the fast-forward
  const added = (await gitOk(root, ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=A', baseSha, tree])).split('\0').filter(Boolean);
  const inTheWay = added.filter((p) => existsSync(join(root, p)));
  if (inTheWay.length) throw new DaemonError('dirty_tree', 'the merge would overwrite files in your tree that git does not track', { files: inTheWay });

  const events = await ctx.ws.events(id).read();
  const runs = runsFromEvents(events).map((r) => r.run);
  const packet = await ctx.ws.handoffs(id).latest();
  const v = await ctx.ws.verification(id).latest();
  const trailers: Trailers = {
    'Stint-Task': id,
    'Stint-Runs': runs.join(','),
    'Stint-Handoff': packet?.hash ?? 'none',
    'Stint-Verified': v ? `${oneLine(v.command)} ${v.passed}/${v.passed + v.failed}` : 'none',
  };
  const message = `${oneLine(task.title)} (${id})\n\n${oneLine(packet?.summary ?? task.goal)}\n\n${Object.entries(trailers).map(([k, val]) => `${k}: ${val}`).join('\n')}\n`;
  const msgFile = join(ctx.ws.cacheDir, `merge-${id}.txt`);
  await mkdir(ctx.ws.cacheDir, { recursive: true });
  await writeFile(msgFile, message);
  const parents = squash ? ['-p', baseSha] : ['-p', baseSha, '-p', branchHead];
  const commit = (await gitOk(root, [...(await identityArgs(root)), 'commit-tree', tree, ...parents, '-F', msgFile])).trim();
  await rm(msgFile, { force: true });
  // the person may have switched branches while the merge was computed; never move a different branch
  const now = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  if (now !== base) throw new DaemonError('invalid', `the checked-out branch changed from ${base} to ${now || 'a detached HEAD'} during approve`, 'approve again');
  await gitOk(root, ['merge', '--ff-only', '-q', commit]);
  return { commit, base, trailers };
}

/**
 * PR release mode (R-042): approval pushes the task branch and opens a pull request carrying the
 * packet summary and the same trailers a local merge would. The task then waits in review until
 * the pull request merges; the poller in outcomes.ts follows its checks.
 */
async function openPullRequest(ctx: DaemonContext, id: string, verifiedCommit: string | undefined): Promise<{ url: string; number: number; base: string; trailers: Trailers }> {
  const root = ctx.ws.root;
  const release = ctx.ws.config.release;
  if (!release) throw new DaemonError('invalid', 'PR release mode needs a release config');
  const task = await ctx.ws.readTask(id);
  const base = release.base ?? (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  if (!base) throw new DaemonError('invalid', 'the main tree is not on a branch', 'check out the base branch or set release.base');
  const branchHead = (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).stdout.trim();
  if (!branchHead) throw new DaemonError('not_found', `the task branch ${task.branch} does not exist`);
  if (verifiedCommit && verifiedCommit !== branchHead) {
    throw new DaemonError('verification_red', `${task.branch} moved after the last verification`, `verified ${verifiedCommit.slice(0, 10)}, the branch is at ${branchHead.slice(0, 10)}; run the tests again`);
  }
  const events = await ctx.ws.events(id).read();
  const runs = runsFromEvents(events).map((r) => r.run);
  const packet = await ctx.ws.handoffs(id).latest();
  const v = await ctx.ws.verification(id).latest();
  const trailers: Trailers = {
    'Stint-Task': id,
    'Stint-Runs': runs.join(','),
    'Stint-Handoff': packet?.hash ?? 'none',
    'Stint-Verified': v ? `${oneLine(v.command)} ${v.passed}/${v.passed + v.failed}` : 'none',
  };
  const pushed = await git(root, ['push', release.remote, task.branch]);
  if (pushed.code !== 0) throw new Error(`git push ${release.remote} ${task.branch} failed: ${pushed.stderr.trim() || pushed.stdout.trim()}`);
  const summary = oneLine(packet?.summary ?? task.goal);
  const body = `${summary}\n\n${Object.entries(trailers).map(([k, val]) => `${k}: ${val}`).join('\n')}\n`;
  const out = await ghOk(root, ['pr', 'create', '--head', task.branch, '--base', base, '--title', task.title, '--body', body]);
  const url = (out.match(/https?:\/\/\S+/)?.[0] ?? out.trim().split('\n').find((l) => l.trim()) ?? '').trim();
  const number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? /(\d+)\s*$/.exec(url)?.[1] ?? /#(\d+)/.exec(out)?.[1] ?? NaN);
  if (!url || !Number.isFinite(number)) throw new Error(`gh pr create did not return a pull request URL: ${out.trim()}`);
  return { url, number, base, trailers };
}

const approving = new Set<string>();

export function approveRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/approve', async (c) => {
    const id = c.req.param('id');
    const body = ApproveBody.parse(await c.req.json().catch(() => ({})));
    const key = `${ctx.ws.root}:${id}`;
    // a double click or a retry must never merge twice
    if (approving.has(key)) throw new DaemonError('run_active', `${id} is already being approved`);
    approving.add(key);
    try {
      const task = await ctx.ws.readTask(id);
      if (task.status === 'done') throw new DaemonError('invalid', `${id} is already approved and merged`);
      if (ctx.runs.get(id) || task.status === 'verifying') throw new DaemonError('run_active', `${id} has a run that is still running or being verified`, 'wait for the daemon to finish');
      const v = await ctx.ws.verification(id).latest();
      if (!v || v.status !== 'green') throw new DaemonError('verification_red', 'approve needs a green verification by the daemon', v ? `${v.failed} failed` : 'nothing verified yet');
      const review = await ctx.ws.readDoc<{ verdict: string }>(id, 'review.json');
      if (review?.verdict === 'block') throw new DaemonError('review_blocked', 'the latest review blocks this change', 'request changes, then review again');
      const log = await ctx.ws.events(id).read();
      const lockAt = log.findIndex((e) => e.type === 'acceptance.locked');
      // a tamper the escape hatch allowed (a `tests:` decision naming every file) does not stand in the way
      const tampered =
        lockAt >= 0
          ? log.slice(lockAt).find((e) => (e.type === 'verification.tampered' || e.type === 'acceptance.tampered') && !e.payload.allowedBy)
          : undefined;
      if (tampered) throw new DaemonError('review_blocked', 'an agent changed the locked acceptance tests', { files: tampered.payload.files });

      if (ctx.ws.config.release?.mode === 'pr') {
        if (task.status === 'in_review') throw new DaemonError('invalid', `${id} already has a pull request in review`);
        const by = body.by ?? 'you';
        const pr = await openPullRequest(ctx, id, v.commit);
        const releaseEvents = ctx.ws.events(id);
        await releaseEvents.append({ task: id, vendor: 'human', type: 'approval.granted', payload: { by, verification: { passed: v.passed, failed: v.failed }, review: review?.verdict ?? null } });
        await releaseEvents.append({
          task: id,
          vendor: 'daemon',
          type: 'release.pr_opened',
          payload: { url: pr.url, number: pr.number, branch: task.branch, base: pr.base, remote: ctx.ws.config.release.remote, trailers: pr.trailers },
          links: [{ kind: 'url', ref: pr.url }],
        });
        await ctx.ws.writeTask(id, { status: 'in_review', assignee: null, pendingAsk: null });
        return c.json({ status: 'in_review', url: pr.url, number: pr.number, pr: { url: pr.url, number: pr.number }, into: pr.base, trailers: pr.trailers });
      }

      const { commit, base, trailers } = await merge(ctx, id, body.squash ?? false, v.commit);
      const by = body.by ?? 'you';
      const at = new Date().toISOString();
      const events = ctx.ws.events(id);
      await events.append({ task: id, vendor: 'human', type: 'approval.granted', payload: { by, verification: { passed: v.passed, failed: v.failed }, review: review?.verdict ?? null } });
      await events.append({ task: id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: base, commit, squash: body.squash ?? false, trailers } });
      void ctx.otel.task(id).catch(() => undefined);
      await writeJsonAtomic(join(await ctx.ws.taskDir(id), 'signoff.json'), { by, at, verificationHash: `sha256:${sha256Hex(canonicalJSON(v))}`, commit });
      await ctx.ws.writeTask(id, { status: 'done', assignee: null, pendingAsk: null });
      // only once it reads as done can a task waiting on it move
      void ctx.autopilot.onDone(id).catch(() => undefined);
      // the merge has landed; a worktree that will not go away is reported, not turned into a failed approve
      let cleanup: string | null = null;
      try {
        await releaseWorktrees(ctx, await ctx.ws.readTask(id));
      } catch (err) {
        cleanup = err instanceof Error ? err.message : String(err);
      }
      const result = { commit, into: base, trailers, ...(cleanup ? { cleanup } : {}) };
      await skillStatuses(ctx);
      // learn runs after the response is computed and cannot delay or fail it
      triggerLearn(ctx, id);
      return c.json(result);
    } finally {
      approving.delete(key);
    }
  });

  app.post('/api/tasks/:id/reject', async (c) => {
    const id = c.req.param('id');
    const { reason } = ReasonBody.parse(await c.req.json());
    await ctx.ws.readTask(id);
    const d = await ctx.ws.decisions(id).append({ text: `Rejected: ${reason}`.slice(0, 200), by: 'you' });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by }, links: [{ kind: 'decision', ref: d.id }] });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'approval.rejected', payload: { reason, decision: d.id } });
    void ctx.otel.task(id).catch(() => undefined);
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: reason });
    const result = { status: 'building', decision: d.id };
    await skillStatuses(ctx);
    triggerLearn(ctx, id);
    return c.json(result);
  });

  app.post('/api/tasks/:id/request-changes', async (c) => {
    const id = c.req.param('id');
    const { text } = TextBody.parse(await c.req.json());
    await ctx.ws.readTask(id);
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'approval.rejected', payload: { reason: text, changes: true } });
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: text });
    await skillStatuses(ctx);
    return c.json({ status: 'building' });
  });
}
