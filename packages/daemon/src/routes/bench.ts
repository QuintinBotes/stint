import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';

/** `GET /api/bench`: the packet benchmark results from the repository root, for the Factory view. */
export function benchRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/bench', async (c) => {
    const path = join(ctx.ws.root, 'bench', 'results.json');
    if (!existsSync(path)) throw new DaemonError('not_found', 'no bench results yet', 'run stint bench first');
    try {
      return c.json((await Bun.file(path).json()) as Record<string, unknown>);
    } catch {
      throw new DaemonError('invalid', 'bench/results.json is not valid JSON', 'run stint bench again');
    }
  });
}
