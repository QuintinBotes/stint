// What a live run on an unseen repository needs, shared by the relay and the scorecard (R-070): the seeded data in
// bench/relay, a fresh clone at the pinned commit with `stint init`, a client for the daemon's own routes, one agent's
// run through them, and publishing what the daemon wrote, scrubbed.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Config, DEFAULT_CONFIG, type StintEvent } from '../packages/core/src/index';
import { EventLog, GENESIS, eventHash, hashHandoff, runsFromEvents, taskCost } from '../packages/core/src/node';
import { scrubPaths } from '../packages/cli/src/bench/live';
import { init } from '../packages/cli/src/init';
import { flowConfig } from '../apps/web/e2e/flows/fakes';

export const GLIMMER = 'ollama/muse-glimmer:30b-mlx';
const POLL_MS = 300;
const WAIT_MS = 45 * 60_000;

export type Kind = 'relay' | 'control' | 'learning';
export type Repo = { id: string; name: string; url: string; licence: string; commit: string; install: string; testCommand: string; removeInBaseline: string[] };
export type Seeded = { id: string; repo: string; kind: Kind; title: string; goal: string; acceptance: string[]; scenarios: string[]; tags: string[] };

export const fail = (message: string): never => {
  throw new Error(message);
};

// ---------------------------------------------------------------------------------------------------------------
// The seeded data, read at the boundary: bench/relay/repos.json and bench/relay/tasks.json

const str = (o: Record<string, unknown>, k: string, at: string): string => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : fail(`${at}: "${k}" must be a non-empty string`));
const strs = (o: Record<string, unknown>, k: string, at: string): string[] =>
  o[k] === undefined ? [] : Array.isArray(o[k]) && (o[k] as unknown[]).every((v) => typeof v === 'string') ? (o[k] as string[]) : fail(`${at}: "${k}" must be a list of strings`);

/** A scenario is kept as `<path in the repository>.txt`, so nothing in this repository runs or lints it. */
const scenarioFile = (bench: string, task: string, name: string) => join(bench, 'scenarios', task, `${name}.txt`);

export function loadBench(dir: string): { repos: Repo[]; tasks: Seeded[] } {
  const read = (file: string): Record<string, unknown>[] => {
    const body = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    const list = body[file === 'repos.json' ? 'repos' : 'tasks'];
    return Array.isArray(list) ? (list as Record<string, unknown>[]) : fail(`${file} has no list`);
  };
  const repos = read('repos.json').map((r, i) => {
    const at = `repos.json repo ${i + 1}`;
    if (!/^[0-9a-f]{40}$/.test(String(r.commit))) fail(`${at}: "commit" must be a full 40-character sha`);
    return { id: str(r, 'id', at), name: str(r, 'name', at), url: str(r, 'url', at), licence: str(r, 'licence', at), commit: str(r, 'commit', at), install: str(r, 'install', at), testCommand: str(r, 'testCommand', at), removeInBaseline: strs(r, 'removeInBaseline', at) };
  });
  const tasks = read('tasks.json').map((t, i) => {
    const at = `tasks.json task ${i + 1}`;
    const kind = str(t, 'kind', at);
    if (!['relay', 'control', 'learning'].includes(kind)) fail(`${at}: "kind" must be relay, control or learning`);
    const scenarios = strs(t, 'scenarios', at);
    for (const s of scenarios) {
      if (s.split('/').includes('..') || s.startsWith('/')) fail(`${at}: scenario ${s} must be a relative path inside the repository`);
      if (!existsSync(scenarioFile(dir, String(t.id), s))) fail(`${at}: no file ${relative(dir, scenarioFile(dir, String(t.id), s))}`);
    }
    return { id: str(t, 'id', at), repo: str(t, 'repo', at), kind: kind as Kind, title: str(t, 'title', at), goal: str(t, 'goal', at), acceptance: strs(t, 'acceptance', at), scenarios, tags: strs(t, 'tags', at) };
  });
  return { repos, tasks };
}

// ---------------------------------------------------------------------------------------------------------------
// Scrubbing and re-hashing what is published

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`, 'g');
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Published text names no machine path, user, email or key; long dashes are written as plain ones (the repo's rule). */
export function scrubber(labels: Array<[string, string]>): (text: string) => string {
  const pairs = labels.flatMap(([p, label]) => [...new Set([p, real(p)])].map((x) => [x, label] as const)).sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let out = text;
    for (const [p, label] of pairs) out = out.split(p).join(label);
    return scrubPaths(out).replace(EMAIL, '<email>').replace(DASHES, '-');
  };
}

/** A scrubbed log's hash chain, computed again over the scrubbed rows; a packet inside a row gets its hash again too. */
export function rechain(text: string): string {
  let prev = GENESIS;
  const rows = text.split('\n').filter((l) => l.trim());
  return `${rows
    .map((line) => {
      const e = JSON.parse(line) as StintEvent;
      const packet = e.type === 'handoff.created' ? (e.payload.packet as Record<string, unknown> | undefined) : undefined;
      if (packet) {
        packet.hash = hashHandoff(packet as never);
        e.payload.hash = packet.hash;
      }
      const hash = eventHash(e, prev);
      const out = JSON.stringify({ ...e, prev, hash });
      prev = hash;
      return out;
    })
    .join('\n')}\n`;
}

/** Copies a folder through the scrubber: events.jsonl is chained again, a packet hashed again. */
export function publishDir(src: string, dst: string, scrub: (t: string) => string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      publishDir(from, to, scrub);
      continue;
    }
    if (!entry.isFile()) continue;
    // an agent CLI's raw transcript carries the person's own setup (plugins, paths, settings); the events, packets, diff
    // and verification are the record, so the transcript is never published
    if (entry.name.startsWith('transcript')) continue;
    mkdirSync(dst, { recursive: true });
    const buf = readFileSync(from);
    if (buf.includes(0)) {
      cpSync(from, to);
      continue;
    }
    let text = scrub(buf.toString('utf8'));
    if (entry.name === 'events.jsonl') text = rechain(text);
    else if (entry.name.endsWith('.json') && text.includes('"stint.handoff/1"')) {
      const packet = JSON.parse(text) as Record<string, unknown>;
      if (packet.version === 'stint.handoff/1') text = `${JSON.stringify({ ...packet, hash: hashHandoff(packet as never) }, null, 2)}\n`;
    }
    writeFileSync(to, text);
  }
}

export type TaskCosts = { task: string; usd: number | null; estimated: boolean; runs: Array<{ run: string; adapter: string | null; role: string | null; host: string | null; model: string | null; usd: number | null }> };

/** Publishes each task folder the daemon wrote, with its diff; says whether every chain held before scrubbing, what each task cost and what the daemon retried. */
export async function publishTasks(out: string, tasks: string[], ws: { taskDir: (id: string) => Promise<string> }, diffs: Map<string, string>, scrub: (t: string) => string): Promise<{ chain: boolean; costs: TaskCosts[]; retried: string[] }> {
  let chain = true;
  const costs: TaskCosts[] = [];
  const retried: string[] = [];
  mkdirSync(out, { recursive: true });
  for (const id of tasks) {
    const dir = await ws.taskDir(id);
    const log = join(dir, 'events.jsonl');
    if (existsSync(log)) chain &&= (await EventLog.at(log).verify()).ok;
    publishDir(dir, join(out, 'tasks', id), scrub);
    const ev = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StintEvent) : [];
    const runs = runsFromEvents(ev);
    const total = taskCost(id, runs, ev);
    // a host that failed and the next one that answered is a retry the daemon made, so it is said here too
    for (const e of ev.filter((x) => x.type === 'provider.fallback')) retried.push(`${id} ${String(e.payload.role)}: ${String(e.payload.from)} to ${String(e.payload.to)} (${String(e.payload.reason)})`);
    costs.push({ task: id, usd: total.usd, estimated: !!total.estimated, runs: runs.map((r) => ({ run: r.run, adapter: r.adapter ?? null, role: r.role ?? null, host: r.host ?? null, model: r.model ?? null, usd: r.cost?.usd ?? null })) });
    writeFileSync(join(out, 'tasks', id, 'diff.patch'), scrub(diffs.get(id) ?? ''));
  }
  return { chain, costs, retried };
}

// ---------------------------------------------------------------------------------------------------------------
// The clone

export function sh(argv: string[], cwd?: string): string {
  const r = Bun.spawnSync(argv, { ...(cwd ? { cwd } : {}), stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${r.stderr.toString().trim().slice(0, 400)}`);
  return r.stdout.toString();
}

/** What every live run on a seeded repository shares: its test command, the review on Glimmer offline, the tamper guard and the held-out scenarios outside the clone. */
export function seededConfig(repo: Repo, scenarios: string, modelsPort: number | null): Config {
  const config: Config = modelsPort === null ? structuredClone(DEFAULT_CONFIG) : flowConfig(modelsPort);
  config.testCommand = repo.testCommand;
  // the review is Glimmer offline, and a killed run's digest too; nothing falls back to a paid host
  if (modelsPort === null) for (const role of ['reviewer', 'summary'] as const) config.routes[role] = [GLIMMER];
  config.verify = { checks: [], tamper: 'fail' };
  // outside the clone, so nothing under the agents' worktrees leads to them; run with the repository's own command
  config.scenarios = { dir: scenarios, command: repo.testCommand };
  return config;
}

/** A fresh clone at the pinned commit, installed, with the config written and `stint init` committed; returns what init seeded. */
export async function prepareClone(repo: Repo, root: string, config: Config): Promise<string[]> {
  sh(['git', 'clone', '-q', repo.url, root]);
  sh(['git', '-C', root, 'checkout', '-q', '-B', 'stint-relay', repo.commit]);
  for (const f of repo.removeInBaseline) sh(['git', '-C', root, 'rm', '-q', '--', f]);
  sh(['sh', '-c', repo.install], root);
  mkdirSync(join(root, '.stint'), { recursive: true });
  writeFileSync(join(root, '.stint', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const { changed } = await init(root);
  const seeded = changed.filter((f) => !f.startsWith('.stint/'));
  if (seeded.length) sh(['git', '-C', root, 'add', '--', ...seeded]);
  if (seeded.length || repo.removeInBaseline.length) sh(['git', '-C', root, 'commit', '-q', '-m', `Seed the relay baseline${repo.removeInBaseline.length ? `: remove ${repo.removeInBaseline.join(', ')}` : ''}`]);
  return seeded;
}

// ---------------------------------------------------------------------------------------------------------------
// The daemon's own routes

export type Client = ReturnType<typeof client>;

export function client(url: string, token: string) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${url}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${text.slice(0, 400)}`);
    return (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as T;
  };
  const self = {
    get: <T>(path: string) => call<T>('GET', path),
    post: <T>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    events: (id: string) => call<{ events: StintEvent[] }>('GET', `/api/tasks/${id}/events`).then((r) => r.events),
    async until(id: string, done: (ev: StintEvent[]) => boolean, what: string): Promise<StintEvent[]> {
      const t0 = Date.now();
      for (;;) {
        const ev = await self.events(id);
        if (done(ev)) return ev;
        if (Date.now() - t0 > WAIT_MS) throw new Error(`waited ${WAIT_MS / 60_000} minutes for ${what}`);
        await Bun.sleep(POLL_MS);
      }
    },
  };
  return self;
}

const ofRun = (ev: StintEvent[], type: string, run: string) => ev.filter((e) => e.type === type && e.run === run);

/** What the tasks cost so far, as the daemon priced them; `estimated` when a part is unpriced. */
export async function spentOn(c: Client, tasks: string[]): Promise<{ usd: number; estimated: boolean }> {
  let usd = 0;
  let estimated = false;
  for (const id of tasks) {
    const ev = await c.events(id);
    const cost = taskCost(id, runsFromEvents(ev), ev);
    usd += cost.usd ?? 0;
    estimated ||= !!cost.estimated;
  }
  return { usd: Math.round(usd * 10_000) / 10_000, estimated };
}

export type Hop = {
  hop: number;
  adapter: string;
  run: string;
  model: string | null;
  host: string | null;
  endedBy: string | null;
  stoppedByRelay: string | null;
  handoffFrom: string | null;
  packetLeft: string | null;
  verification: string | null;
  usd: number | null;
};

type Stop = { steps: number; s: number };

/** One agent's run: hop 1 is assigned, a later hop is handed the packet the run before left; stopped at `stop` if given, on `model` if named. */
export async function hop(c: Client, id: string, n: number, adapter: string, stop: Stop | null, model?: string): Promise<Hop> {
  const { run } = await c.post<{ run: string }>(`/api/tasks/${id}/${n === 0 ? 'assign' : 'hand'}`, { adapter, role: 'implementer', ...(model ? { model } : {}) });
  let stoppedByRelay: string | null = null;
  if (stop) {
    const t0 = Date.now();
    const ev = await c.until(id, (ev) => ofRun(ev, 'run.finished', run).length > 0 || ofRun(ev, 'agent.tool_call', run).length >= stop.steps || Date.now() - t0 >= stop.s * 1000, `${adapter} to reach the stop point`);
    if (!ofRun(ev, 'run.finished', run).length) {
      const calls = ofRun(ev, 'agent.tool_call', run).length;
      stoppedByRelay = calls >= stop.steps ? `stopped by the relay after ${calls} tool calls` : `stopped by the relay after ${Math.round((Date.now() - t0) / 1000)} s`;
      await c.post(`/api/tasks/${id}/runs/${run}/stop`);
    }
  }
  // the stop answers once run.finished is recorded; the verification and the packet arrive on the log after it
  const ev = await c.until(id, (ev) => ofRun(ev, 'run.finished', run).length > 0 && ofRun(ev, 'handoff.created', run).length > 0, `the packet ${run} leaves`);
  const started = ofRun(ev, 'run.started', run)[0];
  const finished = ofRun(ev, 'run.finished', run)[0];
  const cost = finished?.payload.cost as { usd?: number | null } | undefined;
  return {
    hop: n + 1,
    adapter,
    run,
    model: (finished?.payload.model as string | null | undefined) ?? null,
    host: (finished?.payload.host as string | null | undefined) ?? null,
    endedBy: (finished?.payload.endedBy as string | undefined) ?? null,
    stoppedByRelay,
    handoffFrom: (started?.payload.handoffFrom as string | null | undefined) ?? null,
    packetLeft: (ofRun(ev, 'handoff.created', run)[0]?.payload.name as string | undefined) ?? null,
    verification: (ofRun(ev, 'verification.ran', run).at(-1)?.payload.status as string | undefined) ?? null,
    usd: cost?.usd ?? null,
  };
}

export type Review = { verdict: string; findings: Array<{ severity: string; text: string }>; model?: string; offline?: boolean };

export async function createTask(c: Client, t: Seeded, testCommand: string): Promise<string> {
  const task = await c.post<{ id: string }>('/api/tasks', { title: t.title, goal: t.goal, acceptance: t.acceptance, testCommand, ...(t.tags.length ? { tags: t.tags } : {}) });
  return task.id;
}

/** Hands the seeded task's held-out scenarios to the daemon, which keeps them outside every worktree (R-037). */
export async function addScenarios(c: Client, id: string, t: Seeded, bench: string): Promise<void> {
  for (const name of t.scenarios) await c.post(`/api/tasks/${id}/scenarios`, { name, content: readFileSync(scenarioFile(bench, t.id, name), 'utf8') });
}
