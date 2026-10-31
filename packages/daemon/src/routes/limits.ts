import { BudgetsSchema, TaskLimitsSchema, effectiveLimits, taskUsage } from '@stint-dev/core';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { spentByRole } from '../lifecycle';

// a person raises a role's token budget where assign refused a run over it
const LimitsChangeSchema = TaskLimitsSchema.extend({ budgets: BudgetsSchema.pick({ planner: true, implementer: true, reviewer: true, learn: true, tester: true }).partial().optional() });

/** A task's limits (R-062): what applies, what it has used, and a person changing them. */
export function limitRoutes(app: Hono, ctx: DaemonContext): void {
  const meters = async (id: string) => {
    const task = await ctx.ws.readTask(id);
    return {
      limits: effectiveLimits(task, ctx.ws.config),
      used: taskUsage(await ctx.ws.events(id).read()),
      own: task.limits ?? {},
      tokens: { budget: task.budgets.implementer, spent: await spentByRole(ctx, id, 'implementer') },
    };
  };

  // what a new task takes when it sets none, for the new task form
  app.get('/api/limits', (c) => c.json({ limits: effectiveLimits({ budgets: ctx.ws.config.budgets }, ctx.ws.config) }));
  app.get('/api/tasks/:id/limits', async (c) => c.json(await meters(c.req.param('id'))));

  // the fields given replace the task's own, and null is no limit; raising a reached limit does not restart
  // autopilot by itself, switching it on again does
  app.patch('/api/tasks/:id/limits', async (c) => {
    const id = c.req.param('id');
    const parsed = LimitsChangeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || (issue as { keys?: string[] } | undefined)?.keys?.join(', ') || 'the body';
      throw new DaemonError('invalid', `${field}: ${issue?.message ?? 'not valid'}`, 'builds 1 to 50, handoffs 0 to 20, reviewRounds 0 to 10, usd above 0 up to 1000, minutes 1 to 1440, or null for no limit; budgets in whole tokens');
    }
    const task = await ctx.ws.readTask(id);
    // limits cap work still to come; a finished task has none
    if (['done', 'approved', 'abandoned'].includes(task.status)) throw new DaemonError('invalid', `${id} is ${task.status}, so there is no work left to limit`, 'set limits on a task that is still open');
    const { budgets, ...change } = parsed.data;
    const from = task.limits ?? {};
    const to = { ...from, ...change };
    await ctx.ws.writeTask(id, { limits: to, ...(budgets ? { budgets: { ...task.budgets, ...budgets } } : {}) });
    const tokens = budgets ? { budgetsFrom: task.budgets, budgetsTo: { ...task.budgets, ...budgets } } : {};
    await ctx.ws.events(id).append({ task: id, vendor: 'human', type: 'limits.changed', payload: { from, to, ...tokens, by: 'you' } });
    return c.json(await meters(id));
  });
}
