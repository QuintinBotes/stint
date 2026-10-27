import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { STINT_BENCH, measuredHere } from '../measured';

async function read(path: string): Promise<Record<string, unknown>> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>;
  } catch {
    throw new DaemonError('invalid', `${path.slice(path.lastIndexOf('bench'))} is not valid JSON`, 'run stint bench again');
  }
}

/**
 * `GET /api/bench`: the packet benchmark results for the Factory view, with the packet run that carried the diff
 * digest when it was measured separately. A repository with no results of its own that has the commit Stint's
 * bench ran on (the demo fixture) gets Stint's.
 */
export function benchRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/bench', async (c) => {
    const own = join(ctx.ws.root, 'bench');
    const dir = existsSync(join(own, 'results.json')) ? own : (await measuredHere(ctx.ws.root)) ? STINT_BENCH : null;
    if (!dir) throw new DaemonError('not_found', 'no bench results yet', 'run stint bench first');
    const digest = join(dir, 'digest', 'results.json');
    return c.json({ ...(await read(join(dir, 'results.json'))), digest: existsSync(digest) ? await read(digest) : null });
  });
}
