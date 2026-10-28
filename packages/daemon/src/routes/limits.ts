import { TaskLimitsSchema, effectiveLimits, taskUsage } from '@stint-dev/core';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';

/** A task's limits (R-062): what applies, what it has used, and a person changing them. */
export function limitRoutes(app: Hono, ctx: DaemonContext): void {
  const meters = async (id: string) => {
    const task = await ctx.ws.readTask(id);
    return { limits: effectiveLimits(task, ctx.ws.config), used: taskUsage(await ctx.ws.events(id).read()), own: task.limits ?? {} };
  };

  // what a new task takes when it sets none, for the new task form
  app.get('/api/limits', (c) => c.json({ limits: effectiveLimits({ budgets: ctx.ws.config.budgets }, ctx.ws.config) }));
  app.get('/api/tasks/:id/limits', async (c) => c.json(await meters(c.req.param('id'))));

  // the fields given replace the task's own, and null is no limit; raising a reached limit does not restart
  // autopilot by itself, switching it on again does
  app.patch('/api/tasks/:id/limits', async (c) => {
    const id = c.req.param('id');
    const parsed = TaskLimitsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || (issue as { keys?: string[] } | undefined)?.keys?.join(', ') || 'the body';
      throw new DaemonError('invalid', `${field}: ${issue?.message ?? 'not valid'}`, 'builds 1 to 50, handoffs 0 to 20, reviewRounds 0 to 10, usd above 0 up to 1000, minutes 1 to 1440, or null for no limit');
    }
    const from = (await ctx.ws.readTask(id)).limits ?? {};
    const to = { ...from, ...parsed.data };
    await ctx.ws.writeTask(id, { limits: to });
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'limits.changed', payload: { from, to, by: 'you' } });
    return c.json(await meters(id));
  });
}
