#!/usr/bin/env bun
// The live relay on an unseen repository (R-070): a fresh clone at a pinned commit, `stint init`, a seeded task with
// held-out scenarios, then Muse Code stopped mid-run, Claude Code on Glimmer and Codex on Muse Spark 1.3 through the
// daemon's own routes, the daemon's verification, Glimmer's review and the gate. Everything is published scrubbed.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Config, DEFAULT_CONFIG, type StintEvent, StintEventSchema } from '../packages/core/src/index';
import { EventLog, GENESIS, eventHash, hashHandoff, runsFromEvents, taskCost } from '../packages/core/src/node';
import { type Adapter, replayAdapter, startDaemon } from '../packages/daemon/src/index';
import { keepAwake } from '../packages/cli/src/awake';
import { scrubPaths } from '../packages/cli/src/bench/live';
import { init } from '../packages/cli/src/init';
import { flowConfig, sleeper, startFakeModels, writer } from '../apps/web/e2e/flows/fakes';

const ROOT = resolve(import.meta.dir, '..');
const HOPS = ['muse-code', 'claude-code', 'codex'] as const;
const GLIMMER = 'ollama/muse-glimmer:30b-mlx';
/** How an owner-like step the script takes is named wherever it is recorded. */
export const SCRIPTED_BY = 'relay script (scripted owner-like approval)';
const POLL_MS = 300;
const WAIT_MS = 45 * 60_000;

export type Kind = 'relay' | 'control' | 'learning';
export type End = 'at-gate' | 'not-green' | 'review-blocked' | 'sequence-done' | 'budget' | 'failed';
export type Repo = { id: string; name: string; url: string; licence: string; commit: string; install: string; testCommand: string; removeInBaseline: string[] };
export type Seeded = { id: string; repo: string; kind: Kind; title: string; goal: string; acceptance: string[]; scenarios: string[]; tags: string[] };

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

export type LearnStep = { order: number; seeded: string; task: string; run: string | null; skillsMounted: string[]; verification: string | null; review: { verdict: string; findings: string[] } | null; approvedBy: string | null; learn: string | null; skillApproved: string | null };

export type RelayRecord = {
  version: 1;
  kind: Kind;
  repo: Pick<Repo, 'id' | 'name' | 'url' | 'licence' | 'commit'>;
  seeded: string[];
  tasks: string[];
  live: boolean;
  agents: Array<{ adapter: string; model: string; host: string }>;
  hops: Hop[];
  steps: LearnStep[];
  review: { verdict: string; findings: number; model: string | null; offline: boolean | null } | null;
  gate: boolean;
  /** How the run ended; `outcome` says it in words. */
  end: End;
  outcome: string;
  spendUsd: number;
  spendEstimated: boolean;
  priorSpendUsd: number;
  budgetUsd: number | null;
  scripted: string[];
  retried: string[];
  scrubbed: string[];
  chainVerifiedBeforeScrub: boolean | null;
  startedAt: string;
  finishedAt: string;
};

// ---------------------------------------------------------------------------------------------------------------
// The seeded data, read at the boundary: bench/relay/repos.json and bench/relay/tasks.json

const fail = (message: string): never => {
  throw new Error(message);
};
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
function publishDir(src: string, dst: string, scrub: (t: string) => string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      publishDir(from, to, scrub);
      continue;
    }
    if (!entry.isFile()) continue;
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

// ---------------------------------------------------------------------------------------------------------------
// What a published folder must show (R-070 acceptance 1 and 2)

export type Published = { record: RelayRecord; events: Map<string, StintEvent[]> };

export async function readPublished(dir: string): Promise<Published> {
  const record = JSON.parse(readFileSync(join(dir, 'relay.json'), 'utf8')) as RelayRecord;
  const events = new Map<string, StintEvent[]>();
  for (const task of record.tasks) {
    const path = join(dir, 'tasks', task, 'events.jsonl');
    events.set(task, existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StintEvent) : []);
  }
  return { record, events };
}

/** Problems with a published relay, control or learning run, in plain words; none means it holds up. */
export async function relayProblems(dir: string): Promise<string[]> {
  const out: string[] = [];
  const { record, events } = await readPublished(dir);
  for (const task of record.tasks) {
    const rows = events.get(task) ?? [];
    for (const e of rows) {
      const parsed = StintEventSchema.safeParse(e);
      if (!parsed.success) out.push(`${task} event ${e.seq} does not validate: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    }
    const chain = await EventLog.at(join(dir, 'tasks', task, 'events.jsonl')).verify();
    if (!chain.ok) out.push(`${task} events.jsonl hash chain breaks at row ${chain.brokenAt}`);
  }
  if (record.kind === 'learning') {
    if (record.steps.length < 6) out.push(`the learning sequence has ${record.steps.length} tasks, not at least 6`);
    return out;
  }
  const task = record.tasks[0];
  const rows = task ? (events.get(task) ?? []) : [];
  // a run cut short by the budget or a failure shows the hops it got to, in order
  const ran = record.hops.map((h) => h.adapter).join(' > ');
  const full = ['at-gate', 'not-green', 'review-blocked'].includes(record.end);
  if (full ? ran !== HOPS.join(' > ') : !HOPS.join(' > ').startsWith(ran)) out.push(`the agents ran as ${ran || 'nobody'}, not ${HOPS.join(' > ')}`);
  record.hops.forEach((h, i) => {
    const started = rows.find((e) => e.type === 'run.started' && e.run === h.run);
    if (!started) out.push(`no run.started for ${h.run}`);
    if (started?.adapter !== h.adapter) out.push(`${h.run} was started by ${started?.adapter}, not ${h.adapter}`);
    if (i === 0) return;
    const packet = rows.find((e) => e.type === 'handoff.created' && e.payload.name === h.handoffFrom);
    const prev = record.hops[i - 1] as Hop;
    if (!h.handoffFrom || started?.payload.handoffFrom !== h.handoffFrom) out.push(`${h.run} did not start from a packet`);
    else if (!packet) out.push(`packet ${h.handoffFrom} that ${h.run} started from is not in the log`);
    else if ((packet.payload.from as { run?: string } | undefined)?.run !== prev.run || (packet.payload.to as { adapter?: string } | null)?.adapter !== h.adapter) {
      out.push(`packet ${h.handoffFrom} does not hand ${prev.run} to ${h.adapter}`);
    } else if (!existsSync(join(dir, 'tasks', task as string, 'handoffs', `${h.handoffFrom}.json`))) out.push(`packet ${h.handoffFrom} is not published`);
  });
  const last = record.hops.at(-1);
  if (full && last && !existsSync(join(dir, 'tasks', task as string, 'verification', `${last.run}.json`))) out.push(`no verification for the last run ${last.run}`);
  const gated = rows.some((e) => e.type === 'approval.requested');
  if (record.kind === 'control' && (gated || record.gate)) out.push('the control reached the gate');
  if (record.gate !== gated) out.push(`relay.json says gate ${record.gate} but the log ${gated ? 'has' : 'has no'} approval.requested`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The run

type Options = { repo: string; kind: Kind; dry: boolean; bench: string; work: string; name: string; stopAfterSteps: number; stopAfterS: number; budgetUsd: number | null };

function sh(argv: string[], cwd?: string): string {
  const r = Bun.spawnSync(argv, { ...(cwd ? { cwd } : {}), stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${argv.slice(0, 3).join(' ')} failed: ${r.stderr.toString().trim().slice(0, 400)}`);
  return r.stdout.toString();
}

/** The config the relay runs with: Claude Code on Glimmer through Ollama, Codex on Muse Spark 1.3 through the Meta Model API (docs/agents.md). */
export function relayConfig(repo: Repo, scenarios: string, modelsPort: number | null): Config {
  const config: Config = modelsPort === null ? structuredClone(DEFAULT_CONFIG) : flowConfig(modelsPort);
  const agents = config.agents ?? {};
  const claude = agents['claude-code'] ?? fail('the default config has no claude-code preset');
  const codex = agents.codex ?? fail('the default config has no codex preset');
  config.agents = {
    ...agents,
    // no Anthropic or OpenAI credential reaches either agent: every model they can call is a Meta model
    'claude-code': { ...claude, enabled: true, model: 'muse-glimmer:30b-mlx', host: 'ollama', env: [] },
    codex: { ...codex, enabled: true, model: 'muse-spark-1.3', host: 'meta-api', env: ['META_API_KEY'] },
  };
  config.testCommand = repo.testCommand;
  // the review is Glimmer offline, and a killed run's digest too; nothing falls back to a paid host
  if (modelsPort === null) for (const role of ['reviewer', 'summary'] as const) config.routes[role] = [GLIMMER];
  config.verify = { checks: [], tamper: 'fail' };
  // outside the clone, so nothing under the agents' worktrees leads to them; run with the repository's own command
  config.scenarios = { dir: scenarios, command: repo.testCommand };
  return config;
}

/** A live run refuses an environment that would point Claude Code at anything but Glimmer on Ollama. */
export function liveEnvProblem(env: Record<string, string | undefined>): string | null {
  const base = env.ANTHROPIC_BASE_URL;
  return base && !/^http:\/\/(localhost|127\.0\.0\.1):11434\/?$/.test(base) ? `ANTHROPIC_BASE_URL is ${base}; unset it so Claude Code runs on Glimmer through Ollama` : null;
}

function prepareClone(repo: Repo, root: string, scenarios: string, modelsPort: number | null): Promise<string[]> {
  sh(['git', 'clone', '-q', repo.url, root]);
  sh(['git', '-C', root, 'checkout', '-q', '-B', 'stint-relay', repo.commit]);
  for (const f of repo.removeInBaseline) sh(['git', '-C', root, 'rm', '-q', '--', f]);
  sh(['sh', '-c', repo.install], root);
  mkdirSync(join(root, '.stint'), { recursive: true });
  writeFileSync(join(root, '.stint', 'config.json'), `${JSON.stringify(relayConfig(repo, scenarios, modelsPort), null, 2)}\n`);
  return init(root).then(({ changed }) => {
    const seeded = changed.filter((f) => !f.startsWith('.stint/'));
    if (seeded.length) sh(['git', '-C', root, 'add', '--', ...seeded]);
    if (seeded.length || repo.removeInBaseline.length) sh(['git', '-C', root, 'commit', '-q', '-m', `Seed the relay baseline${repo.removeInBaseline.length ? `: remove ${repo.removeInBaseline.join(', ')}` : ''}`]);
    return seeded;
  });
}

type Client = ReturnType<typeof client>;

function client(url: string, token: string) {
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
const spentOn = async (c: Client, tasks: string[]) => {
  let usd = 0;
  let estimated = false;
  for (const id of tasks) {
    const ev = await c.events(id);
    const cost = taskCost(id, runsFromEvents(ev), ev);
    usd += cost.usd ?? 0;
    estimated ||= !!cost.estimated;
  }
  return { usd: Math.round(usd * 10_000) / 10_000, estimated };
};

/** Every costs.json already published beside this run: the spend the budget counts first. */
export function priorSpend(bench: string): number {
  if (!existsSync(bench)) return 0;
  let usd = 0;
  for (const d of readdirSync(bench, { withFileTypes: true })) {
    const file = join(bench, d.name, 'costs.json');
    if (d.isDirectory() && existsSync(file)) usd += Number((JSON.parse(readFileSync(file, 'utf8')) as { totalUsd?: unknown }).totalUsd) || 0;
  }
  return usd;
}

type Stop = { steps: number; s: number };

/** One agent's run: hop 1 is assigned, a later hop is handed the packet the run before left; stopped at `stop` if given. */
async function hop(c: Client, id: string, n: number, adapter: string, stop: Stop | null): Promise<Hop> {
  const { run } = await c.post<{ run: string }>(`/api/tasks/${id}/${n === 0 ? 'assign' : 'hand'}`, { adapter, role: 'implementer' });
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

type Review = { verdict: string; findings: Array<{ text: string }>; model?: string; offline?: boolean };

async function createTask(c: Client, t: Seeded, testCommand: string, bench: string): Promise<string> {
  const task = await c.post<{ id: string }>('/api/tasks', { title: t.title, goal: t.goal, acceptance: t.acceptance, testCommand, ...(t.tags.length ? { tags: t.tags } : {}) });
  for (const name of t.scenarios) await c.post(`/api/tasks/${task.id}/scenarios`, { name, content: readFileSync(scenarioFile(bench, t.id, name), 'utf8') });
  return task.id;
}

/** Runs one relay, control or learning sequence; `dir` is null when it ended before any task existed, so nothing is published. */
export async function runRelay(opts: Options): Promise<{ dir: string | null; record: RelayRecord }> {
  const { repos, tasks } = loadBench(opts.bench);
  const repo = repos.find((r) => r.id === opts.repo) ?? fail(`no repository ${opts.repo} in ${join(opts.bench, 'repos.json')} (there: ${repos.map((r) => r.id).join(', ')})`);
  const seeded = tasks.filter((t) => t.repo === repo.id && t.kind === opts.kind);
  if (!seeded.length) fail(`no ${opts.kind} task for ${repo.id} in ${join(opts.bench, 'tasks.json')}`);
  if (opts.kind !== 'learning' && seeded.length !== 1) fail(`${repo.id} has ${seeded.length} ${opts.kind} tasks; the relay runs one`);
  const problem = opts.dry ? null : liveEnvProblem(process.env);
  if (problem) fail(problem);
  const out = join(opts.bench, opts.name);
  if (existsSync(out)) fail(`${out} exists, and a published run is never replaced (a failed one stays published); pass --name for a new folder`);
  const prior = priorSpend(opts.bench);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const clone = join(opts.work, `${repo.id}-${opts.kind}-${stamp}`);
  const scenarios = join(opts.work, `${repo.id}-${opts.kind}-${stamp}-scenarios`);
  const models = opts.dry ? startFakeModels() : null;
  const record: RelayRecord = {
    version: 1,
    kind: opts.kind,
    repo: { id: repo.id, name: repo.name, url: repo.url, licence: repo.licence, commit: repo.commit },
    seeded: seeded.map((t) => t.id),
    tasks: [],
    live: !opts.dry,
    agents: opts.dry
      ? HOPS.map((adapter) => ({ adapter, model: 'fake', host: 'none' }))
      : [
          { adapter: 'muse-code', model: 'muse-spark-1.3', host: 'meta-api' },
          { adapter: 'claude-code', model: 'muse-glimmer:30b-mlx', host: 'ollama' },
          { adapter: 'codex', model: 'muse-spark-1.3', host: 'meta-api' },
        ],
    hops: [],
    steps: [],
    review: null,
    gate: false,
    end: 'failed',
    outcome: 'failed: the run did not start',
    spendUsd: 0,
    spendEstimated: false,
    priorSpendUsd: prior,
    budgetUsd: opts.budgetUsd,
    scripted: [],
    retried: [],
    scrubbed: ['machine paths, the user name, emails and key values', 'long dashes written as -', 'events.jsonl hash chains and packet hashes computed again over the scrubbed text'],
    chainVerifiedBeforeScrub: null,
    startedAt: new Date().toISOString(),
    finishedAt: '',
  };
  if (opts.dry) record.scripted.push('dry run: the flows fakes stand in for every agent and model; nothing here is live');
  if (opts.kind === 'learning') record.agents = record.agents.slice(0, 1);

  mkdirSync(opts.work, { recursive: true });
  const seededFiles = await prepareClone(repo, clone, scenarios, models?.port ?? null);
  if (repo.removeInBaseline.length) record.scripted.push(`the baseline commit removes ${repo.removeInBaseline.join(', ')}`);
  record.scripted.push(`stint init wrote ${seededFiles.join(', ') || 'nothing to commit'}`);
  // a dry relay's Muse Code works until it is stopped; a dry learning build writes its file and ends
  const fakeMuse = opts.kind === 'learning' ? writer('muse-code') : { ...sleeper, id: 'muse-code' };
  const adapters: Adapter[] | undefined = opts.dry ? [replayAdapter, fakeMuse, writer('claude-code'), writer('codex')] : undefined;
  const d = await startDaemon({ root: clone, port: 0, quiet: true, webDist: null, digest: true, ...(adapters ? { adapters } : {}) });
  const c = client(d.url, d.token);
  const diffs = new Map<string, string>();
  let biggest = 0;
  const step = async <T>(what: string, run: () => Promise<T>): Promise<T | null> => {
    const before = await spentOn(c, record.tasks);
    if (opts.budgetUsd !== null && prior + before.usd + biggest > opts.budgetUsd) {
      record.end = 'budget';
      record.outcome = `stopped before ${what}: recorded spend $${(prior + before.usd).toFixed(4)} plus the largest step so far $${biggest.toFixed(4)} would pass the $${opts.budgetUsd} budget`;
      return null;
    }
    const value = await run();
    biggest = Math.max(biggest, (await spentOn(c, record.tasks)).usd - before.usd);
    return value;
  };
  try {
    const health = await c.get<{ adapters: Array<{ id: string; available: boolean; capability: { reason?: string } }> }>('/api/health');
    for (const id of opts.kind === 'learning' ? ['muse-code'] : HOPS) {
      const a = health.adapters.find((x) => x.id === id);
      if (!a?.available) fail(`${id} is not available: ${a?.capability.reason ?? 'not configured'}`);
    }
    if (opts.kind === 'learning') await learningSequence(c, seeded, repo, opts, record, step);
    else await relaySequence(c, seeded[0] as Seeded, repo, opts, record, step);
  } catch (err) {
    record.end = 'failed';
    record.outcome = `failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    for (const id of record.tasks) diffs.set(id, await c.get<string>(`/api/tasks/${id}/diff`).catch((err: unknown) => `the diff could not be read: ${String(err)}\n`));
    const spend = await spentOn(c, record.tasks).catch(() => ({ usd: 0, estimated: true }));
    record.spendUsd = spend.usd;
    record.spendEstimated = spend.estimated;
    await d.stop();
    models?.stop();
  }
  record.finishedAt = new Date().toISOString();
  if (!record.tasks.length) return { dir: null, record };
  await publish(out, clone, scenarios, opts.work, record, d.ws, diffs);
  return { dir: out, record };
}

async function relaySequence(c: Client, t: Seeded, repo: Repo, opts: Options, record: RelayRecord, step: <T>(what: string, run: () => Promise<T>) => Promise<T | null>): Promise<void> {
  const id = await createTask(c, t, repo.testCommand, opts.bench);
  record.tasks.push(id);
  record.scripted.push(`${HOPS[0]} is stopped by the script after ${opts.stopAfterSteps} tool calls or ${opts.stopAfterS} s, whichever comes first, through the stop route a person's stint stop uses`);
  for (const [n, adapter] of HOPS.entries()) {
    const done = await step(adapter, () => hop(c, id, n, adapter, n === 0 ? { steps: opts.stopAfterSteps, s: opts.stopAfterS } : null));
    if (!done) return;
    record.hops.push(done);
  }
  const last = record.hops.at(-1) as Hop;
  if (last.verification !== 'green') {
    record.end = 'not-green';
    record.outcome = `stopped before the gate: the daemon's verification of ${last.run} is ${last.verification ?? 'missing'}`;
    return;
  }
  const review = await step('the review', () => c.post<Review>(`/api/tasks/${id}/review`, {}));
  if (!review) return;
  record.review = { verdict: review.verdict, findings: review.findings.length, model: review.model ?? null, offline: review.offline ?? null };
  const { task } = await c.get<{ task: { status: string } }>(`/api/tasks/${id}`);
  record.gate = task.status === 'awaiting_approval';
  record.end = record.gate ? 'at-gate' : 'review-blocked';
  record.outcome = record.gate ? 'at the gate: verified green and reviewed; the relay stops here and approves nothing' : `stopped before the gate: the review answered ${review.verdict}`;
}

async function learningSequence(c: Client, seeded: Seeded[], repo: Repo, opts: Options, record: RelayRecord, step: <T>(what: string, run: () => Promise<T>) => Promise<T | null>): Promise<void> {
  record.scripted.push(`every approval, of a change and of a proposed skill, is made by the script and recorded with by: "${SCRIPTED_BY}"`);
  for (const [i, t] of seeded.entries()) {
    const id = await createTask(c, t, repo.testCommand, opts.bench);
    record.tasks.push(id);
    const s: LearnStep = { order: i + 1, seeded: t.id, task: id, run: null, skillsMounted: [], verification: null, review: null, approvedBy: null, learn: null, skillApproved: null };
    record.steps.push(s);
    const built = await step(`${t.id} build`, () => hop(c, id, 0, HOPS[0], null));
    if (!built) return;
    s.run = built.run;
    s.verification = built.verification;
    s.skillsMounted = ((await c.events(id)).find((e) => e.type === 'run.started' && e.run === built.run)?.payload.skills as string[] | undefined) ?? [];
    if (built.verification !== 'green') continue;
    const review = await step(`${t.id} review`, () => c.post<Review>(`/api/tasks/${id}/review`, {}));
    if (!review) return;
    s.review = { verdict: review.verdict, findings: review.findings.map((f) => f.text) };
    const { task } = await c.get<{ task: { status: string } }>(`/api/tasks/${id}`);
    if (task.status !== 'awaiting_approval') continue;
    const before = (await c.events(id)).length;
    const approved = await step(`${t.id} approval and learn step`, async () => {
      await c.post(`/api/tasks/${id}/approve`, { by: SCRIPTED_BY });
      return c.until(id, (ev) => ev.slice(before).some((e) => e.type === 'skill.proposed' || e.type === 'learn.skipped'), `the learn step after ${id}`);
    });
    if (!approved) return;
    s.approvedBy = SCRIPTED_BY;
    const proposed = approved.slice(before).find((e) => e.type === 'skill.proposed');
    const skipped = approved.slice(before).find((e) => e.type === 'learn.skipped');
    s.learn = proposed ? `proposed ${String(proposed.payload.id)}` : `skipped: ${String(skipped?.payload.reason ?? 'no reason recorded')}`;
    if (proposed) {
      await c.post(`/api/skills/${String(proposed.payload.id)}/approve`, { by: SCRIPTED_BY });
      s.skillApproved = String(proposed.payload.id);
    }
  }
  const approvedSkills = record.steps.filter((s) => s.skillApproved).map((s) => s.skillApproved);
  record.end = 'sequence-done';
  record.outcome = `ran ${record.steps.length} tasks; skills approved by the script: ${approvedSkills.join(', ') || 'none'}`;
}

async function publish(out: string, clone: string, scenarios: string, work: string, record: RelayRecord, ws: { taskDir: (id: string) => Promise<string> }, diffs: Map<string, string>): Promise<void> {
  const scrub = scrubber([
    [clone, '<clone>'],
    [scenarios, '<scenarios>'],
    [work, '<work>'],
  ]);
  let chain = true;
  mkdirSync(out, { recursive: true });
  const costs: Array<{ task: string; usd: number | null; estimated: boolean; runs: Array<{ run: string; adapter: string | null; role: string | null; host: string | null; model: string | null; usd: number | null }> }> = [];
  for (const id of record.tasks) {
    const dir = await ws.taskDir(id);
    const log = join(dir, 'events.jsonl');
    if (existsSync(log)) chain &&= (await EventLog.at(log).verify()).ok;
    publishDir(dir, join(out, 'tasks', id), scrub);
    const ev = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as StintEvent) : [];
    const runs = runsFromEvents(ev);
    const total = taskCost(id, runs, ev);
    // a host that failed and the next one that answered is a retry the daemon made, so it is said here too
    for (const e of ev.filter((x) => x.type === 'provider.fallback')) record.retried.push(`${id} ${String(e.payload.role)}: ${String(e.payload.from)} to ${String(e.payload.to)} (${String(e.payload.reason)})`);
    costs.push({ task: id, usd: total.usd, estimated: !!total.estimated, runs: runs.map((r) => ({ run: r.run, adapter: r.adapter ?? null, role: r.role ?? null, host: r.host ?? null, model: r.model ?? null, usd: r.cost?.usd ?? null })) });
    writeFileSync(join(out, 'tasks', id, 'diff.patch'), scrub(diffs.get(id) ?? ''));
  }
  const skills = join(clone, '.agents', 'skills');
  if (existsSync(skills)) publishDir(skills, join(out, 'skills'), scrub);
  record.chainVerifiedBeforeScrub = record.tasks.length ? chain : null;
  writeFileSync(join(out, 'costs.json'), `${JSON.stringify({ totalUsd: record.spendUsd, estimated: record.spendEstimated, tasks: costs }, null, 2)}\n`);
  writeFileSync(join(out, 'relay.json'), `${scrub(JSON.stringify(record, null, 2))}\n`);
}

// ---------------------------------------------------------------------------------------------------------------

const USAGE = `bun scripts/relay.ts <repo> [--control | --learning] [options]

  <repo>                 a repository id from bench/relay/repos.json: negotiator, wait-on or ms
  --control              run the repository's control task (it must stop before the gate)
  --learning             run the repository's learning sequence, one Muse Code build per task
  --dry                  the flows fakes instead of real agents and models; nothing is live
  --work <dir>           where the fresh clone goes (default: $STINT_RELAY_WORK, else the system temp folder)
  --bench <dir>          the seeded data and the published runs (default: bench/relay)
  --name <folder>        the published folder under --bench (default: <repo>, <repo>-control or <repo>-learning,
                         with -dry after it for a dry run)
  --stop-after-steps <n> stop Muse Code after this many tool calls (default 10, or 1 for a dry run)
  --stop-after-s <s>     or after this many seconds, whichever comes first (default 300)
  --budget-usd <usd>     stop before a step when the recorded spend, every published costs.json included,
                         plus the largest step so far would pass this
`;

function options(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      control: { type: 'boolean' },
      learning: { type: 'boolean' },
      dry: { type: 'boolean' },
      work: { type: 'string' },
      bench: { type: 'string' },
      name: { type: 'string' },
      'stop-after-steps': { type: 'string' },
      'stop-after-s': { type: 'string' },
      'budget-usd': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length !== 1) fail(USAGE);
  if (values.control && values.learning) fail('pass --control or --learning, not both');
  const num = (raw: string | undefined, name: string, dflt: number | null, min: number): number | null => {
    if (raw === undefined) return dflt;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fail(`--${name} must be a number of at least ${min}, not ${raw}`);
  };
  const repo = positionals[0] as string;
  const kind: Kind = values.control ? 'control' : values.learning ? 'learning' : 'relay';
  return {
    repo,
    kind,
    dry: !!values.dry,
    work: resolve(values.work ?? process.env.STINT_RELAY_WORK ?? join(tmpdir(), 'stint-relay')),
    bench: resolve(values.bench ?? join(ROOT, 'bench', 'relay')),
    // a rehearsal never takes the folder its live run will publish to
    name: values.name ?? `${repo}${kind === 'relay' ? '' : `-${kind}`}${values.dry ? '-dry' : ''}`,
    // a dry run's stand-in for Muse Code makes one tool call and waits to be stopped
    stopAfterSteps: num(values['stop-after-steps'], 'stop-after-steps', values.dry ? 1 : 10, 1) as number,
    stopAfterS: num(values['stop-after-s'], 'stop-after-s', 300, 1) as number,
    budgetUsd: num(values['budget-usd'], 'budget-usd', null, 0),
  };
}

if (import.meta.main) {
  try {
    const opts = options(process.argv.slice(2));
    if (!opts.dry) keepAwake();
    const { dir, record } = await runRelay(opts);
    process.stdout.write(`${record.outcome}\nspend $${record.spendUsd}${record.spendEstimated ? ' (part unpriced)' : ''}; ${dir ? `published ${relative(process.cwd(), dir) || dir}` : 'nothing was created, so nothing is published'}\n`);
    process.exit(record.end === 'failed' ? 1 : 0);
  } catch (err) {
    process.stderr.write(`relay: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}
