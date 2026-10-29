import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace, writeJsonAtomic } from '@stint-dev/core/node';
import { createBunWebSocket } from 'hono/bun';
import { acpAgent } from '@stint-dev/adapter-acp';
import { cliAgent } from '@stint-dev/adapter-cli-agent';
import { claudeCode } from '@stint-dev/adapter-claude-code';
import { codex } from '@stint-dev/adapter-codex';
import { museCodeAdapter } from '@stint-dev/adapter-muse-code';
import { createStintAgent } from '@stint-dev/adapter-stint-agent';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { type Adapter, replayAdapter, warmAvailability } from './adapter';
import { type AppOptions, DAEMON_VERSION, createApp, daemonContext } from './app';
import { gardenTick } from './gardening';
import { recoverRuns } from './lifecycle';
import { scheduledPull } from './intake';
import { pollReleases, scanOutcomes } from './outcomes';
import { killAllPtys } from './pty';

/** Every adapter that has landed; health reports each one honestly, available or not. */
export function defaultAdapters(config?: Config): Adapter[] {
  const cfg = config ?? DEFAULT_CONFIG;
  const agents: Adapter[] = [];
  for (const [name, def] of Object.entries(cfg.agents ?? {})) {
    if (!def.enabled) continue;
    const harness = def.acp ? 'acp' : (def.harness ?? 'cli');
    if (harness === 'claude-code') {
      const h = def.host ? cfg.hosts[def.host] : undefined;
      const baseURL = h ? (h.baseURL ?? (h.baseURLEnv ? process.env[h.baseURLEnv] : undefined)) : undefined;
      agents.push(claudeCode(name, def, def.host && h ? { id: def.host, ...(baseURL ? { baseURL } : {}), keyless: !h.keyEnv } : undefined));
    } else if (harness === 'codex') agents.push(codex(name, def));
    else if (harness === 'acp') agents.push(acpAgent(name, def));
    else agents.push(cliAgent(name, def));
  }
  // the built-ins follow adapters.<id>.enabled like any agent; the replay adapter is how the demo plays, so it stays
  const on = (id: string) => cfg.adapters?.[id]?.enabled !== false;
  return [replayAdapter, ...(on('muse-code') ? [museCodeAdapter] : []), ...(on('stint-agent') ? [createStintAgent(config)] : []), ...agents];
}

export type DaemonInfo = { port: number; token: string; pid: number; startedAt: string; version: string };

export type StartOptions = {
  root: string;
  port?: number;
  adapters?: Adapter[];
  quiet?: boolean;
  /** Install SIGTERM and SIGINT handlers that remove daemon.json and exit. */
  handleSignals?: boolean;
} & Partial<Pick<AppOptions, 'webDist' | 'heartbeatMs' | 'health' | 'digest'>>;

/** `hostname` is the address the server is bound to, which is always 127.0.0.1 (R-004). */
export type RunningDaemon = DaemonInfo & { hostname: string; url: string; ws: Workspace; infoPath: string; stop: () => Promise<void> };

/** Starts the daemon on 127.0.0.1 only and writes `.stint/cache/daemon.json` (mode 0600). */
export async function startDaemon(o: StartOptions): Promise<RunningDaemon> {
  const ws = await Workspace.open(o.root);
  const token = randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();
  const adapters = o.adapters ?? defaultAdapters(ws.config);
  void warmAvailability(adapters);
  const app = createApp(ws, adapters, {
    token,
    startedAt,
    quiet: o.quiet ?? false,
    ...(o.webDist !== undefined ? { webDist: o.webDist } : {}),
    ...(o.heartbeatMs ? { heartbeatMs: o.heartbeatMs } : {}),
    ...(o.health ? { health: o.health } : {}),
    ...(o.digest ? { digest: true } : {}),
  });
  const outcomeCtx = daemonContext(app);
  const logScanFailure = (what: string) => (err: unknown) =>
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `${what} did NOT run: ${err instanceof Error ? err.message : String(err)}` })}\n`);
  // runs a crash or a stop cut off are closed first; then a task the log says is on autopilot picks up where it was
  const recovering = recoverRuns(outcomeCtx)
    .catch(logScanFailure('closing the runs a restart cut off'))
    .then(() => outcomeCtx.autopilot.resume())
    .catch(logScanFailure('resuming autopilot'));
  outcomeCtx.pending.add(recovering);
  void recovering.finally(() => outcomeCtx.pending.delete(recovering));
  // outcomes after merge are scanned on start, then every 10 minutes; pull requests every minute (R-030, R-042)
  await scanOutcomes(outcomeCtx).catch(logScanFailure('the outcome scan on start'));
  const outcomeTimer = setInterval(() => void scanOutcomes(outcomeCtx).catch(logScanFailure('the outcome scan')), 10 * 60_000);
  (outcomeTimer as unknown as { unref?: () => void }).unref?.();
  // upkeep tasks on their schedule (R-044): on start, then every hour
  await gardenTick(outcomeCtx).catch(logScanFailure('the upkeep schedule on start'));
  const gardenTimer = setInterval(() => void gardenTick(outcomeCtx).catch(logScanFailure('the upkeep schedule')), 60 * 60_000);
  (gardenTimer as unknown as { unref?: () => void }).unref?.();
  // issues from GitHub and Linear, when the config sets them up (R-041)
  const intakeTimer = setInterval(() => void scheduledPull(outcomeCtx).catch(logScanFailure('the intake pull')), 15 * 60_000);
  (intakeTimer as unknown as { unref?: () => void }).unref?.();
  const releaseTimer = setInterval(() => void pollReleases(outcomeCtx).catch(logScanFailure('the pull request poll')), 60_000);
  (releaseTimer as unknown as { unref?: () => void }).unref?.();
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
  // the token is in this file: created 0600 before it holds anything, renamed into place whole
  await writeJsonAtomic(infoPath, info, { mode: 0o600 });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(outcomeTimer);
    clearInterval(releaseTimer);
    clearInterval(gardenTimer);
    clearInterval(intakeTimer);
    killAllPtys();
    // let run endings finish their commit, verification and packet (at most 10 s)
    const ctx = daemonContext(app);
    for (const r of ctx.runs.list()) r.abort.abort();
    await Promise.race([Promise.allSettled([...ctx.pending]), Bun.sleep(10_000)]);
    rmSync(infoPath, { force: true });
    await ctx.otel.stop();
    await server.stop(true);
  };
  if (o.handleSignals) {
    const onSignal = () => {
      void stop().then(() => process.exit(0));
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }
  return { ...info, hostname: server.hostname as string, url: `http://127.0.0.1:${port}`, ws, infoPath, stop };
}

if (import.meta.main) {
  const root = process.env.STINT_ROOT ?? process.cwd();
  const d = await startDaemon({ root, port: Number(process.env.STINT_PORT ?? 0) || 0, handleSignals: true });
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: 'daemon up', url: d.url })}\n`);
}
