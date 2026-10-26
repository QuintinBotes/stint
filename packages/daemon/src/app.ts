import { timingSafeEqual } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import {
  type CostGroup,
  type StintEvent,
  EventLog,
  type Workspace,
  costs,
  runsFromEvents,
  sumCosts,
  taskBundle,
} from '@stint-dev/core/node';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { type Adapter, adapterHealth } from './adapter';
import { DaemonError, errorResponse } from './errors';
import { workRoutes } from './routes/work';
import { RunRegistry } from './runs';
import { DaemonVerifier, type Verifier } from './verifier';
import { Worktrees } from './worktree';

export const DAEMON_VERSION = '0.1.0';

export type AppOptions = {
  token: string;
  version?: string;
  startedAt?: string;
  /** Built UI to serve at `/`; null to serve nothing. */
  webDist?: string | null;
  quiet?: boolean;
  heartbeatMs?: number;
  pollMs?: number;
  /** Extra fields for `/api/health` contributed by later subsystems (replay mode, PTY backend, hosts). */
  health?: Array<() => Promise<Record<string, unknown>> | Record<string, unknown>>;
  verifier?: Verifier;
  /** How often a live run's worktree is snapshotted into file.changed (default 5 s). */
  snapshotMs?: number;
};

export type DaemonContext = {
  ws: Workspace;
  adapters: Adapter[];
  opts: Required<Omit<AppOptions, 'health' | 'verifier' | 'snapshotMs'>> & Pick<AppOptions, 'health'>;
  runs: RunRegistry;
  worktrees: Worktrees;
  verifier: Verifier;
  snapshotMs: number;
};

const NewTaskBody = z.strictObject({
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  acceptance: z.array(z.string().min(1).max(300)).min(1).max(12),
  testCommand: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
});

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(ws: Workspace, adapters: Adapter[], options: AppOptions): Hono {
  const { verifier, snapshotMs, ...rest } = options;
  const opts = {
    version: DAEMON_VERSION,
    startedAt: new Date().toISOString(),
    webDist: join(import.meta.dir, '..', '..', '..', 'apps', 'web', 'dist'),
    quiet: false,
    heartbeatMs: 15_000,
    pollMs: 1_000,
    ...rest,
  };
  const runs = new RunRegistry();
  const ctx: DaemonContext = {
    ws,
    adapters,
    opts,
    runs,
    worktrees: new Worktrees(ws, runs),
    verifier: verifier ?? new DaemonVerifier(ws),
    snapshotMs: snapshotMs ?? 5_000,
  };
  const app = new Hono();

  app.onError((err, c) => errorResponse(c, err));

  app.use('*', async (c, next) => {
    const t0 = performance.now();
    await next();
    if (!opts.quiet) {
      const line = { ts: new Date().toISOString(), method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - t0) };
      process.stderr.write(`${JSON.stringify(line)}\n`);
    }
  });

  app.use('/api/*', async (c, next) => {
    if (MUTATING.has(c.req.method) && !tokenMatches(c.req.header('Authorization'), opts.token)) {
      throw new DaemonError('unauthorized', 'this call changes state and needs the daemon token', 'send Authorization: Bearer <token from .stint/cache/daemon.json>');
    }
    await next();
  });

  app.get('/api/health', async (c) => {
    const extra = await Promise.all((opts.health ?? []).map((h) => h()));
    return c.json({
      ok: true,
      version: opts.version,
      mode: 'live',
      startedAt: opts.startedAt,
      pid: process.pid,
      adapters: await adapterHealth(adapters),
      ...Object.assign({}, ...extra),
    });
  });

  app.get('/api/tasks', async (c) => {
    const cards = [];
    for (const task of await ws.listTasks()) {
      const events = await ws.events(task.id).read();
      const runs = runsFromEvents(events);
      const lastMessage = [...events].reverse().find((e) => e.type === 'agent.message');
      cards.push({
        task,
        cost: sumCosts(runs.map((r) => r.cost)),
        lastRun: runs.at(-1) ?? null,
        lastEventAt: events.at(-1)?.ts ?? task.updatedAt,
        summary: typeof lastMessage?.payload.text === 'string' ? lastMessage.payload.text.slice(0, 200) : null,
      });
    }
    return c.json({ tasks: cards });
  });

  app.post('/api/tasks', async (c) => {
    const body = NewTaskBody.parse(await c.req.json());
    const task = await ws.createTask(body);
    return c.json(task, 201);
  });

  app.get('/api/tasks/:id', async (c) => c.json(await taskBundle(ws, c.req.param('id'))));

  app.get('/api/tasks/:id/events', async (c) => {
    const id = c.req.param('id');
    await ws.readTask(id);
    const since = Number(c.req.query('since') ?? 0) || 0;
    return c.json({ events: await ws.events(id).read({ since }) });
  });

  app.post('/api/tasks/:id/events', async (c) => {
    if (!ws.config.allowDirectEvents && process.env.NODE_ENV !== 'test') {
      throw new DaemonError('unauthorized', 'direct event writes are off', 'set allowDirectEvents in .stint/config.json');
    }
    const id = c.req.param('id');
    await ws.readTask(id);
    const body = (await c.req.json()) as { type?: string; payload?: Record<string, unknown>; run?: string; adapter?: string; vendor?: StintEvent['vendor'] };
    if (typeof body.type !== 'string') throw new DaemonError('invalid', 'type is required');
    const e = await ws.events(id).append({ ...body, task: id, type: body.type, payload: body.payload ?? {} });
    return c.json(e, 201);
  });

  app.get('/api/costs', async (c) => {
    const group = (c.req.query('group') ?? 'task') as CostGroup;
    if (!['task', 'run', 'day', 'host'].includes(group)) throw new DaemonError('invalid', `unknown group ${group}`, 'task, run, day or host');
    return c.json(await costs(ws, { group }));
  });

  app.get('/api/tasks/:id/stream', async (c) => {
    const id = c.req.param('id');
    await ws.readTask(id);
    const log = ws.events(id);
    let last = Number(c.req.header('Last-Event-ID') ?? c.req.query('since') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const pending: StintEvent[] = [];
      let wake: (() => void) | null = null;
      let aborted = false;
      const off = log.onAppend((e) => {
        pending.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        aborted = true;
        off();
        wake?.();
      });
      const flush = async () => {
        pending.sort((a, b) => a.seq - b.seq);
        for (const e of pending.splice(0)) {
          if (e.seq <= last) continue;
          await stream.writeSSE({ event: e.type, id: String(e.seq), data: JSON.stringify(e) });
          last = e.seq;
        }
      };
      pending.push(...(await log.read({ since: last })));
      await flush();
      let beat = Date.now();
      while (!aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, opts.pollMs);
        });
        wake = null;
        if (aborted) break;
        if (pending.length === 0) pending.push(...(await log.read({ since: last })));
        await flush();
        if (Date.now() - beat >= opts.heartbeatMs) {
          await stream.writeSSE({ event: 'heartbeat', data: '{}' });
          beat = Date.now();
        }
      }
    });
  });

  app.get('/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      const pending: StintEvent[] = [];
      let wake: (() => void) | null = null;
      let aborted = false;
      const off = EventLog.onAnyAppend((e) => {
        pending.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        aborted = true;
        off();
        wake?.();
      });
      let beat = Date.now();
      while (!aborted) {
        for (const e of pending.splice(0)) {
          await stream.writeSSE({ event: e.type, id: `${e.task}:${e.seq}`, data: JSON.stringify(e) });
        }
        if (Date.now() - beat >= opts.heartbeatMs) {
          await stream.writeSSE({ event: 'heartbeat', data: '{}' });
          beat = Date.now();
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, opts.pollMs);
        });
        wake = null;
      }
    }),
  );

  registerRoutes(app, ctx);

  app.all('/api/*', () => {
    throw new DaemonError('not_found', 'no such route');
  });

  // The built UI, with SPA fallback; the API works without it.
  app.get('*', async (c) => {
    const dist = opts.webDist;
    if (!dist || !existsSync(join(dist, 'index.html'))) {
      return c.text('The web UI is not built yet. Run: bun run build:web', 404);
    }
    const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(dist, rel);
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
    return new Response(Bun.file(join(dist, 'index.html')), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });

  return app;
}

/** Later specs (verify, assign, handoff, approve, graph, skills) add their routes here. */
function registerRoutes(app: Hono, ctx: DaemonContext): void {
  workRoutes(app, ctx);
}
