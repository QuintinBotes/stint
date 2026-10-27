import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';

/** Stint's own measured results, run on the demo fixture. */
const STINT_BENCH = join(import.meta.dir, '..', '..', '..', '..', 'bench');

async function read(path: string): Promise<Record<string, unknown>> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>;
  } catch {
    throw new DaemonError('invalid', `${path.slice(path.lastIndexOf('bench'))} is not valid JSON`, 'run stint bench again');
  }
}

/** True when this repository has the commit Stint's own bench ran on, so those results describe its code. */
async function measuredHere(root: string): Promise<boolean> {
  const path = join(STINT_BENCH, 'results.json');
  if (!existsSync(path)) return false;
  const commit = ((await Bun.file(path).json().catch(() => ({}))) as { commit?: unknown }).commit;
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return false;
  return (await Bun.spawn(['git', 'cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdout: 'ignore', stderr: 'ignore' }).exited) === 0;
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
