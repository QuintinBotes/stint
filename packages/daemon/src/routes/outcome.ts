import { type Outcome, type Proof, type Workspace, outcome, usageFromEvents } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';

/**
 * One task's outcome record (R-063), read the same way by the route, `stint outcome` and `stint report`.
 * At integration, R-062's `taskUsage(events)` and `effectiveLimits(task, config)` replace `usageFromEvents` and fill `limits`,
 * and `task.proofs` (R-064) replaces the cast below.
 */
export async function taskOutcome(ws: Workspace, id: string, now = new Date().toISOString()): Promise<Outcome> {
  const task = await ws.readTask(id);
  const events = await ws.events(id).read();
  const proofs = (task as { proofs?: Proof[] }).proofs;
  return outcome({ task, events, verifications: await ws.verification(id).list(), config: ws.config, now, usage: usageFromEvents(events), proofs });
}

/** `GET /api/tasks/:id/outcome`: how the task went, as `stint.outcome/1`; an unknown task is 404. */
export function outcomeRecordRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/tasks/:id/outcome', async (c) => c.json(await taskOutcome(ctx.ws, c.req.param('id'))));
}
