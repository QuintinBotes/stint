import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
import { type Adapter, type RunResult, adapterHealth } from './adapter';
import { checkAcceptanceLock } from './acceptance';
import { Autopilot, autopilotCard } from './autopilot';
import { chainHealth, localModels, modelHealth } from './hosts';
import { DaemonError, errorResponse } from './errors';
import { outcomeRoutes } from './outcomes';
import { ptyHealth } from './pty';
import { benchRoutes } from './routes/bench';
import { gateRoutes } from './routes/gates';
import { metricRoutes } from './routes/metrics';
import { demoRoutes } from './routes/demo';
import { approveRoutes } from './routes/approve';
import { graphRoutes } from './routes/graph';
import { modelRoutes } from './routes/models';
import { riskRoutes } from './risk';
import { gardeningRoutes } from './gardening';
import { intakeRoutes } from './intake';
import { fileRoutes } from './routes/files';
import { afterRunPacket, handoffRoutes } from './routes/handoff';
import { runRoutes } from './routes/runs';
import { skillRoutes } from './routes/skills';
import { ptyRoutes } from './routes/pty';
import { commentRoutes } from './routes/comments';
import { summaryRoutes } from './routes/summary';
import { workRoutes } from './routes/work';
import { Replayer } from './replay';
import { RunRegistry } from './runs';
import { OtelExporter } from './otel';
import { workspaceRecords } from './routing';
import { egressProxy, sandboxHealth } from './sandbox';
import type { EgressProxy } from './egress';
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
  /** Ask a model what a killed run's diff does, for its packet (off unless the daemon is started for real work). */
  digest?: boolean;
};

export type DaemonContext = {
  ws: Workspace;
  adapters: Adapter[];
  opts: Required<Omit<AppOptions, 'health' | 'verifier' | 'snapshotMs'>> & Pick<AppOptions, 'health'>;
  runs: RunRegistry;
  worktrees: Worktrees;
  verifier: Verifier;
  snapshotMs: number;
  replayer: Replayer;
  /** Runs after a run is verified; the packet builder (R-012) hooks in here. */
  afterRun?: (task: string, run: string, result: RunResult) => Promise<void>;
  /** Run endings still writing (commit, verify, packet); a stop waits for them. */
  pending: Set<Promise<unknown>>;
  autopilot: Autopilot;
  /** Sends finished runs to an OpenTelemetry collector when `otel.endpoint` is set (R-043). */
  otel: OtelExporter;
  /** The egress proxy, once a run with `sandbox.egress.mode: proxy` has started it (R-040). */
  egress?: Promise<EgressProxy>;
};

const NewTaskBody = z.strictObject({
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  acceptance: z.array(z.string().min(1).max(300)).min(1).max(12),
  testCommand: z.string().min(1).optional(),
  checks: z
    .array(z.strictObject({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), command: z.string().min(1).max(400), kind: z.enum(['test', 'typecheck', 'lint', 'custom']) }))
    .max(8)
    .optional(),
  tags: z.array(z.string()).optional(),
  links: z.strictObject({ beadsId: z.string().max(80).nullable().optional(), issueUrl: z.url().nullable().optional() }).optional(),
});

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const contexts = new WeakMap<Hono, DaemonContext>();

/** The name people call the repository: its package.json name, else its folder. */
function repoName(root: string): string {
  try {
    const name = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string' && name) return name.replace(/^@[^/]+\//, '');
  } catch {
    // no package.json: the folder name will do
  }
  return root.split('/').filter(Boolean).at(-1) ?? 'repository';
}

/** The context behind an app, for tests and in-process callers. */
export function daemonContext(app: Hono): DaemonContext {
  const ctx = contexts.get(app);
  if (!ctx) throw new Error('not a Stint app');
  return ctx;
}

export function createApp(ws: Workspace, adapters: Adapter[], options: AppOptions): Hono {
  const { verifier, snapshotMs, ...rest } = options;
  const opts = {
    version: DAEMON_VERSION,
    startedAt: new Date().toISOString(),
    webDist: join(import.meta.dir, '..', '..', '..', 'apps', 'web', 'dist'),
    quiet: false,
    heartbeatMs: 15_000,
    digest: false,
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
    replayer: new Replayer(ws),
    pending: new Set(),
  } as Omit<DaemonContext, 'autopilot' | 'otel'> as DaemonContext;
  ctx.autopilot = new Autopilot(ctx);
  ctx.otel = new OtelExporter(ctx);
  // the daemon's own test runs reach the network through the same proxy as the agents
  if (ctx.verifier instanceof DaemonVerifier) ctx.verifier.proxyUrl = async (t, r) => (ws.config.sandbox?.egress.mode === 'proxy' ? (await egressProxy(ctx)).url(t, r) : null);
  ctx.afterRun = async (task, run, result) => {
    await checkAcceptanceLock(ctx, task, run);
    await afterRunPacket(ctx, task, run, result);
    void ctx.otel.run(task, run).catch(() => undefined);
    ctx.autopilot.kick(task);
  };
  const app = new Hono();
  contexts.set(app, ctx);

  app.onError((err, c) => errorResponse(c, err));

  app.use('*', async (c, next) => {
    const t0 = performance.now();
    await next();
    if (!opts.quiet) {
      const line = { ts: new Date().toISOString(), method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - t0) };
      process.stderr.write(`${JSON.stringify(line)}\n`);
    }
  });

  // The daemon answers only to localhost names, so a page served elsewhere cannot rebind DNS onto it.
  app.use('*', async (c, next) => {
    const host = (c.req.header('Host') ?? 'localhost').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      throw new DaemonError('unauthorized', `the daemon only answers to localhost, not ${host}`);
    }
    await next();
  });

  app.use('/api/*', async (c, next) => {
    if (MUTATING.has(c.req.method) && !tokenMatches(c.req.header('Authorization'), opts.token)) {
      throw new DaemonError('unauthorized', 'this call changes state and needs the daemon token', 'send Authorization: Bearer <token from .stint/cache/daemon.json>');
    }
    await next();
  });

  app.get('/api/health', async (c) => {
    const extra = await Promise.all((opts.health ?? []).map((h) => h()));
    const models = await modelHealth(ws.config);
    return c.json({
      ok: true,
      version: opts.version,
      mode: 'live',
      startedAt: opts.startedAt,
      pid: process.pid,
      repo: repoName(ws.root),
      adapters: await adapterHealth(adapters, ws.config),
      pty: ptyHealth(),
      autopilot: await ctx.autopilot.status(),
      models,
      chains: chainHealth(ws.config, models),
      localModels: await localModels(ws.config),
      sandbox: await sandboxHealth(ctx),
      skills: { requireReview: ws.config.skills?.requireReview ?? true },
      ...replayHealth(ctx),
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
        // every agent and model that worked on it, in the order they first ran
        agents: [...new Map(runs.filter((r) => r.adapter).map((r) => [`${r.adapter}|${r.model ?? ''}`, { adapter: r.adapter, host: r.host, model: r.model, role: r.role }])).values()],
        lastEventAt: events.at(-1)?.ts ?? task.updatedAt,
        summary: typeof lastMessage?.payload.text === 'string' ? lastMessage.payload.text.slice(0, 200) : null,
        autopilot: autopilotCard(events),
      });
    }
    return c.json({ tasks: cards });
  });

  app.post('/api/tasks', async (c) => {
    const body = NewTaskBody.parse(await c.req.json());
    const task = await ws.createTask(body);
    if (ws.config.autopilot?.onCreate) await ctx.autopilot.start(task.id);
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

  // how each agent and model has done, per tag, and how routing would pick (R-045)
  app.get('/api/scoreboard', async (c) => {
    const { rows } = await workspaceRecords(ws);
    return c.json({ rows, routing: ws.config.routing ?? { mode: 'chains', explore: 0 } });
  });

  app.get('/api/costs', async (c) => {
    const group = (c.req.query('group') ?? 'task') as CostGroup;
    if (!['task', 'run', 'day', 'week', 'host', 'model', 'day-host'].includes(group)) throw new DaemonError('invalid', `unknown group ${group}`, 'task, run, day, week, host, model or day-host');
    const rows = await costs(ws, { group });
    if (group !== 'host') return c.json(rows);
    // credits left are derived: the balance the person entered minus what the daemon metered
    const credits = ws.config.credits;
    const hosts = new Set([...rows.map((r) => r.key), ...Object.keys(credits)]);
    return c.json(
      [...hosts].sort().map((key) => {
        const row = rows.find((r) => r.key === key) ?? { key, inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, runs: 0, unpriced: 0 };
        const start = credits[key];
        return start === undefined ? row : { ...row, creditsLeft: Math.round((start - (row.usd ?? 0)) * 10_000) / 10_000, derived: true as const };
      }),
    );
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
    if (file !== join(dist, 'index.html') && file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return new Response(Bun.file(file));
    // The UI needs the token for state changes; it is only ever served to localhost, and other origins cannot read it.
    const html = (await Bun.file(join(dist, 'index.html')).text()).replace('</head>', `<meta name="stint-token" content="${opts.token}" /></head>`);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  });

  return app;
}

/** Once a recording is loaded the daemon says so: the UI shows "Replay of a live run on <date>". */
function replayHealth(ctx: DaemonContext): Record<string, unknown> {
  const rec = ctx.replayer.loaded;
  if (!rec) return {};
  return { mode: 'replay', replay: { title: rec.header.title, recordedAt: rec.header.recordedAt, live: rec.header.live } };
}

/** Later specs (verify, assign, handoff, approve, graph, skills) add their routes here. */
function registerRoutes(app: Hono, ctx: DaemonContext): void {
  workRoutes(app, ctx);
  summaryRoutes(app, ctx);
  runRoutes(app, ctx);
  handoffRoutes(app, ctx);
  modelRoutes(app, ctx);
  approveRoutes(app, ctx);
  fileRoutes(app, ctx);
  riskRoutes(app, ctx);
  gardeningRoutes(app, ctx);
  intakeRoutes(app, ctx);
  outcomeRoutes(app, ctx);
  demoRoutes(app, ctx);
  graphRoutes(app, ctx);
  skillRoutes(app, ctx);
  ptyRoutes(app, ctx);
  benchRoutes(app, ctx);
  gateRoutes(app, ctx);
  metricRoutes(app, ctx);
  commentRoutes(app, ctx);
}
