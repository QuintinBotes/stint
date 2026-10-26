import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { createBunWebSocket } from 'hono/bun';
import { museCodeAdapter } from '@stint-dev/adapter-muse-code';
import { type Adapter, replayAdapter } from './adapter';
import { type AppOptions, DAEMON_VERSION, createApp, daemonContext } from './app';
import { killAllPtys } from './pty';

/** Every adapter that has landed; health reports each one honestly, available or not. */
export function defaultAdapters(): Adapter[] {
  return [replayAdapter, museCodeAdapter];
}

export type DaemonInfo = { port: number; token: string; pid: number; startedAt: string; version: string };

export type StartOptions = {
  root: string;
  port?: number;
  adapters?: Adapter[];
  quiet?: boolean;
  /** Install SIGTERM and SIGINT handlers that remove daemon.json and exit. */
  handleSignals?: boolean;
} & Partial<Pick<AppOptions, 'webDist' | 'heartbeatMs' | 'health'>>;

export type RunningDaemon = DaemonInfo & { url: string; ws: Workspace; infoPath: string; stop: () => Promise<void> };

/** Starts the daemon on 127.0.0.1 only and writes `.stint/cache/daemon.json` (mode 0600). */
export async function startDaemon(o: StartOptions): Promise<RunningDaemon> {
  const ws = await Workspace.open(o.root);
  const token = randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();
  const adapters = o.adapters ?? defaultAdapters();
  const app = createApp(ws, adapters, {
    token,
    startedAt,
    quiet: o.quiet ?? false,
    ...(o.webDist !== undefined ? { webDist: o.webDist } : {}),
    ...(o.heartbeatMs ? { heartbeatMs: o.heartbeatMs } : {}),
    ...(o.health ? { health: o.health } : {}),
  });
  const { websocket } = createBunWebSocket();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: o.port ?? ws.config.port ?? 0,
    fetch: app.fetch,
    websocket,
    idleTimeout: 0,
  });
  const port = server.port as number;
  const info: DaemonInfo = { port, token, pid: process.pid, startedAt, version: DAEMON_VERSION };
  mkdirSync(ws.cacheDir, { recursive: true });
  const infoPath = join(ws.cacheDir, 'daemon.json');
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  chmodSync(infoPath, 0o600);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    killAllPtys();
    // let run endings finish their commit, verification and packet (at most 10 s)
    const ctx = daemonContext(app);
    for (const r of ctx.runs.list()) r.abort.abort();
    await Promise.race([Promise.allSettled([...ctx.pending]), Bun.sleep(10_000)]);
    rmSync(infoPath, { force: true });
    await server.stop(true);
  };
  if (o.handleSignals) {
    const onSignal = () => {
      void stop().then(() => process.exit(0));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }
  return { ...info, url: `http://127.0.0.1:${port}`, ws, infoPath, stop };
}

if (import.meta.main) {
  const root = process.env.STINT_ROOT ?? process.cwd();
  const d = await startDaemon({ root, port: Number(process.env.STINT_PORT ?? 0) || 0, handleSignals: true });
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: 'daemon up', url: d.url })}\n`);
}
