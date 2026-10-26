import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { assign } from '../lifecycle';

const AssignBody = z.strictObject({
  adapter: z.string().min(1),
  role: z.enum(['planner', 'implementer', 'reviewer']),
  model: z.string().min(1).optional(),
  instruction: z.string().max(4000).optional(),
  handoffFrom: z.string().regex(/^h[0-9]+$/).optional(),
});

export function runRoutes(app: Hono, ctx: DaemonContext): void {
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

  app.post('/api/tasks/:id/assign', async (c) => {
    const body = AssignBody.parse(await c.req.json());
    const r = await assign(ctx, c.req.param('id'), body);
    return c.json({ run: r.run, worktree: r.worktree }, 202);
  });
}
