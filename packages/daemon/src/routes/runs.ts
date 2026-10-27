import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { gitOk } from '../git';
import { assign } from '../lifecycle';

const AssignBody = z.strictObject({
  adapter: z.string().min(1),
  role: z.enum(['planner', 'implementer', 'reviewer']),
  model: z.string().min(1).optional(),
  instruction: z.string().max(4000).optional(),
  handoffFrom: z.string().regex(/^h[0-9]+$/).optional(),
});

export function runRoutes(app: Hono, ctx: DaemonContext): void {
  // a checkpoint is the commit a run ended on; its code opens in a detached worktree of its own, so neither the task
  // branch nor the run's worktree moves. The conversation cannot be restored yet; the packet carries it forward.
  app.post('/api/tasks/:id/runs/:run/restore', async (c) => {
    const id = c.req.param('id');
    const run = c.req.param('run');
    if (!/^r[0-9]+$/.test(run)) throw new DaemonError('invalid', `${run} is not a run id`, 'runs are r1, r2, ...');
    const { what } = z.strictObject({ what: z.enum(['code', 'conversation', 'both']) }).parse(await c.req.json());
    if (what !== 'code') throw new DaemonError('invalid', 'restoring the conversation is not built yet', 'restore the code; the packet carries the conversation forward');
    await ctx.ws.readTask(id);
    const finished = (await ctx.ws.events(id).read()).find((e) => e.type === 'run.finished' && e.run === run);
    const commit = typeof finished?.payload.commit === 'string' && /^[0-9a-f]{7,40}$/.test(finished.payload.commit) ? finished.payload.commit : null;
    if (!commit) throw new DaemonError('not_found', `${run} left no commit to restore`, 'only a run that changed files ends on a checkpoint');
    const path = join(ctx.ws.worktreesDir, `${id}-${run}-checkpoint`);
    if (!existsSync(path)) await gitOk(ctx.ws.root, ['worktree', 'add', '--detach', '-q', path, commit]);
    return c.json({ path: relative(ctx.ws.root, path), commit });
  });


  // the agent's PreToolUse hook names the step about to run, so a kill can name it too
  app.post('/api/tasks/:id/runs/:run/inflight', async (c) => {
    const body = z.strictObject({ tool: z.string().min(1).max(80), args: z.record(z.string(), z.unknown()).optional() }).parse(await c.req.json());
    const live = ctx.runs.get(c.req.param('id'));
    if (!live || live.run !== c.req.param('run')) throw new DaemonError('not_found', 'no such live run');
    const a = body.args ?? {};
    const target = String(a.path ?? a.file_path ?? a.command ?? a.pattern ?? '').slice(0, 160);
    live.inFlight = `${body.tool}${target ? ` ${target}` : ''}`;
    return c.json({ ok: true });
  });

  app.post('/api/tasks/:id/autopilot', async (c) => {
    const id = c.req.param('id');
    const { on } = z.strictObject({ on: z.boolean() }).parse(await c.req.json());
    await ctx.ws.readTask(id);
    if (on) await ctx.autopilot.start(id);
    else await ctx.autopilot.stop(id, 'Turned off by you.');
    return c.json({ on, ...(await ctx.autopilot.status()) });
  });

  // Run all: every planned task goes on autopilot; past the parallel limit they wait as queued, in board order
  app.post('/api/autopilot', async (c) => {
    const { on } = z.strictObject({ on: z.boolean() }).parse(await c.req.json());
    const started: string[] = [];
    for (const t of await ctx.ws.listTasks()) {
      if (on && t.status !== 'planned') continue;
      if (on) await ctx.autopilot.start(t.id);
      else await ctx.autopilot.stop(t.id, 'Turned off by you.');
      started.push(t.id);
    }
    return c.json({ on, tasks: started, ...(await ctx.autopilot.status()) });
  });

  app.post('/api/tasks/:id/assign', async (c) => {
    const body = AssignBody.parse(await c.req.json());
    const r = await assign(ctx, c.req.param('id'), body);
    return c.json({ run: r.run, worktree: r.worktree }, 202);
  });

  // every permission question waiting for a person, across tasks (R-033)
  app.get('/api/permissions', (c) => c.json(ctx.runs.pendingPermissions()));

  app.post('/api/tasks/:id/runs/:run/permission', async (c) => {
    const body = z
      .strictObject({ requestId: z.string().min(1), optionId: z.string().min(1).optional(), option: z.string().min(1).optional(), by: z.string().min(1).max(80).optional() })
      .parse(await c.req.json());
    const optionId = body.optionId ?? body.option;
    if (!optionId) throw new DaemonError('invalid', 'optionId is required');
    const id = c.req.param('id');
    const run = c.req.param('run');
    const live = ctx.runs.get(id);
    if (!live || live.run !== run) throw new DaemonError('not_found', `${id} ${run} is not running`);
    const pending = live.permissions?.get(body.requestId);
    if (!pending) throw new DaemonError('not_found', `no pending permission ${body.requestId} on ${id} ${run}`);
    if (!pending.options.some((o) => o.optionId === optionId)) throw new DaemonError('invalid', `${optionId} is not one of the options for ${body.requestId}`);
    live.permissions?.delete(body.requestId);
    const by = body.by ?? 'human';
    await ctx.ws.events(id).append({ task: id, run, adapter: live.adapter, vendor: 'human', type: 'permission.decided', payload: { requestId: body.requestId, optionId, by } });
    pending.resolve({ optionId });
    return c.json({ ok: true, requestId: body.requestId, optionId });
  });
}
