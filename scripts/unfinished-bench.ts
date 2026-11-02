#!/usr/bin/env bun
// The unfinished hand-off bench (bench/fair-unfinished): the fair bench again, with each task's first run capped low
// enough that its checkpoint fails the held-out tests, and a fourth arm: Muse Code resuming its own session.
//   checkpoint --task <id> --cap <n>   one capped Muse Code first run, kept in --state and graded with no model call
//   continue --budget-usd <usd>        from each task's last unfinished checkpoint: every arm, --repeat times
//   account                            spend, results and charts again from runs/ and --state, with no model call
// Live phases need STINT_LIVE=1. Spend is Stint's own records: every checkpoint tried plus every continued run.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keepAwake } from '../packages/cli/src/awake';
import { type Checkpoint, type LiveBenchOptions, type Unit, continueFrom, makeCheckpoint, slots } from '../packages/cli/src/bench/live';
import { hostBuckets } from '../packages/cli/src/bench/limits';
import { type BenchMode, type BenchRowFile, buildResults, loadBenchTasks, taskKey, writeBenchOutputs } from '../packages/cli/src/bench/results';
import { loadScenarios, publishRuns, taskSpend } from './fair-bench';
import { scrubber } from './seeded-run';

const scrub = scrubber([]);
const ROOT = resolve(import.meta.dir, '..');
const MODES: BenchMode[] = ['packet', 'transcript', 'diff', 'resume'];
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
// before a task has run: the dearest continued run of the fair rerun (bench-01, diff, $0.1637) for each Stint agent
// run, and twice that for each resumed Muse Code run, whose replayed session is the larger prompt; after one has
// run, the dearest task so far and a quarter more
const FIRST_GUESS = (repeat: number) => repeat * (3 * 0.1637 + 2 * 0.1637);
const nextGuess = (repeat: number, totals: number[]) => (totals.length ? r4(Math.max(...totals) * 1.25) : FIRST_GUESS(repeat));
const CHECKPOINT_GUESS = 0.15;

export type Attempt = {
  task: string;
  cap: number;
  file: string;
  createdAt: string;
  endedBy: string;
  firstRunUsd: number;
  sessionId: string | null;
  sessionKept: boolean;
  changedFiles: string[];
  ownTests: string;
  heldOut: { passed: number; failed: number; line: string };
  unfinished: boolean;
};

/** The vitest summary line's counts, or zeros when no test ran (a held-out file that cannot even load). */
export function testsLine(output: string): { passed: number; failed: number; line: string } {
  const line = output.split('\n').find((l) => /^\s*Tests\s/.test(l))?.trim() ?? '';
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  return { passed: n('passed'), failed: n('failed'), line: line || output.trim().split('\n').slice(-3).join(' ').slice(0, 200) };
}

/**
 * A checkpoint graded alone, with no model call, as the fair rerun's baseline script does: the first run's diff on a
 * fresh clone of the fixture, the repository's tests, then the task's held-out tests. Unfinished when any held-out
 * test fails or none ran.
 */
export function gradeCheckpoint(diff: string, heldOut: Array<{ name: string; content: string }>): Pick<Attempt, 'ownTests' | 'heldOut' | 'unfinished'> {
  const dir = mkdtempSync(join(tmpdir(), 'stint-grade-'));
  const run = (cmd: string[]) => {
    const p = Bun.spawnSync(cmd, { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    return { code: p.exitCode, out: `${p.stdout.toString()}\n${p.stderr.toString()}` };
  };
  try {
    if (run(['git', 'clone', '-q', join(ROOT, 'demo', 'repo.bundle'), '.']).code !== 0) throw new Error('cannot clone demo/repo.bundle');
    if (diff.trim()) {
      writeFileSync(join(dir, '.checkpoint.patch'), diff);
      const applied = run(['git', 'apply', '.checkpoint.patch']);
      if (applied.code !== 0) throw new Error(`the checkpoint diff did not apply: ${applied.out.trim().slice(0, 200)}`);
      rmSync(join(dir, '.checkpoint.patch'));
    }
    if (run(['bun', 'install', '--frozen-lockfile']).code !== 0) throw new Error('bun install failed on the checkpoint');
    const own = testsLine(run(['bun', 'run', 'test']).out);
    for (const s of heldOut) {
      mkdirSync(join(dir, s.name, '..'), { recursive: true });
      writeFileSync(join(dir, s.name), s.content);
    }
    const held = testsLine(run(['bun', 'run', 'test', ...heldOut.map((s) => s.name)]).out);
    return { ownTests: own.line, heldOut: held, unfinished: held.failed > 0 || held.passed === 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first run's spend, from the checkpoint's own log: its run.finished and any cost.recorded beside it. */
function checkpointUsd(cp: Checkpoint): number {
  const tasks = join(cp.fixture, '.stint', 'tasks');
  const dir = readdirSync(tasks).find((d) => d.startsWith(`${cp.id}-`) || d === cp.id) ?? '';
  const lines = readFileSync(join(tasks, dir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  let usd = 0;
  for (const l of lines) {
    const e = JSON.parse(l) as { type: string; payload: { cost?: { usd?: number | null } } };
    if (e.type === 'run.finished' || e.type === 'cost.recorded') usd += e.payload.cost?.usd ?? 0;
  }
  return r4(usd);
}

const readAttempts = (state: string): Attempt[] => (existsSync(join(state, 'attempts.json')) ? (JSON.parse(readFileSync(join(state, 'attempts.json'), 'utf8')) as Attempt[]) : []);

function rowsIn(runsDir: string): BenchRowFile[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .sort()
    .filter((d) => existsSync(join(runsDir, d, 'row.json')))
    .map((d) => JSON.parse(readFileSync(join(runsDir, d, 'row.json'), 'utf8')) as BenchRowFile);
}

/** Every dollar by Stint's records: each checkpoint tried, and each continued run in runs/ (its first run counted once, above). */
function spendOf(out: string, attempts: Attempt[], priorUsd: number) {
  const runsDir = join(out, 'runs');
  const tasks = [...new Set(rowsIn(runsDir).map((r) => r.task))].map((task) => {
    const { continuedUsd, unpriced } = taskSpend(runsDir, task);
    return { task, continuedUsd, unpriced };
  });
  const checkpointsUsd = r4(attempts.reduce((s, a) => s + a.firstRunUsd, 0));
  const continuedUsd = r4(tasks.reduce((s, t) => s + t.continuedUsd, 0));
  return { priorUsd, checkpointsUsd, continuedUsd, totalUsd: r4(priorUsd + checkpointsUsd + continuedUsd), tasks };
}

/** Writes checkpoints.json, spend.json, results.json and the charts, after the published scrub and re-hash of runs/. */
async function account(out: string, state: string, extra: { budgetUsd: number | null; priorUsd: number; stopped: string | null; startedAt?: string; finishedAt?: string }) {
  const runsDir = join(out, 'runs');
  publishRuns(runsDir);
  const attempts = readAttempts(state);
  const rows = rowsIn(runsDir);
  const times = rows.flatMap((r) => [r.startedAt, r.finishedAt]).filter((t): t is string => !!t).sort();
  const started = extra.startedAt ?? times[0];
  const finished = extra.finishedAt ?? times.at(-1);
  await writeBenchOutputs(out, buildResults({ rows, replay: false, ...(started ? { startedAt: started } : {}), ...(finished ? { finishedAt: finished } : {}), implementer: 'muse-code', continuer: 'stint-agent' }));
  const used = new Set(rows.map((r) => r.task));
  const checkpoints = attempts.map((attempt) => {
    const { file: _file, ...a } = attempt;
    return { ...a, continued: used.has(a.task) && attempt === attempts.filter((b) => b.task === a.task && b.unfinished).at(-1) };
  });
  writeFileSync(join(out, 'checkpoints.json'), scrub(`${JSON.stringify(checkpoints, null, 2)}\n`));
  const spend = spendOf(out, attempts, extra.priorUsd);
  writeFileSync(join(out, 'spend.json'), scrub(`${JSON.stringify({ budgetUsd: extra.budgetUsd, ...spend, stopped: extra.stopped }, null, 2)}\n`));
  return spend;
}

const liveOpts = (out: string, repeat: number, concurrency: number, scenarios: LiveBenchOptions['scenarios']): Omit<LiveBenchOptions, 'tasks'> => ({
  modes: MODES,
  host: 'meta-api',
  implementer: 'muse-code',
  continuer: 'stint-agent',
  repeat,
  concurrency,
  outDir: out,
  digest: true,
  ...(scenarios ? { scenarios } : {}),
  log: (line) => process.stdout.write(`  ${line}\n`),
});

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      task: { type: 'string' },
      cap: { type: 'string' },
      'budget-usd': { type: 'string' },
      'prior-usd': { type: 'string' },
      repeat: { type: 'string' },
      concurrency: { type: 'string' },
      out: { type: 'string' },
      state: { type: 'string' },
    },
  });
  const phase = positionals[0];
  const out = resolve(values.out ?? join(ROOT, 'bench', 'fair-unfinished'));
  const state = resolve(values.state ?? join(tmpdir(), 'stint-unfinished'));
  const prior = Number(values['prior-usd'] ?? 0);
  const repeat = Number(values.repeat ?? 2);
  const budget = values['budget-usd'] ? Number(values['budget-usd']) : null;
  mkdirSync(state, { recursive: true });
  const defs = await loadBenchTasks(join(ROOT, 'bench', 'tasks.json'));
  const scenarios = loadScenarios(join(ROOT, 'bench', 'fair', 'scenarios'));

  if (phase === 'account') {
    const prev = existsSync(join(out, 'spend.json')) ? (JSON.parse(readFileSync(join(out, 'spend.json'), 'utf8')) as { budgetUsd: number | null; stopped: string | null }) : null;
    const spend = await account(out, state, { budgetUsd: prev?.budgetUsd ?? budget, priorUsd: prior, stopped: prev?.stopped ?? null });
    process.stdout.write(`spend $${spend.totalUsd.toFixed(4)}\n`);
    process.exit(0);
  }
  if (phase !== 'checkpoint' && phase !== 'continue') {
    process.stderr.write('usage: unfinished-bench.ts checkpoint --task <id> --cap <n> | continue --budget-usd <usd> | account\n');
    process.exit(2);
  }
  if (process.env.STINT_LIVE !== '1') {
    process.stderr.write('unfinished-bench runs Muse Code and the Stint agent live; set STINT_LIVE=1 to run it\n');
    process.exit(2);
  }
  if (budget === null || !Number.isFinite(budget) || budget <= 0) {
    process.stderr.write('--budget-usd is required: the most the whole experiment may spend, with --prior-usd counted against it\n');
    process.exit(2);
  }
  keepAwake();
  const buckets = hostBuckets();

  if (phase === 'checkpoint') {
    const def = defs.find((d) => taskKey(d) === values.task);
    const cap = Number(values.cap);
    if (!def || !Number.isInteger(cap) || cap < 1) {
      process.stderr.write('checkpoint needs --task <an id in bench/tasks.json> and --cap <steps>\n');
      process.exit(2);
    }
    const attempts = readAttempts(state);
    const spent = spendOf(out, attempts, prior).totalUsd;
    if (spent + CHECKPOINT_GUESS > budget) {
      process.stderr.write(`stopped: $${spent.toFixed(4)} spent plus up to $${CHECKPOINT_GUESS} for a checkpoint would pass the $${budget} budget\n`);
      process.exit(3);
    }
    const key = taskKey(def);
    const capped = { ...def, killAfterSteps: cap };
    process.stdout.write(`${key}: first run capped at ${cap} steps; $${spent.toFixed(4)} spent so far\n`);
    const made = await makeCheckpoint({ ...liveOpts(out, repeat, 1, undefined), tasks: [capped] }, capped, buckets);
    const cp = made.checkpoint as Checkpoint;
    const file = join(state, `${key}-cap${cap}-${attempts.filter((a) => a.task === key).length + 1}.json`);
    writeFileSync(file, JSON.stringify(cp));
    const grade = gradeCheckpoint(cp.diff, scenarios[key] ?? []);
    const attempt: Attempt = {
      task: key,
      cap,
      file,
      createdAt: cp.packet.createdAt,
      endedBy: cp.packet.from.endedBy,
      firstRunUsd: checkpointUsd(cp),
      sessionId: cp.packet.from.sessionId ?? null,
      sessionKept: !!cp.session,
      changedFiles: cp.packet.changedFiles.map((f) => f.path),
      ...grade,
    };
    writeFileSync(join(state, 'attempts.json'), `${JSON.stringify([...attempts, attempt], null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ...attempt, file: undefined }, null, 2)}\n`);
    process.exit(0);
  }

  // continue: one task at a time, each from its last unfinished checkpoint, while the budget holds
  const startedAt = new Date().toISOString();
  const attempts = readAttempts(state);
  const runsDir = join(out, 'runs');
  let stopped: string | null = null;
  // the dearest task so far counts tasks continued by an earlier call too, so a resumed experiment keeps the same rule
  const totals: number[] = spendOf(out, attempts, prior).tasks.map((t) => t.continuedUsd);
  for (const def of defs) {
    const key = taskKey(def);
    const chosen = attempts.filter((a) => a.task === key && a.unfinished).at(-1);
    if (!chosen) {
      process.stdout.write(`${key}: no unfinished checkpoint, not continued\n`);
      continue;
    }
    if (rowsIn(runsDir).some((r) => r.task === key)) {
      process.stdout.write(`${key}: already continued, not run again\n`);
      continue;
    }
    const spent = spendOf(out, attempts, prior).totalUsd;
    const next = nextGuess(repeat, totals);
    if (spent + next > budget) {
      stopped = `stopped before ${key}: $${spent.toFixed(4)} spent plus up to $${next.toFixed(4)} for the next task would pass the $${budget} budget`;
      process.stdout.write(`${stopped}\n`);
      break;
    }
    process.stdout.write(`${key}: from the cap ${chosen.cap} checkpoint; $${spent.toFixed(4)} spent so far, up to $${next.toFixed(4)} for this task\n`);
    const cp = JSON.parse(readFileSync(chosen.file, 'utf8')) as Checkpoint;
    const opts: LiveBenchOptions = { ...liveOpts(out, repeat, Number(values.concurrency ?? 3), scenarios), tasks: [def] };
    const units: Unit[] = MODES.flatMap((mode) => Array.from({ length: repeat }, (_, i) => ({ def, task: key, mode, repeat: i + 1 })));
    const slot = slots(opts.concurrency);
    // every run that starts is reported: a failed unit keeps its error beside the rows of the others
    const settled = await Promise.allSettled(units.map((u) => slot(() => continueFrom(opts, cp, u, buckets))));
    settled.forEach((s, i) => {
      if (s.status === 'rejected') process.stdout.write(`  ${key} ${units[i]?.mode} r${units[i]?.repeat} failed: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}\n`);
    });
    rmSync(cp.fixture, { recursive: true, force: true });
    if (cp.session) rmSync(cp.session.snapshot, { recursive: true, force: true });
    const s = taskSpend(runsDir, key);
    totals.push(r4(s.continuedUsd));
    process.stdout.write(`  ${key}: $${s.continuedUsd.toFixed(4)} for the continued runs\n`);
  }
  const spend = await account(out, state, { budgetUsd: budget, priorUsd: prior, stopped, startedAt, finishedAt: new Date().toISOString() });
  process.stdout.write(`spend $${spend.totalUsd.toFixed(4)}${stopped ? `; ${stopped}` : ''}\n`);
}
