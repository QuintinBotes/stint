#!/usr/bin/env bun
// The live relay on an unseen repository (R-070): a fresh clone at a pinned commit, `stint init`, a seeded task with
// held-out scenarios, then Muse Code stopped mid-run, Claude Code on Glimmer and Codex on Muse Spark 1.3 through the
// daemon's own routes, the daemon's verification, Glimmer's review and the gate. Everything is published scrubbed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Config, type StintEvent, StintEventSchema } from '../packages/core/src/index';
import { EventLog } from '../packages/core/src/node';
import { type Adapter, replayAdapter, startDaemon } from '../packages/daemon/src/index';
import { keepAwake } from '../packages/cli/src/awake';
import { sleeper, startFakeModels, writer } from '../apps/web/e2e/flows/fakes';
import { type Client, type Hop, type Kind, type Repo, type Review, type Seeded, addScenarios, client, createTask, fail, hop, loadBench, prepareClone, publishDir, publishTasks, scrubber, seededConfig, spentOn } from './seeded-run';

const ROOT = resolve(import.meta.dir, '..');
const HOPS = ['muse-code', 'claude-code', 'codex'] as const;
/** How an owner-like step the script takes is named wherever it is recorded. */
export const SCRIPTED_BY = 'relay script (scripted owner-like approval)';
export type End = 'at-gate' | 'not-green' | 'review-blocked' | 'sequence-done' | 'budget' | 'failed';
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

/** The config the relay runs with: Claude Code on Glimmer through Ollama, Codex on Muse Spark 1.3 through the Meta Model API (docs/agents.md). */
export function relayConfig(repo: Repo, scenarios: string, modelsPort: number | null): Config {
  const config = seededConfig(repo, scenarios, modelsPort);
  const agents = config.agents ?? {};
  const claude = agents['claude-code'] ?? fail('the default config has no claude-code preset');
  const codex = agents.codex ?? fail('the default config has no codex preset');
  config.agents = {
    ...agents,
    // no Anthropic or OpenAI credential reaches either agent: every model they can call is a Meta model
    'claude-code': { ...claude, enabled: true, model: 'muse-glimmer:30b-mlx', host: 'ollama', env: [] },
    codex: { ...codex, enabled: true, model: 'muse-spark-1.3', host: 'meta-api', env: ['META_API_KEY'] },
  };
  return config;
}

/** A live run refuses an environment that would point Claude Code at anything but Glimmer on Ollama. */
export function liveEnvProblem(env: Record<string, string | undefined>): string | null {
  const base = env.ANTHROPIC_BASE_URL;
  return base && !/^http:\/\/(localhost|127\.0\.0\.1):11434\/?$/.test(base) ? `ANTHROPIC_BASE_URL is ${base}; unset it so Claude Code runs on Glimmer through Ollama` : null;
}

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
  const seededFiles = await prepareClone(repo, clone, relayConfig(repo, scenarios, models?.port ?? null));
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
  const id = await createTask(c, t, repo.testCommand);
  await addScenarios(c, id, t, opts.bench);
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
    const id = await createTask(c, t, repo.testCommand);
    await addScenarios(c, id, t, opts.bench);
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
  const { chain, costs, retried } = await publishTasks(out, record.tasks, ws, diffs, scrub);
  record.retried.push(...retried);
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
