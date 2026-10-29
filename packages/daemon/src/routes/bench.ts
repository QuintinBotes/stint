import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScorecardSchema } from '@stint-dev/core';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { STINT_BENCH, measuredHere } from '../measured';

async function read(path: string, again: string): Promise<Record<string, unknown>> {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>;
  } catch {
    throw new DaemonError('invalid', `${path.slice(path.lastIndexOf('bench'))} is not valid JSON`, again);
  }
}

/** This repository's own bench folder when it holds `file`, else Stint's when Stint measured this repository's code (the demo fixture), else null. */
async function benchWith(ctx: DaemonContext, file: string): Promise<string | null> {
  const own = join(ctx.ws.root, 'bench');
  if (existsSync(join(own, file))) return own;
  return (await measuredHere(ctx.ws.root)) && existsSync(join(STINT_BENCH, file)) ? STINT_BENCH : null;
}

/**
 * `GET /api/bench`: the packet benchmark results for the Factory view, with the packet run that carried the diff
 * digest when it was measured separately. `GET /api/scorecard`: what verification and review caught on seeded tasks
 * with hidden tests (R-070). A repository with no results of its own that has the commit Stint's bench ran on (the
 * demo fixture) gets Stint's.
 */
export function benchRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/bench', async (c) => {
    const dir = await benchWith(ctx, 'results.json');
    if (!dir) throw new DaemonError('not_found', 'no bench results yet', 'run stint bench first');
    const digest = join(dir, 'digest', 'results.json');
    return c.json({ ...(await read(join(dir, 'results.json'), 'run stint bench again')), digest: existsSync(digest) ? await read(digest, 'run stint bench again') : null });
  });
  app.get('/api/scorecard', async (c) => {
    const dir = await benchWith(ctx, 'scorecard.json');
    if (!dir) throw new DaemonError('not_found', 'no scorecard yet', 'Stint writes bench/scorecard.json with bun scripts/scorecard.ts');
    const card = ScorecardSchema.safeParse(await read(join(dir, 'scorecard.json'), 'run the scorecard again'));
    if (!card.success) throw new DaemonError('invalid', 'bench/scorecard.json is not a stint.scorecard/1 record', 'run the scorecard again');
    return c.json(card.data);
  });
}
