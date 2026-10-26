import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { assign } from '../lifecycle';

const AssignBody = z.strictObject({
  adapter: z.string().min(1),
  role: z.enum(['planner', 'implementer', 'reviewer']),
  model: z.string().min(1).optional(),
  instruction: z.string().max(4000).optional(),
  handoffFrom: z.string().regex(/^h[0-9]+$/).optional(),
});

export function runRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/tasks/:id/assign', async (c) => {
    const body = AssignBody.parse(await c.req.json());
    const r = await assign(ctx, c.req.param('id'), body);
    return c.json({ run: r.run, worktree: r.worktree }, 202);
  });
}
