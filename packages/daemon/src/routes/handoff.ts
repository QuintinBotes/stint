import { runsFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Enrichment, RunResult } from '../adapter';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { buildHandoff } from '../handoff';
import { assign, stop } from '../lifecycle';
import { worktreePath } from '../worktree';

const ENRICH_CAP_MS = 20_000;

/** Asks the leaving agent to improve four fields, only while its session is alive, capped at 20 s; never throws. */
async function enrichFrom(ctx: DaemonContext, taskId: string, run: string, adapterId: string, sessionId: string | undefined): Promise<Enrichment | null> {
  const adapter = ctx.adapters.find((a) => a.id === adapterId);
  if (!adapter?.enrich || !adapter.capabilities.resumable || !sessionId) return null;
  const task = await ctx.ws.readTask(taskId);
  const ask = adapter.enrich({ task, run, sessionId, worktree: worktreePath(ctx.ws, taskId, run) }).catch(() => ({}));
  return Promise.race([ask, Bun.sleep(ENRICH_CAP_MS).then(() => ({}))]);
}

/** Every ending builds a packet; a killed session is not asked anything. */
export async function afterRunPacket(ctx: DaemonContext, taskId: string, run: string, result: RunResult): Promise<void> {
  const events = await ctx.ws.events(taskId).read();
  const adapter = events.find((e) => e.type === 'run.started' && e.run === run)?.adapter ?? '';
  const enrich = result.endedBy === 'killed' ? null : await enrichFrom(ctx, taskId, run, adapter, result.sessionId);
  await buildHandoff(ctx, taskId, run, { enrich, reason: result.endedBy });
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
  app.post('/api/tasks/:id/handoff', async (c) => {
    const id = c.req.param('id');
    const body = HandoffBody.parse(await c.req.json().catch(() => ({})));
    const run = body.run ?? (await latestEndedRun(ctx, id));
    const built = await buildHandoff(ctx, id, run, { ...(body.to ? { to: body.to } : {}), reason: body.reason ?? 'rebuilt' });
    return c.json({ name: built.name, tokens: built.tokens, bytes: built.bytes, handoff: built.handoff });
  });

  // stop answers with the packet the ending built
  app.post('/api/tasks/:id/runs/:run/stop', async (c) => {
    const id = c.req.param('id');
    const run = c.req.param('run');
    const r = await stop(ctx, id, run);
    const packet = await ctx.ws.handoffs(id).latest();
    return c.json({ ...r, packet: packet?.from.run === run ? packet : null }, 202);
  });

  /** `stint hand`: a packet addressed to the next agent, then a run of that agent from it. */
  app.post('/api/tasks/:id/hand', async (c) => {
    const id = c.req.param('id');
    const body = HandBody.parse(await c.req.json());
    if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'stop it first; its packet is built when it ends');
    const role = body.role ?? 'implementer';
    const run = await latestEndedRun(ctx, id);
    const built = await buildHandoff(ctx, id, run, { to: { adapter: body.adapter, role }, reason: 'handed' });
    const next = await assign(ctx, id, { adapter: body.adapter, role, handoffFrom: built.name, ...(body.ask ? { instruction: body.ask } : {}), ...(body.model ? { model: body.model } : {}) });
    return c.json({ packet: built.name, tokens: built.tokens, run: next.run, worktree: next.worktree }, 202);
  });
}
