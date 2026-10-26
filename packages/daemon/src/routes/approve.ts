import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJSON, runsFromEvents, sha256Hex, writeJsonAtomic } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { git, gitOk, identityArgs } from '../git';
import { triggerLearn } from '../learn';
import { releaseWorktrees } from '../lifecycle';

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

/**
 * Approval is a real merge into the branch checked out in the main tree. The merge is computed with
 * `git merge-tree` first, so a conflict leaves every tree as it was; the main tree only moves by a
 * fast-forward to the finished merge commit, and only when it has no uncommitted tracked changes.
 */
async function merge(ctx: DaemonContext, id: string, squash: boolean): Promise<{ commit: string; base: string; trailers: Trailers }> {
  const root = ctx.ws.root;
  const task = await ctx.ws.readTask(id);
  const base = (await git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim();
  if (!base) throw new DaemonError('invalid', 'the main tree is not on a branch', 'check out the branch to merge into');
  const dirty = await gitOk(root, ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude).stint']);
  if (dirty.trim()) throw new DaemonError('dirty_tree', 'the main tree has uncommitted changes to tracked files', 'commit or stash them; approve merges into the checked-out branch');

  const mt = await git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, task.branch]);
  if (mt.code === 1) {
    const files = mt.stdout.trim().split('\n').slice(1).filter(Boolean);
    throw new DaemonError('merge_conflict', `${task.branch} conflicts with ${base}`, { files });
  }
  if (mt.code !== 0) throw new Error(`git merge-tree failed: ${mt.stderr.trim()}`);
  const tree = mt.stdout.trim().split('\n')[0] as string;

  const events = await ctx.ws.events(id).read();
  const runs = runsFromEvents(events).map((r) => r.run);
  const packet = await ctx.ws.handoffs(id).latest();
  const v = await ctx.ws.verification(id).latest();
  const trailers: Trailers = {
    'Stint-Task': id,
    'Stint-Runs': runs.join(','),
    'Stint-Handoff': packet?.hash ?? 'none',
    'Stint-Verified': v ? `${v.command} ${v.passed}/${v.passed + v.failed}` : 'none',
  };
  const message = `${task.title} (${id})\n\n${packet?.summary ?? task.goal}\n\n${Object.entries(trailers).map(([k, val]) => `${k}: ${val}`).join('\n')}\n`;
  const msgFile = join(ctx.ws.cacheDir, `merge-${id}.txt`);
  await mkdir(ctx.ws.cacheDir, { recursive: true });
  await writeFile(msgFile, message);
  const baseSha = (await gitOk(root, ['rev-parse', base])).trim();
  const parents = squash ? ['-p', baseSha] : ['-p', baseSha, '-p', task.branch];
  const commit = (await gitOk(root, [...(await identityArgs(root)), 'commit-tree', tree, ...parents, '-F', msgFile])).trim();
  await rm(msgFile, { force: true });
  await gitOk(root, ['merge', '--ff-only', '-q', commit]);
  return { commit, base, trailers };
}

export function approveRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/approve', async (c) => {
    const id = c.req.param('id');
    const body = ApproveBody.parse(await c.req.json().catch(() => ({})));
    const task = await ctx.ws.readTask(id);
    if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'stop it or let it finish first');
    const v = await ctx.ws.verification(id).latest();
    if (!v || v.status !== 'green') throw new DaemonError('verification_red', 'approve needs a green verification by the daemon', v ? `${v.failed} failed` : 'nothing verified yet');
    const review = await ctx.ws.readDoc<{ verdict: string }>(id, 'review.json');
    if (review?.verdict === 'block') throw new DaemonError('review_blocked', 'the latest review blocks this change', 'request changes, then review again');

    const { commit, base, trailers } = await merge(ctx, id, body.squash ?? false);
    const by = body.by ?? 'you';
    const at = new Date().toISOString();
    const events = ctx.ws.events(id);
    await events.append({ task: id, vendor: 'human', type: 'approval.granted', payload: { by, verification: { passed: v.passed, failed: v.failed }, review: review?.verdict ?? null } });
    await events.append({ task: id, vendor: 'daemon', type: 'merge.completed', payload: { branch: task.branch, into: base, commit, squash: body.squash ?? false, trailers } });
    await writeJsonAtomic(join(await ctx.ws.taskDir(id), 'signoff.json'), { by, at, verificationHash: `sha256:${sha256Hex(canonicalJSON(v))}`, commit });
    await ctx.ws.writeTask(id, { status: 'done', assignee: null, pendingAsk: null });
    // the branch stays (branchRetentionDays); only the worktrees go, and never with --force
    await releaseWorktrees(ctx, await ctx.ws.readTask(id));
    const result = { commit, into: base, trailers };
    // learn runs after the response is computed and cannot delay or fail it
    triggerLearn(ctx, id);
    return c.json(result);
  });

  app.post('/api/tasks/:id/reject', async (c) => {
    const id = c.req.param('id');
    const { reason } = ReasonBody.parse(await c.req.json());
    await ctx.ws.readTask(id);
    const d = await ctx.ws.decisions(id).append({ text: `Rejected: ${reason}`.slice(0, 200), by: 'you' });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by }, links: [{ kind: 'decision', ref: d.id }] });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'approval.rejected', payload: { reason, decision: d.id } });
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: reason });
    const result = { status: 'building', decision: d.id };
    triggerLearn(ctx, id);
    return c.json(result);
  });

  app.post('/api/tasks/:id/request-changes', async (c) => {
    const id = c.req.param('id');
    const { text } = TextBody.parse(await c.req.json());
    await ctx.ws.readTask(id);
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'approval.rejected', payload: { reason: text, changes: true } });
    await ctx.ws.writeTask(id, { status: 'building', pendingAsk: text });
    return c.json({ status: 'building' });
  });
}
