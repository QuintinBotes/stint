import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { phaseGates } from '../gates';

/** `GET /api/phase-gates`: the golden pass rates and whether phases 2 and 3 have opened (R-046). */
export function gateRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/phase-gates', async (c) => c.json(await phaseGates(ctx.ws)));
}
