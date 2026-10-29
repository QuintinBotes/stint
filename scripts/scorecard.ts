#!/usr/bin/env bun
// The scorecard (R-070 requirement 4): k attempts at each seeded relay task, each from a fresh clone at the pinned
// commit, by the Stint agent on Muse Spark Open (Baseten) with autopilot off. The daemon verifies the run with the
// repository's own tests, Glimmer reviews a green change offline, then the daemon verifies again with the hidden tests,
// which grade the attempt. The hidden tests come last because the daemon offers a review only after a green
// verification: with them first, a review could never meet a patch the hidden tests reject.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Config, type Scorecard, type ScorecardAttempt, ScorecardAttemptSchema, ScorecardSchema, type ScorecardShare, scorecardRows } from '../packages/core/src/index';
import { type VerificationRecord, runsFromEvents } from '../packages/core/src/node';
import { replayAdapter, startDaemon } from '../packages/daemon/src/index';
import { keepAwake } from '../packages/cli/src/awake';
import { startFakeModels, writer } from '../apps/web/e2e/flows/fakes';
import type { RelayRecord } from './relay';
import { GLIMMER, type Repo, type Review, type Seeded, addScenarios, client, createTask, fail, hop, loadBench, prepareClone, publishTasks, scrubber, seededConfig, spentOn } from './seeded-run';

const ROOT = resolve(import.meta.dir, '..');
const ADAPTER = 'stint-agent';
/** The route name stays baseten/muse-spark-open; the host maps it to meta-models/muse-spark-open-1026 (D-063). */
export const SPARK_OPEN = 'baseten/muse-spark-open';

/** The config an attempt runs with: the Stint agent on Muse Spark Open through Baseten only, so nothing falls back to another host. */
export function scorecardConfig(repo: Repo, scenarios: string, modelsPort: number | null): Config {
  const config = seededConfig(repo, scenarios, modelsPort);
  config.routes.agent = [SPARK_OPEN];
  return config;
}

// ---------------------------------------------------------------------------------------------------------------
// What is recorded: bench/scorecard/<task>-a<n>/attempt.json beside the task folder the daemon wrote

const attemptsDir = (out: string) => join(out, 'scorecard');

export function recordedAttempts(out: string): ScorecardAttempt[] {
  const dir = attemptsDir(out);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'attempt.json')))
    .map((d) => ScorecardAttemptSchema.parse(JSON.parse(readFileSync(join(dir, d.name, 'attempt.json'), 'utf8'))));
}

/** The published relays the hand-off figure rests on: relay runs only, never a control or a learning sequence. */
export function readRelays(bench: string): Array<{ dir: string; record: RelayRecord }> {
  if (!existsSync(bench)) return [];
  return readdirSync(bench, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(bench, d.name, 'relay.json')))
    .map((d) => ({ dir: d.name, record: JSON.parse(readFileSync(join(bench, d.name, 'relay.json'), 'utf8')) as RelayRecord }))
    .filter((r) => r.record.kind === 'relay')
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

// ---------------------------------------------------------------------------------------------------------------
// The aggregate

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const share = (hits: number, n: number): ScorecardShare => ({ value: n ? round(hits / n, 4) : null, n });
const mean = (xs: number[], places: number) => ({ value: xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length, places) : null, n: xs.length });
const flagged = (a: ScorecardAttempt) => !!a.review && a.review.verdict !== 'approve';

function countModels(rows: Array<Omit<Scorecard['models'][number], 'runs'>>): Scorecard['models'] {
  const out = new Map<string, Scorecard['models'][number]>();
  for (const r of rows) {
    const key = JSON.stringify(r);
    const seen = out.get(key);
    if (seen) seen.runs += 1;
    else out.set(key, { ...r, runs: 1 });
  }
  return [...out.values()];
}

/** pass^1 is the share of graded attempts the hidden tests passed; pass^k says whether all of a task's first k did, as R-046 defines it. */
export function buildScorecard(input: { attempts: ScorecardAttempt[]; relays: Array<{ dir: string; record: RelayRecord }>; k: number; live: boolean; generatedAt: string }): Scorecard {
  const attempts = [...input.attempts].sort((a, b) => a.task.localeCompare(b.task) || a.attempt - b.attempt);
  const graded = attempts.filter((a) => a.hidden !== null);
  const green = graded.filter((a) => a.hidden === 'green');
  const ids = [...new Set(attempts.map((a) => a.task))];
  const tasks = ids.map((id) => {
    const mine = graded.filter((a) => a.task === id);
    const firstK = mine.slice(0, input.k);
    return {
      id,
      repo: (attempts.find((a) => a.task === id) as ScorecardAttempt).repo,
      attempts: attempts.filter((a) => a.task === id).length,
      green: mine.filter((a) => a.hidden === 'green').length,
      pass1: share(mine.filter((a) => a.hidden === 'green').length, mine.length),
      passK: firstK.length < input.k ? { value: null, n: firstK.length } : { value: firstK.every((a) => a.hidden === 'green') ? 1 : 0, n: input.k },
    };
  });
  const withK = tasks.filter((t) => t.passK.value !== null);
  const relays = input.relays.filter((r) => r.record.live === input.live);
  const continued = relays.flatMap((r) => r.record.hops.filter((h) => h.handoffFrom));
  const reviewed = graded.filter((a) => a.review);
  const bad = graded.filter((a) => a.hidden === 'red');
  const pricedGreen = green.filter((a) => a.usd !== null && !a.estimated);
  return {
    version: 'stint.scorecard/1',
    live: input.live,
    k: input.k,
    generatedAt: input.generatedAt,
    models: [
      ...countModels(attempts.filter((a) => a.run).map((a) => ({ source: 'attempts' as const, role: 'implementer' as const, adapter: a.adapter, model: a.model, host: a.host }))),
      ...countModels(attempts.flatMap((a) => (a.review ? [{ source: 'attempts' as const, role: 'reviewer' as const, adapter: a.review.adapter ?? 'reviewer', model: a.review.model, host: a.review.host }] : []))),
      ...countModels(relays.flatMap((r) => r.record.hops.map((h) => ({ source: 'relays' as const, role: 'implementer' as const, adapter: h.adapter, model: h.model, host: h.host })))),
    ],
    tasks,
    overall: { pass1: share(green.length, graded.length), passK: share(withK.filter((t) => t.passK.value === 1).length, withK.length) },
    handoff: { ...share(continued.filter((h) => h.verification === 'green').length, continued.length), green: continued.filter((h) => h.verification === 'green').length, relays: relays.map((r) => r.dir) },
    review: {
      n: reviewed.length,
      caught: reviewed.filter((a) => flagged(a) && a.hidden === 'red').length,
      missed: reviewed.filter((a) => !flagged(a) && a.hidden === 'red').length,
      falseAlarm: reviewed.filter((a) => flagged(a) && a.hidden === 'green').length,
      agreed: reviewed.filter((a) => !flagged(a) && a.hidden === 'green').length,
    },
    badPatches: { n: bad.length, byTests: share(bad.filter((a) => a.tests === 'red').length, bad.length), byTestsAndReview: share(bad.filter((a) => a.tests === 'red' || flagged(a)).length, bad.length) },
    perGreen: {
      usd: { ...mean(pricedGreen.map((a) => a.usd as number), 4), unpriced: green.length - pricedGreen.length },
      wallMs: mean(green.flatMap((a) => (a.wallMs === null ? [] : [a.wallMs])), 0),
    },
    spend: { usd: round(attempts.reduce((s, a) => s + (a.usd ?? 0), 0), 4), estimated: attempts.some((a) => a.usd === null || a.estimated) },
    attempts,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The renderer: a markdown table for docs/proofs.md

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function renderScorecard(card: Scorecard): string {
  const rows = scorecardRows(card);
  const who = (source: 'attempts' | 'relays') =>
    card.models
      .filter((m) => m.source === source)
      .map((m) => `${m.adapter} on ${m.host ?? 'an unknown host'}/${m.model ?? 'an unknown model'} as ${m.role} (${plural(m.runs, 'run')})`)
      .join(', ') || 'nobody';
  return [
    `Scorecard (${card.live ? 'live' : 'dry run, the flows fakes'}): k ${card.k}, ${plural(card.attempts.length, 'attempt')} on ${plural(card.tasks.length, 'seeded task')}, spend $${card.spend.usd.toFixed(4)}${card.spend.estimated ? ' (part unpriced)' : ''}, generated ${card.generatedAt.slice(0, 10)}.`,
    '',
    '| Figure | Result | Rests on |',
    '|---|---|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
    `The attempts ran ${who('attempts')}. The relays ran ${who('relays')}.`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// One attempt

type Options = { dry: boolean; k: number; relay: string; out: string; work: string; budgetUsd: number | null; render: boolean };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One attempt from a fresh clone, published under <out>/scorecard/<task>-a<n>/; throws when it failed before a task
 * existed, so nothing was spent or recorded. `problem` names a failure of the setup, or a run that ended failed.
 */
async function runAttempt(repo: Repo, t: Seeded, n: number, opts: Options): Promise<{ record: ScorecardAttempt; problem: string | null }> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const clone = join(opts.work, `${t.id}-a${n}-${stamp}`);
  const scenarios = `${clone}-scenarios`;
  const startedAt = new Date().toISOString();
  const a: ScorecardAttempt = { task: t.id, repo: repo.id, attempt: n, live: !opts.dry, stintTask: null, run: null, adapter: ADAPTER, model: null, host: null, endedBy: null, tests: null, hidden: null, scenarios: null, review: null, usd: null, estimated: false, wallMs: null, retried: [], outcome: '', startedAt, finishedAt: startedAt };
  const models = opts.dry ? startFakeModels() : null;
  let d: Awaited<ReturnType<typeof startDaemon>> | null = null;
  let diff = '';
  let problem: string | null = null;
  try {
    mkdirSync(opts.work, { recursive: true });
    await prepareClone(repo, clone, scorecardConfig(repo, scenarios, models?.port ?? null));
    d = await startDaemon({ root: clone, port: 0, quiet: true, webDist: null, ...(opts.dry ? { adapters: [replayAdapter, writer(ADAPTER)] } : {}) });
    const c = client(d.url, d.token);
    try {
      const health = await c.get<{ adapters: Array<{ id: string; available: boolean; capability: { reason?: string } }> }>('/api/health');
      const agent = health.adapters.find((x) => x.id === ADAPTER);
      if (!agent?.available) fail(`${ADAPTER} is not available: ${agent?.capability.reason ?? 'not configured'}`);
      a.stintTask = await createTask(c, t, repo.testCommand);
      const t0 = Date.now();
      const h = await hop(c, a.stintTask, 0, ADAPTER, null, SPARK_OPEN);
      Object.assign(a, { run: h.run, model: h.model, host: h.host, endedBy: h.endedBy, tests: h.verification });
      // graded like any run, but a host that stopped answering ends a run failed too, so a person looks before the next
      if (h.endedBy === 'failed') problem = `the run ended failed; read ${t.id}-a${n}'s events before a rerun continues`;
      let reviewNote = '';
      if (h.verification === 'green') {
        try {
          const review = await c.post<Review>(`/api/tasks/${a.stintTask}/review`, {});
          const by = runsFromEvents(await c.events(a.stintTask)).filter((r) => r.role === 'reviewer').at(-1);
          a.review = { verdict: review.verdict as 'approve', findings: review.findings.map((f) => ({ severity: f.severity as 'note', text: f.text })), adapter: by?.adapter ?? null, model: by?.model ?? null, host: by?.host ?? null, offline: review.offline ?? null };
        } catch (err) {
          reviewNote = `; the review did not answer: ${message(err)}`;
        }
      }
      a.wallMs = Date.now() - t0;
      // the run and its review are over, so no agent can see the hidden tests now
      await addScenarios(c, a.stintTask, t, opts.relay);
      const v = await c.post<VerificationRecord>(`/api/tasks/${a.stintTask}/verify`, { run: h.run });
      // hidden tests that could not run grade nothing: the red record would say nothing about the patch
      a.hidden = v.scenarios ? v.status : null;
      a.scenarios = v.scenarios ? { passed: v.scenarios.passed, failed: v.scenarios.failed } : null;
      a.outcome = `${a.hidden ? `graded ${a.hidden} by the hidden tests` : 'not graded: the hidden tests did not run'}; the run ended ${h.endedBy ?? 'unknown'} and its own tests were ${h.verification ?? 'not run'}${a.review ? `; the review answered ${a.review.verdict}` : ''}${reviewNote}`;
    } catch (err) {
      a.outcome = `failed: ${message(err)}`;
      problem = 'it failed; rerun to continue from the next attempt';
    }
    if (!a.stintTask) throw new Error(a.outcome);
    diff = await c.get<string>(`/api/tasks/${a.stintTask}/diff`).catch((err: unknown) => `the diff could not be read: ${message(err)}\n`);
    const spend = await spentOn(c, [a.stintTask]).catch(() => ({ usd: 0, estimated: true }));
    a.usd = spend.usd;
    a.estimated = spend.estimated;
  } finally {
    await d?.stop();
    models?.stop();
  }
  a.finishedAt = new Date().toISOString();
  const out = join(attemptsDir(opts.out), `${t.id}-a${n}`);
  const scrub = scrubber([
    [clone, '<clone>'],
    [scenarios, '<scenarios>'],
    [opts.work, '<work>'],
  ]);
  const { retried } = await publishTasks(out, [a.stintTask], d.ws, new Map([[a.stintTask, diff]]), scrub);
  a.retried = retried;
  const record = ScorecardAttemptSchema.parse(JSON.parse(scrub(JSON.stringify(a))));
  writeFileSync(join(out, 'attempt.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { record, problem };
}

// ---------------------------------------------------------------------------------------------------------------
// The run: every attempt not yet recorded, in order, then the aggregate

export type Result = { card: Scorecard; ran: number; stopped: string | null; failed: boolean };

export async function runScorecard(opts: Options): Promise<Result> {
  const { repos, tasks } = loadBench(opts.relay);
  const seeded = tasks.filter((t) => t.kind === 'relay');
  if (!seeded.length) fail(`no relay task in ${join(opts.relay, 'tasks.json')}`);
  const recorded = recordedAttempts(opts.out);
  const mixed = recorded.find((a) => a.live === opts.dry);
  if (mixed) fail(`${attemptsDir(opts.out)} holds ${mixed.live ? 'live' : 'dry'} attempts; a ${opts.dry ? 'dry' : 'live'} run writes to another --out`);
  const relays = readRelays(opts.relay);
  // before the first attempt, the largest priced run the published relays recorded stands in for the next attempt
  const firstGuess = Math.max(0, ...relays.filter((r) => r.record.live === !opts.dry).flatMap((r) => r.record.hops.map((h) => h.usd ?? 0)));
  let ran = 0;
  let stopped: string | null = null;
  let failed = false;
  loop: for (const t of seeded) {
    const repo = repos.find((r) => r.id === t.repo) ?? fail(`${t.id} names repository ${t.repo}, which is not in repos.json`);
    for (let n = 1; n <= opts.k; n++) {
      if (recorded.some((a) => a.task === t.id && a.attempt === n)) continue;
      const spent = recorded.reduce((s, a) => s + (a.usd ?? 0), 0);
      const next = recorded.length ? Math.max(...recorded.map((a) => a.usd ?? 0)) : firstGuess;
      if (opts.budgetUsd !== null && spent + next > opts.budgetUsd) {
        stopped = `stopped before ${t.id} attempt ${n}: recorded spend $${spent.toFixed(4)} plus the largest attempt so far $${next.toFixed(4)} would pass the $${opts.budgetUsd} budget`;
        break loop;
      }
      process.stdout.write(`${t.id} attempt ${n} of ${opts.k}\n`);
      const { record: a, problem } = await runAttempt(repo, t, n, opts);
      recorded.push(a);
      ran += 1;
      process.stdout.write(`  ${a.outcome}; $${(a.usd ?? 0).toFixed(4)}${a.estimated ? ' (part unpriced)' : ''}\n`);
      // stop rather than spend on every attempt while something is broken; a rerun resumes at the next attempt
      if (problem) {
        failed = true;
        stopped = `stopped after ${t.id} attempt ${n}: ${problem}`;
        break loop;
      }
    }
  }
  const card = ScorecardSchema.parse(buildScorecard({ attempts: recorded, relays, k: opts.k, live: !opts.dry, generatedAt: new Date().toISOString() }));
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, 'scorecard.json'), `${JSON.stringify(card, null, 2)}\n`);
  return { card, ran, stopped, failed };
}

/** A live run needs Baseten's key and Glimmer on Ollama before any clone is made; the key's value is never read out. */
async function liveProblem(): Promise<string | null> {
  if (!process.env.BASETEN_API_KEY) return 'BASETEN_API_KEY is not set';
  const tags = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) }).then((r) => r.json() as Promise<{ models?: Array<{ name: string }> }>, () => null);
  if (!tags) return 'Ollama is not answering on localhost:11434; start it and load Glimmer first';
  return tags.models?.some((m) => m.name === GLIMMER.slice('ollama/'.length)) ? null : `Ollama has no ${GLIMMER.slice('ollama/'.length)}; pull it and load it first`;
}

// ---------------------------------------------------------------------------------------------------------------

const USAGE = `bun scripts/scorecard.ts [options]
bun scripts/scorecard.ts --render [--out <dir>]

  --dry                  the flows fakes instead of the Stint agent and Glimmer; nothing is live
  --k <n>                attempts per seeded task (default 3)
  --budget-usd <usd>     stop before an attempt when the spend recorded under --out, plus the largest attempt
                         so far (before the first, the largest run in the published relays), would pass this
  --work <dir>           where the fresh clones go (default: $STINT_RELAY_WORK, else the system temp folder)
  --relay <dir>          the seeded data and the published relays (default: bench/relay)
  --out <dir>            where scorecard.json and scorecard/<task>-a<n>/ go (default: bench, or
                         <work>/scorecard-dry for a dry run); an attempt recorded there is never run again
  --render               print the markdown table for docs/proofs.md from <out>/scorecard.json
`;

function options(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dry: { type: 'boolean' },
      k: { type: 'string' },
      'budget-usd': { type: 'string' },
      work: { type: 'string' },
      relay: { type: 'string' },
      out: { type: 'string' },
      render: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length) fail(USAGE);
  const num = (raw: string | undefined, name: string, min: number): number | null => {
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fail(`--${name} must be a number of at least ${min}, not ${raw}`);
  };
  const k = num(values.k, 'k', 1) ?? 3;
  if (!Number.isInteger(k)) fail(`--k must be a whole number, not ${values.k}`);
  const work = resolve(values.work ?? process.env.STINT_RELAY_WORK ?? join(tmpdir(), 'stint-relay'));
  const dry = !!values.dry;
  return { dry, k, relay: resolve(values.relay ?? join(ROOT, 'bench', 'relay')), out: resolve(values.out ?? (dry ? join(work, 'scorecard-dry') : join(ROOT, 'bench'))), work, budgetUsd: num(values['budget-usd'], 'budget-usd', 0), render: !!values.render };
}

if (import.meta.main) {
  try {
    const opts = options(process.argv.slice(2));
    if (opts.render) {
      process.stdout.write(renderScorecard(ScorecardSchema.parse(JSON.parse(readFileSync(join(opts.out, 'scorecard.json'), 'utf8')))));
      process.exit(0);
    }
    if (!opts.dry) {
      const problem = await liveProblem();
      if (problem) fail(problem);
      keepAwake();
    }
    const { card, ran, stopped, failed } = await runScorecard(opts);
    const file = join(opts.out, 'scorecard.json');
    const where = relative(process.cwd(), file).startsWith('..') ? file : relative(process.cwd(), file);
    process.stdout.write(`${stopped ? `${stopped}\n` : ''}ran ${ran} attempts; ${card.attempts.length} recorded, spend $${card.spend.usd.toFixed(4)}${card.spend.estimated ? ' (part unpriced)' : ''}; wrote ${where}\n`);
    process.exit(failed ? 1 : 0);
  } catch (err) {
    process.stderr.write(`scorecard: ${message(err)}\n`);
    process.exit(2);
  }
}
