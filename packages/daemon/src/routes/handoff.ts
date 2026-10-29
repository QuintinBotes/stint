import { type Host, capDiff, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { billingHost, runsFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Enrichment, RunResult } from '../adapter';
import type { DaemonContext } from '../app';
import { quizPacket } from '../quiz';
import { DaemonError } from '../errors';
import { buildHandoff } from '../handoff';
import { assign, priced, stop } from '../lifecycle';
import { markCommentsHanded, pendingCommentSuffix, readComments } from './comments';
import { effectiveChain, walkChain } from '../route';
import { worktreePath } from '../worktree';

const ENRICH_CAP_MS = 20_000;

/** Asks the leaving agent to improve four fields, only while its session is alive, capped at 20 s; never throws. */
async function enrichFrom(ctx: DaemonContext, taskId: string, run: string, adapterId: string, sessionId: string | undefined, model: string | undefined): Promise<Enrichment | null> {
  const adapter = ctx.adapters.find((a) => a.id === adapterId);
  if (!adapter?.enrich || !adapter.capabilities.resumable || !sessionId) return null;
  const task = await ctx.ws.readTask(taskId);
  const ask = adapter
    .enrich({ task, run, sessionId, worktree: worktreePath(ctx.ws, taskId, run), ...(model ? { model } : {}) })
    .then(async ({ cost, ...fields }) => {
      // recorded when the call answers, even after the cap gave up waiting: it was paid for either way (D-060)
      if (cost) await ctx.ws.events(taskId).append({ task: taskId, vendor: 'daemon', type: 'cost.recorded', payload: { for: 'enrich', run, host: billingHost(null, adapterId), model: model ?? null, cost: priced(ctx, adapterId, { cost, model }) } });
      return fields;
    })
    .catch(() => ({}));
  return Promise.race([ask, Bun.sleep(ENRICH_CAP_MS).then(() => ({}))]);
}

const DIGEST_CAP_MS = 75_000;
const Digest = z.strictObject({ summary: z.string().min(1).max(400) });

/**
 * When the leaving agent cannot be asked (it was killed, or its session is gone), a model reads the diff instead and
 * says what the code now does and what is visibly unfinished: the facts a file list leaves out. Capped; never throws.
 */
export async function digestFrom(ctx: DaemonContext, taskId: string): Promise<Enrichment | null> {
  try {
    const task = await ctx.ws.readTask(taskId);
    const diff = capDiff(String(await ctx.worktrees.diff(task, 'unified')), 2500).text;
    if (!diff.trim()) return null;
    const prompt = `A coding agent stopped part way through this task. From the diff alone, say in at most 400 characters what the code now does, naming the files and the main functions or types, and what is visibly not done yet. Plain sentences, no preamble, nothing the diff does not show.

Task: ${task.title}. ${task.goal}

Diff:
${diff}`;
    const call = walkChain<{ value: z.infer<typeof Digest> }>({
      role: 'summary',
      chain: effectiveChain('summary', ctx.ws.config.routes, task.routes),
      hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
      emit: (e) => ctx.ws.events(taskId).append({ task: taskId, vendor: 'daemon', type: e.type, payload: e.payload }).then(() => undefined),
      call: (h, model, c) => h.complete(Digest, prompt, { model, timeoutMs: c.timeoutMs, emit: c.emit }),
    }).then(async (r) => {
      // recorded when the call answers, even after the cap gave up waiting: it was paid for either way
      await ctx.ws.events(taskId).append({ task: taskId, vendor: 'daemon', type: 'cost.recorded', payload: { for: 'digest', host: r.host, model: r.model, cost: r.cost } });
      return (((r.value as { value?: z.infer<typeof Digest> }).value ?? r.value) as z.infer<typeof Digest>).summary;
    });
    const summary = await Promise.race([call, Bun.sleep(DIGEST_CAP_MS).then(() => null)]);
    return summary ? { summary } : null;
  } catch {
    return null;
  }
}

/** Every ending builds a packet; a killed session is not asked anything, its diff is read instead. */
export async function afterRunPacket(ctx: DaemonContext, taskId: string, run: string, result: RunResult): Promise<void> {
  const events = await ctx.ws.events(taskId).read();
  const adapter = events.find((e) => e.type === 'run.started' && e.run === run)?.adapter ?? '';
  const asked = result.endedBy === 'killed' ? null : await enrichFrom(ctx, taskId, run, adapter, result.sessionId, result.model ?? undefined);
  const fromAgent = !!asked && Object.keys(asked).length > 0;
  const enrich = fromAgent ? asked : ctx.opts.digest ? await digestFrom(ctx, taskId) : null;
  await buildHandoff(ctx, taskId, run, { enrich, reason: result.endedBy, enrichedBy: fromAgent ? 'agent' : 'digest' });
}

async function latestEndedRun(ctx: DaemonContext, taskId: string): Promise<string> {
  const runs = runsFromEvents(await ctx.ws.events(taskId).read()).filter((r) => r.endedAt);
  const last = runs.at(-1);
  if (!last) throw new DaemonError('not_found', `${taskId} has no finished run to build a packet from`);
  return last.run;
}

const HandoffBody = z.strictObject({
  to: z.strictObject({ adapter: z.string().min(1), role: z.enum(['planner', 'implementer', 'reviewer']) }).optional(),
  enrich: z.boolean().optional(),
  run: z.string().regex(/^r[0-9]+$/).optional(),
  reason: z.string().max(40).optional(),
});

const HandBody = z.strictObject({
  adapter: z.string().min(1),
  role: z.enum(['planner', 'implementer', 'reviewer']).optional(),
  ask: z.string().max(4000).optional(),
  model: z.string().min(1).optional(),
});

export function handoffRoutes(app: Hono, ctx: DaemonContext): void {
  // the packet fidelity quiz: facts from the full record, answered from the packet alone
  app.post('/api/tasks/:id/handoffs/:name/quiz', async (c) => {
    const body = z.strictObject({ statementsFrom: z.string().regex(/^h[0-9]+$/).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await quizPacket(ctx, c.req.param('id'), c.req.param('name'), body));
  });

  app.post('/api/tasks/:id/handoff', async (c) => {
    const id = c.req.param('id');
    const body = HandoffBody.parse(await c.req.json().catch(() => ({})));
    const run = body.run ?? (await latestEndedRun(ctx, id));
    // enrich asks the leaving session first, while it can still answer (R-054)
    let enrich: Enrichment | null = null;
    if (body.enrich) {
      const events = await ctx.ws.events(id).read();
      const started = events.find((e) => e.type === 'run.started' && e.run === run);
      const finished = events.find((e) => e.type === 'run.finished' && e.run === run);
      const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      const asked = await enrichFrom(ctx, id, run, started?.adapter ?? '', text(finished?.payload.sessionId), text(finished?.payload.model) ?? text(started?.payload.model));
      if (asked && Object.keys(asked).length > 0) enrich = asked;
    }
    const built = await buildHandoff(ctx, id, run, { ...(body.to ? { to: body.to } : {}), reason: body.reason ?? 'rebuilt', ...(enrich ? { enrich, enrichedBy: 'agent' as const } : {}) });
    if (body.reason === 'precompact' || body.reason === 'subagentstop') await ctx.ws.events(id).append({ task: id, run, vendor: 'daemon', type: 'agent.message', payload: { text: `Packet ${built.name} drafted by the agent's ${body.reason === 'precompact' ? 'PreCompact' : 'SubagentStop'} hook.`, hook: body.reason } });
    return c.json({ name: built.name, tokens: built.tokens, bytes: built.bytes, handoff: built.handoff });
  });

  // stop answers once run.finished is recorded; the packet the ending builds arrives on the stream as handoff.created
  app.post('/api/tasks/:id/runs/:run/stop', async (c) => c.json(await stop(ctx, c.req.param('id'), c.req.param('run')), 202));

  /** `stint hand`: a packet addressed to the next agent, then a run of that agent from it. */
  app.post('/api/tasks/:id/hand', async (c) => {
    const id = c.req.param('id');
    const body = HandBody.parse(await c.req.json());
    if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'stop it first; its packet is built when it ends');
    const role = body.role ?? 'implementer';
    const run = await latestEndedRun(ctx, id);
    const built = await buildHandoff(ctx, id, run, { to: { adapter: body.adapter, role }, reason: 'handed' });
    // line comments go to the next agent once, as the ask's suffix; they are marked with the run they went to
    const comments = await readComments(ctx, id);
    const pending = comments.filter((cm) => !cm.handedTo);
    const suffix = pendingCommentSuffix(comments);
    const ask = [body.ask, suffix ?? undefined].filter((part): part is string => !!part).join('\n');
    const next = await assign(ctx, id, { adapter: body.adapter, role, handoffFrom: built.name, ...(ask ? { instruction: ask } : {}), ...(body.model ? { model: body.model } : {}) });
    await markCommentsHanded(ctx, id, next.run, pending.map((cm) => cm.id));
    return c.json({ packet: built.name, tokens: built.tokens, run: next.run, worktree: next.worktree }, 202);
  });
}
