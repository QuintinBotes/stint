import { GoalSplitSchema, TaskLimitsSchema } from '@stint-dev/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { DaemonContext } from '../app';
import { createGoalTasks, goalView, planGoal, setGoalStatus } from '../goals';

const NewGoalBody = z.strictObject({
  title: z.string().min(1).max(120),
  outcome: z.string().min(1).max(2000),
  criteria: z.array(z.string().min(1).max(300)).min(1).max(12),
  nonGoals: z.array(z.string().min(1).max(300)).max(8).optional(),
  limits: TaskLimitsSchema.optional(),
});

/** Goals above tasks (R-064): make one, split it into tasks, and change or abandon it. Every POST needs the daemon token. */
export function goalRoutes(app: Hono, ctx: DaemonContext): void {
  const log = () => ctx.ws.workspaceEvents();

  app.post('/api/goals', async (c) => {
    const body = NewGoalBody.parse(await c.req.json());
    const goal = await ctx.ws.createGoal(body);
    await log().append({ task: 'workspace', vendor: 'human', type: 'goal.created', payload: { goal: goal.id, title: goal.title, criteria: goal.criteria.length } });
    return c.json(goal, 201);
  });

  app.get('/api/goals', async (c) => {
    const goals = [];
    for (const g of await ctx.ws.listGoals()) {
      const { goal, outcome } = await goalView(ctx, g.id);
      goals.push({ goal, outcome });
    }
    return c.json({ goals });
  });

  app.get('/api/goals/:id', async (c) => c.json(await goalView(ctx, c.req.param('id'))));

  // the proposal only: nothing is created until the person sends it back to /tasks
  app.post('/api/goals/:id/plan', async (c) => c.json({ tasks: await planGoal(ctx, c.req.param('id')) }));

  app.post('/api/goals/:id/tasks', async (c) => {
    const { tasks } = GoalSplitSchema.parse(await c.req.json());
    return c.json({ tasks: await createGoalTasks(ctx, c.req.param('id'), tasks) }, 201);
  });

  app.post('/api/goals/:id/abandon', async (c) => c.json(await setGoalStatus(ctx, c.req.param('id'), 'abandoned', 'you')));

  // the fields given replace the goal's own, and null is no limit
  app.patch('/api/goals/:id/limits', async (c) => {
    const id = c.req.param('id');
    const patch = TaskLimitsSchema.parse(await c.req.json());
    const from = (await ctx.ws.readGoal(id)).limits ?? {};
    const goal = await ctx.ws.updateGoal(id, (g) => ({ limits: { ...g.limits, ...patch } }));
    await log().append({ task: 'workspace', vendor: 'human', type: 'limits.changed', payload: { goal: id, from, to: goal.limits ?? {}, by: 'you' } });
    return c.json(goal);
  });
}
