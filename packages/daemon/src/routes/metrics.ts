import { WINDOWS, metrics, weekWindows, windowFor, type WindowName } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { loadMetricsInput } from '../metricsInput';

/** `GET /api/metrics`: verification and outcome metrics for a window, optionally split by agent, model or tag (R-061). */
export function metricRoutes(app: Hono, ctx: DaemonContext): void {
  app.get('/api/metrics', async (c) => {
    const windowName = c.req.query('window') ?? '30d';
    if (!(WINDOWS as readonly string[]).includes(windowName)) {
      throw new DaemonError('invalid', `unknown window ${windowName}`, '7d, 30d, 90d or all');
    }
    const by = c.req.query('by');
    if (by !== undefined && !['agent', 'model', 'tag'].includes(by)) {
      throw new DaemonError('invalid', `unknown by ${by}`, 'agent, model or tag');
    }
    const series = c.req.query('series');
    if (series !== undefined && series !== 'week') {
      throw new DaemonError('invalid', `unknown series ${series}`, 'week');
    }
    const now = new Date().toISOString();
    const window = windowFor(windowName as WindowName, now);
    const base = await loadMetricsInput(ctx.ws);
    const shared = { ...base, now, ...(by ? { by: by as 'agent' | 'model' | 'tag' } : {}) };
    if (series !== 'week') return c.json(metrics({ ...shared, window }));
    const earliest = base.tasks.flatMap((t) => t.events.map((e) => e.ts)).sort()[0] ?? null;
    return c.json(weekWindows(window, earliest).map((w) => metrics({ ...shared, window: w })));
  });
}
