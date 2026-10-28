import { type Outcome, type Workspace, effectiveLimits, outcome, taskUsage } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';

/**
 * One task's outcome record (R-063), read the same way by the route, `stint outcome` and `stint report`, with the
 * task's usage and limits (R-062) and its accepted proofs (R-064).
 */
export async function taskOutcome(ws: Workspace, id: string, now = new Date().toISOString()): Promise<Outcome> {
  const task = await ws.readTask(id);
  const events = await ws.events(id).read();
  return outcome({ task, events, verifications: await ws.verification(id).list(), config: ws.config, now, usage: taskUsage(events, Date.parse(now)), limits: effectiveLimits(task, ws.config), ...(task.proofs ? { proofs: task.proofs } : {}) });
}

/** `GET /api/tasks/:id/outcome`: how the task went, as `stint.outcome/1`; an unknown task is 404. */
export function outcomeRecordRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/tasks/:id/outcome', async (c) => c.json(await taskOutcome(ctx.ws, c.req.param('id'))));
}
