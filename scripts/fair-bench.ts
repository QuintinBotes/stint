#!/usr/bin/env bun
// The fair hand-off bench (bench/fair): the bench's five tasks, one capped Muse Code first run per task, and from
// that one checkpoint the Stint agent on Muse Spark 1.3 (Meta Model API only) continues from the packet, from the
// transcript, or from the task and the first run's diff. Held-out tests in bench/fair/scenarios grade every
// continued run. One task at a time, so the spend is checked before each: a task starts only when the spend so far
// plus the largest a task can be expected to cost fits the budget.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keepAwake } from '../packages/cli/src/awake';
import { hashHandoff } from '../packages/core/src/node';
import { runBenchLive } from '../packages/cli/src/bench/live';
import { type BenchMode, type BenchRowFile, buildResults, heldOut, loadBenchTasks, taskKey, writeBenchOutputs } from '../packages/cli/src/bench/results';
import { rechain, scrubber } from './seeded-run';

// the published-record scrub the scorecard uses: local paths, the user name, keys, emails and dashes
const scrub = scrubber([]);

const ROOT = resolve(import.meta.dir, '..');
const MODES: BenchMode[] = ['packet', 'transcript', 'diff'];
// before any task has run: the dearest first run and the dearest continued run of the 27 October bench, per arm and repeat
const FIRST_GUESS = (repeat: number) => 0.1421 + MODES.length * repeat * 0.1428;

/** bench/fair/scenarios/<task>/<path>.txt, stored for the daemon as <path>. */
export function loadScenarios(dir: string): Record<string, Array<{ name: string; content: string }>> {
  const out: Record<string, Array<{ name: string; content: string }>> = {};
  if (!existsSync(dir)) return out;
  for (const task of readdirSync(dir).sort()) {
    const walk = (at: string): string[] =>
      readdirSync(at, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(at, e.name)) : e.name.endsWith('.txt') ? [join(at, e.name)] : []));
    out[task] = walk(join(dir, task)).map((file) => ({ name: relative(join(dir, task), file).replace(/\.txt$/, ''), content: readFileSync(file, 'utf8') }));
  }
  return out;
}

/**
 * Stint's own cost records for one task: every run.finished and cost.recorded (a digest's model call) in the
 * continued runs' logs, each counted once by event id. The first run's events are in every copy's log, so what
 * every log shares is the first run's spend and what one log alone has is that continued run's.
 */
export function taskSpend(runsDir: string, task: string): { firstRunUsd: number; continuedUsd: number; unpriced: string[] } {
  const dirs = existsSync(runsDir) ? readdirSync(runsDir).filter((d) => d.startsWith(`${task}-`) && existsSync(join(runsDir, d, 'events.jsonl'))) : [];
  const seen = new Map<string, { usd: number | null; label: string; run?: string; n: number }>();
  for (const d of dirs.sort()) {
    for (const line of readFileSync(join(runsDir, d, 'events.jsonl'), 'utf8').split('\n')) {
      if (!line.includes('"run.finished"') && !line.includes('"cost.recorded"')) continue;
      const e = JSON.parse(line) as { id: string; type: string; run?: string; payload: { cost?: { usd?: number | null } } };
      if (e.type !== 'run.finished' && e.type !== 'cost.recorded') continue;
      const known = seen.get(e.id);
      if (known) known.n += 1;
      else seen.set(e.id, { usd: e.payload.cost?.usd ?? null, label: `${d} ${e.type}${e.run ? ` ${e.run}` : ''}`, ...(e.run ? { run: e.run } : {}), n: 1 });
    }
  }
  let first = 0;
  let continued = 0;
  const unpriced: string[] = [];
  for (const c of seen.values()) {
    if (c.usd === null) unpriced.push(c.label);
    if (c.run === 'r1' || (dirs.length > 1 && c.n === dirs.length)) first += c.usd ?? 0;
    else continued += c.usd ?? 0;
  }
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  return { firstRunUsd: r4(first), continuedUsd: r4(continued), unpriced };
}

/**
 * The bench already took local paths out as it wrote; this takes out emails and dashes too, as the scorecard's
 * publishing does, then hashes each event log's chain and each packet again over the scrubbed text, and grades
 * each row's held-out tests from their counts.
 */
export function publishRuns(runsDir: string): void {
  if (!existsSync(runsDir)) return;
  for (const d of readdirSync(runsDir)) {
    for (const f of readdirSync(join(runsDir, d))) {
      const file = join(runsDir, d, f);
      let text = scrub(readFileSync(file, 'utf8'));
      if (f === 'events.jsonl') text = rechain(text);
      else if (f === 'row.json') {
        // a row recorded before the held-out grade came from the held-out counts alone is graded again from them
        const row = JSON.parse(text) as BenchRowFile;
        if (row.hidden !== undefined) text = `${JSON.stringify({ ...row, ...heldOut(row.verified, row.scenarios ?? null) }, null, 2)}\n`;
      } else if (f.startsWith('handoff') && f.endsWith('.json')) {
        const packet = JSON.parse(text) as Record<string, unknown>;
        if (packet.version === 'stint.handoff/1') text = `${JSON.stringify({ ...packet, hash: hashHandoff(packet as never) }, null, 2)}\n`;
      }
      writeFileSync(file, text);
    }
  }
}

function rowsIn(runsDir: string): BenchRowFile[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .sort()
    .flatMap((d) => (existsSync(join(runsDir, d, 'row.json')) ? [JSON.parse(readFileSync(join(runsDir, d, 'row.json'), 'utf8')) as BenchRowFile] : []));
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { 'budget-usd': { type: 'string' }, 'prior-usd': { type: 'string' }, repeat: { type: 'string' }, concurrency: { type: 'string' }, out: { type: 'string' }, 'account-only': { type: 'boolean' } },
  });
  if (values['account-only']) {
    // the spend, results and published files again from the recorded runs, with no model call
    const out = resolve(values.out ?? join(ROOT, 'bench', 'fair'));
    const runsDir = join(out, 'runs');
    const before = existsSync(join(out, 'spend.json')) ? (JSON.parse(readFileSync(join(out, 'spend.json'), 'utf8')) as { budgetUsd: number; priorUsd: number; tasks: Array<{ task: string; error?: string }>; stopped: string | null }) : null;
    const rows = rowsIn(runsDir);
    const keys = [...new Set(rows.map((r) => r.task))];
    const tasks = keys.map((task) => {
      const s = taskSpend(runsDir, task);
      const error = before?.tasks.find((t) => t.task === task)?.error;
      return { task, ...s, totalUsd: Math.round((s.firstRunUsd + s.continuedUsd) * 10_000) / 10_000, ...(error ? { error } : {}) };
    });
    publishRuns(runsDir);
    const times = rows.flatMap((r) => [r.startedAt, r.finishedAt]).filter((t): t is string => !!t).sort();
    await writeBenchOutputs(out, buildResults({ rows: rowsIn(runsDir), replay: false, ...(times[0] ? { startedAt: times[0], finishedAt: times.at(-1) } : {}), implementer: 'muse-code', continuer: 'stint-agent' }));
    const totalUsd = Math.round(tasks.reduce((s, t) => s + t.totalUsd, 0) * 10_000) / 10_000;
    writeFileSync(join(out, 'spend.json'), scrub(`${JSON.stringify({ budgetUsd: before?.budgetUsd ?? null, priorUsd: before?.priorUsd ?? 0, totalUsd, tasks, stopped: before?.stopped ?? null }, null, 2)}\n`));
    process.stdout.write(`spend $${totalUsd.toFixed(4)}\n`);
    process.exit(0);
  }
  if (process.env.STINT_LIVE !== '1') {
    process.stderr.write('fair-bench runs Muse Code and the Stint agent live; set STINT_LIVE=1 to run it\n');
    process.exit(2);
  }
  const budget = Number(values['budget-usd'] ?? 'NaN');
  if (!Number.isFinite(budget) || budget <= 0) {
    process.stderr.write('--budget-usd is required: the most this run may spend, with --prior-usd counted against it\n');
    process.exit(2);
  }
  const prior = Number(values['prior-usd'] ?? 0);
  const repeat = Number(values.repeat ?? 2);
  const out = resolve(values.out ?? join(ROOT, 'bench', 'fair'));
  const runsDir = join(out, 'runs');
  const tasks = await loadBenchTasks(join(ROOT, 'bench', 'tasks.json'));
  const scenarios = loadScenarios(join(out, 'scenarios'));
  keepAwake();
  const startedAt = new Date().toISOString();
  const spend: Array<{ task: string; firstRunUsd: number; continuedUsd: number; totalUsd: number; unpriced: string[]; error?: string }> = [];
  let stopped: string | null = null;
  for (const def of tasks) {
    const key = taskKey(def);
    if (!scenarios[key]?.length) throw new Error(`no held-out tests for ${key} in ${join(out, 'scenarios')}`);
    const spent = prior + spend.reduce((s, t) => s + t.totalUsd, 0);
    const next = Math.max(FIRST_GUESS(repeat), ...spend.map((t) => t.totalUsd));
    if (spent + next > budget) {
      stopped = `stopped before ${key}: $${spent.toFixed(4)} spent plus up to $${next.toFixed(4)} for the next task would pass the $${budget} budget`;
      break;
    }
    process.stdout.write(`${key}: $${spent.toFixed(4)} spent so far, up to $${next.toFixed(4)} for this task\n`);
    let error: string | undefined;
    try {
      await runBenchLive({
        tasks: [def],
        modes: MODES,
        host: 'meta-api',
        implementer: 'muse-code',
        continuer: 'stint-agent',
        repeat,
        concurrency: Number(values.concurrency ?? 3),
        outDir: out,
        digest: true,
        scenarios,
        log: (line) => process.stdout.write(`  ${line}\n`),
      });
    } catch (err) {
      // every run started is reported: the rows already written stay, and the error is kept beside them
      error = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  ${key} failed: ${error}\n`);
    }
    const s = taskSpend(runsDir, key);
    spend.push({ task: key, ...s, totalUsd: Math.round((s.firstRunUsd + s.continuedUsd) * 10_000) / 10_000, ...(error ? { error } : {}) });
  }
  publishRuns(runsDir);
  const results = buildResults({ rows: rowsIn(runsDir), replay: false, startedAt, finishedAt: new Date().toISOString(), implementer: 'muse-code', continuer: 'stint-agent' });
  mkdirSync(out, { recursive: true });
  await writeBenchOutputs(out, results);
  const totalUsd = Math.round(spend.reduce((s, t) => s + t.totalUsd, 0) * 10_000) / 10_000;
  writeFileSync(join(out, 'spend.json'), scrub(`${JSON.stringify({ budgetUsd: budget, priorUsd: prior, totalUsd, tasks: spend, stopped }, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify(results.byMode, null, 2)}\nspend $${totalUsd.toFixed(4)}${stopped ? `; ${stopped}` : ''}\n`);
}
