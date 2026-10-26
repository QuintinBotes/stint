import { join } from 'node:path';
import type { Hono } from 'hono';
import type { DaemonContext } from '../app';
import { DaemonError } from '../errors';
import { Replayer, parseClock } from '../replay';

export const DEFAULT_RECORDING = join(import.meta.dir, '..', '..', '..', '..', 'demo', 'recording.jsonl');

export function demoRoutes(app: Hono, ctx: DaemonContext): void {
  app.post('/api/demo/play', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; speed?: number; from?: string | number };
    const r = ctx.replayer;
    if (r.getStatus().playing) throw new DaemonError('run_active', 'the replay is already playing');
    r.load(body.path ?? DEFAULT_RECORDING);
    const done = r.play({ speed: body.speed ?? 1, from: parseClock(body.from) });
    done.catch((err: unknown) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `replay failed: ${err instanceof Error ? err.message : String(err)}` })}\n`));
    return c.json(r.getStatus(), 202);
  });
  app.post('/api/demo/pause', (c) => {
    ctx.replayer.pause();
    return c.json(ctx.replayer.getStatus());
  });
  app.post('/api/demo/continue', (c) => {
    ctx.replayer.continue();
    return c.json(ctx.replayer.getStatus());
  });
  app.post('/api/demo/stop', (c) => {
    ctx.replayer.stop();
    return c.json(ctx.replayer.getStatus());
  });
  app.get('/api/demo/status', (c) => {
    const s = ctx.replayer.getStatus();
    return c.json({ playing: s.playing, paused: s.paused, at: s.at, total: s.total, title: s.title, live: s.live, recordedAt: s.recordedAt, done: s.done });
  });
}

export { Replayer };
