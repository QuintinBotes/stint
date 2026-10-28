// A sandbox per run (R-040). A worktree is a place to write, not a boundary, so an agent can be run where it can
// write only its worktree and the git data its commits need, and reach the network only through the egress proxy.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { writeFileAtomic } from '@stint-dev/core/node';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Adapter, Config } from '@stint-dev/core';
import type { DaemonContext } from './app';
import { type Blocked, EgressProxy, defaultAllow } from './egress';
import { runEnv } from './env';
import { DaemonError } from './errors';

export type SandboxKind = 'none' | 'docker' | 'sandbox-exec';

export type SandboxOpts = {
  kind: SandboxKind;
  worktree: string;
  /** The main repository: a worktree's commits land in its `.git`. */
  root: string;
  /** Loopback ports the run may reach: the egress proxy and the daemon. */
  ports: number[];
  writable?: string[];
  image?: string;
  /** Names of the variables passed into a container (docker reads their values from its own environment). */
  envNames?: string[];
  /** In docker the proxy is the sidecar on the internal network; null when egress is off. */
  dockerProxy?: string | null;
  name?: string;
};

export const DOCKER_NETWORK = 'stint-egress';
export const DOCKER_PROXY = 'stint-egress-proxy';
/** Node 22 runs the proxy's TypeScript by stripping its types. */
const PROXY_IMAGE = 'node:22';

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The places a coding agent writes besides its worktree: temp files and its own state and caches. */
function writableDefaults(): string[] {
  const home = homedir();
  return [tmpdir(), '/private/tmp', '/private/var/folders', join(home, '.config'), join(home, '.cache'), join(home, '.bun'), join(home, '.npm'), join(home, 'Library', 'Application Support'), join(home, 'Library', 'Caches')];
}

const q = (s: string): string => JSON.stringify(s);

/**
 * The macOS sandbox profile: reads are allowed except the daemon's cache, which holds its token; writes only to the
 * worktree, the repository's git data but not its hooks or config, temp and agent state; outbound network only to
 * unix sockets and the loopback ports named.
 */
export function sandboxProfile(o: SandboxOpts): string {
  const paths = [o.worktree, join(o.root, '.git'), ...writableDefaults(), ...(o.writable ?? [])].map(real);
  const cache = join(real(o.root), '.stint', 'cache');
  const gitDir = real(join(o.root, '.git'));
  const worktree = real(o.worktree);
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${paths.map((p) => `(subpath ${q(p)})`).join(' ')} (subpath "/dev"))`,
    // after the allow rules, since the last matching rule wins; a checkout the daemon made under the cache stays readable
    `(deny file-read* (subpath ${q(cache)}))`,
    ...(worktree.startsWith(`${cache}/`) ? [`(allow file-read* (subpath ${q(worktree)}))`] : []),
    // a hook or a config line written here would run in the daemon's git, outside this sandbox
    `(deny file-write* (subpath ${q(join(gitDir, 'hooks'))}) (literal ${q(join(gitDir, 'config'))}))`,
    '(deny network-outbound)',
    '(allow network-outbound (remote unix-socket))',
    ...o.ports.map((p) => `(allow network-outbound (remote ip ${q(`localhost:${p}`)}))`),
  ].join('\n');
}

/** The command line that runs `argv` inside the sandbox; `none` leaves it as it is. */
export function sandboxArgv(argv: string[], o: SandboxOpts): string[] {
  if (o.kind === 'none') return argv;
  if (o.kind === 'sandbox-exec') return ['sandbox-exec', '-p', sandboxProfile(o), ...argv];
  const gitDir = join(o.root, '.git');
  const uid = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid?.() ?? 0}` : null;
  return [
    'docker',
    'run',
    '--rm',
    '-i',
    '--init',
    ...(o.name ? ['--name', o.name] : []),
    ...(uid ? ['--user', uid] : []),
    // with egress on, the internal network has no route out except the proxy sidecar
    '--network',
    o.dockerProxy ? DOCKER_NETWORK : 'bridge',
    // the same absolute paths inside, so the worktree's .git pointer still resolves
    '-v',
    `${o.worktree}:${o.worktree}`,
    '-v',
    `${gitDir}:${gitDir}`,
    // the cache, which holds the daemon's token, is never mounted; hooks and config are read-only
    '-v',
    `${gitDir}/hooks:${gitDir}/hooks:ro`,
    '-v',
    `${gitDir}/config:${gitDir}/config:ro`,
    '-w',
    o.worktree,
    ...(o.envNames ?? []).flatMap((n) => ['-e', n]),
    o.image ?? 'node:22',
    ...argv,
  ];
}

/** Whether the configured sandbox can run here, and why not. */
export async function sandboxAvailable(kind: SandboxKind): Promise<{ ok: boolean; reason?: string }> {
  if (kind === 'none') return { ok: true };
  if (kind === 'sandbox-exec') {
    if (process.platform !== 'darwin') return { ok: false, reason: 'sandbox-exec is macOS only' };
    return Bun.which('sandbox-exec') ? { ok: true } : { ok: false, reason: 'sandbox-exec is not on PATH' };
  }
  if (!Bun.which('docker')) return { ok: false, reason: 'docker is not on PATH' };
  const info = Bun.spawn(['docker', 'info', '--format', '{{.ServerVersion}}'], { stdout: 'pipe', stderr: 'pipe' });
  return (await info.exited) === 0 ? { ok: true } : { ok: false, reason: 'the docker daemon is not running' };
}

const docker = async (args: string[]): Promise<{ code: number; out: string }> => {
  const p = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
};

/**
 * The docker egress path: an internal network with no route out, and the proxy as a sidecar on both it and the
 * default bridge. Refusals are appended to a log the daemon reads back into the run's events.
 */
export async function ensureDockerEgress(allow: string[], logDir: string): Promise<string> {
  if ((await docker(['network', 'inspect', DOCKER_NETWORK])).code !== 0) {
    const made = await docker(['network', 'create', '--internal', DOCKER_NETWORK]);
    if (made.code !== 0) throw new Error(`could not create the ${DOCKER_NETWORK} network`);
  }
  // one sidecar per workspace; a changed allow list or log folder starts a fresh one, since both are fixed at start
  const name = `${DOCKER_PROXY}-${createHash('sha256').update(logDir).digest('hex').slice(0, 8)}`;
  const key = createHash('sha256').update(`${logDir}\n${allow.join(',')}`).digest('hex').slice(0, 16);
  const state = (await docker(['inspect', '-f', '{{.State.Running}} {{index .Config.Labels "stint.egress"}}', name])).out.trim();
  if (state !== `true ${key}`) {
    await docker(['rm', '-f', name]);
    const src = dirname(new URL(import.meta.url).pathname);
    const started = await docker([
      'run', '-d', '--rm', '--name', name, '--label', `stint.egress=${key}`, '--network', 'bridge',
      '-v', `${src}:/stint:ro`, '-v', `${logDir}:/log`,
      '-e', 'STINT_EGRESS_SIDECAR=1', '-e', `STINT_EGRESS_ALLOW=${allow.join(',')}`, '-e', 'STINT_EGRESS_LOG=/log/blocked.jsonl', '-e', 'STINT_EGRESS_PORT=3128',
      PROXY_IMAGE,
      'node', '/stint/egress.ts',
    ]);
    if (started.code !== 0) throw new Error('could not start the egress proxy sidecar');
    await docker(['network', 'connect', DOCKER_NETWORK, name]);
  }
  return `${name}:3128`;
}


/** Every host a run may reach: the configured model hosts, the package registry and `sandbox.egress.allow`. */
export function egressAllow(config: Config): string[] {
  return [...new Set([...defaultAllow(config.hosts as Record<string, { baseURL?: string }>), ...(config.sandbox?.egress.allow ?? [])])];
}

/** The daemon's egress proxy, started the first time a run needs it. */
export function egressProxy(ctx: DaemonContext): Promise<EgressProxy> {
  if (!ctx.egress) {
    const proxy = new EgressProxy(
      () => egressAllow(ctx.ws.config),
      (b) => void recordBlocked(ctx, b),
    );
    ctx.egress = proxy.start().then(() => proxy);
  }
  return ctx.egress;
}

/** A refused connection goes on the run that tried it, so the next packet says the network was refused. */
export async function recordBlocked(ctx: DaemonContext, b: Blocked): Promise<void> {
  const known = b.task ? await ctx.ws.readTask(b.task).then(() => true, () => false) : false;
  if (!known || !b.task) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', message: 'egress refused', host: b.host, port: b.port })}\n`);
    return;
  }
  await ctx.ws.events(b.task).append({
    task: b.task,
    ...(b.run ? { run: b.run } : {}),
    vendor: 'daemon',
    type: 'rule.blocked',
    payload: { by: 'egress', action: `${b.method === 'CONNECT' ? 'connect to' : b.method} ${b.host}:${b.port}`, reason: `${b.host} is not in sandbox.egress.allow`, host: b.host, port: b.port },
  });
}

/** Reads the docker sidecar's refusals since the last read into the runs that tried them. */
export async function drainDockerBlocked(ctx: DaemonContext): Promise<void> {
  const log = join(ctx.ws.cacheDir, 'egress', 'blocked.jsonl');
  const mark = `${log}.read`;
  if (!existsSync(log)) return;
  const text = readFileSync(log, 'utf8');
  const from = existsSync(mark) ? Number(readFileSync(mark, 'utf8')) || 0 : 0;
  for (const line of text.slice(from).split('\n').filter(Boolean)) {
    try {
      await recordBlocked(ctx, JSON.parse(line) as Blocked);
    } catch {
      // a torn last line is read again next time
      break;
    }
  }
  await writeFileAtomic(mark, String(text.length));
}

/**
 * The environment and sandbox for one agent run, or for the daemon's test run on its code (`extra` adds variables
 * and `named` is false). A sandbox that is configured but cannot run refuses: Stint never quietly runs an agent's
 * code outside the boundary it was told to keep.
 */
export async function prepareRun(ctx: DaemonContext, task: string, run: string, worktree: string, adapter: Pick<Adapter, 'needsEnv'>, extra: Record<string, string> = {}, named = true): Promise<{ env: Record<string, string>; wrap?: (argv: string[]) => string[] }> {
  const sb = ctx.ws.config.sandbox;
  const kind = sb?.kind ?? 'none';
  const egressOn = sb?.egress.mode === 'proxy';
  if (kind !== 'none') {
    const av = await sandboxAvailable(kind);
    if (!av.ok) throw new DaemonError('adapter_unavailable', `the ${kind} sandbox is configured but cannot run: ${av.reason}`, 'start it, or set sandbox.kind to none');
  }
  let proxy: string | null = null;
  let dockerProxy: string | null = null;
  if (egressOn && kind === 'docker') {
    mkdirSync(join(ctx.ws.cacheDir, 'egress'), { recursive: true });
    dockerProxy = await ensureDockerEgress(egressAllow(ctx.ws.config), join(ctx.ws.cacheDir, 'egress'));
    proxy = `http://${task}:${run}@${dockerProxy}`;
  } else if (egressOn) {
    proxy = (await egressProxy(ctx)).url(task, run);
  }
  const env = { ...runEnv(task, run, worktree, { keep: adapter.needsEnv ?? [], proxy, hosts: ctx.ws.config.hosts }), ...extra };
  if (kind === 'none') return { env };
  const ports = [egressOn && kind !== 'docker' ? (await egressProxy(ctx)).port : 0, daemonPort(ctx)].filter((p) => p > 0);
  const envNames = kind === 'docker' ? Object.keys(env).filter((k) => k.startsWith('STINT_') || /proxy$/i.test(k) || k === 'NODE_USE_ENV_PROXY' || k === 'TERM' || (adapter.needsEnv ?? []).includes(k) || k in extra) : undefined;
  const opts: SandboxOpts = { kind, worktree, root: ctx.ws.root, ports, writable: sb?.writable ?? [], ...(sb?.image ? { image: sb.image } : {}), ...(envNames ? { envNames } : {}), dockerProxy, ...(named ? { name: `stint-${task}-${run}`.toLowerCase() } : {}) };
  return { env, wrap: (argv) => sandboxArgv(argv, opts) };
}

/** The port in daemon.json, which a sandboxed agent cannot read, so it is handed the port instead. */
export function daemonPort(ctx: DaemonContext): number {
  try {
    return Number((JSON.parse(readFileSync(join(ctx.ws.cacheDir, 'daemon.json'), 'utf8')) as { port?: number }).port) || 0;
  } catch {
    return 0;
  }
}

/** What `/api/health` says about the boundary runs get. */
export async function sandboxHealth(ctx: DaemonContext): Promise<Record<string, unknown>> {
  const sb = ctx.ws.config.sandbox;
  const kind = sb?.kind ?? 'none';
  const av = await sandboxAvailable(kind);
  const mode = sb?.egress.mode ?? 'off';
  return {
    kind,
    ok: av.ok,
    ...(av.reason ? { reason: av.reason } : {}),
    egress: { mode, ...(mode === 'proxy' ? { allow: egressAllow(ctx.ws.config), enforced: kind !== 'none' } : {}) },
  };
}
