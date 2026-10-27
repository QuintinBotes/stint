import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { keepAwake } from './awake';
import { runBenchLive } from './bench/live';
import { BENCH_LEGS, BENCH_MODES, type BenchLeg, type BenchMode, formatSummary, loadBenchTasks, loadReplayResults, writeBenchOutputs } from './bench/results';
import { repoRoot } from './repo';

function positiveInt(raw: string, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`--${name} must be a positive whole number, not ${raw}\n`);
    process.exit(2);
  }
  return n;
}

function parseModes(raw: string): BenchMode[] {
  const modes = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (!modes.length || modes.some((m) => !BENCH_MODES.includes(m as BenchMode))) {
    process.stderr.write(`--modes must be a comma list from transcript,packet, not ${raw}\n`);
    process.exit(2);
  }
  return BENCH_MODES.filter((m) => modes.includes(m));
}

function parseLegs(raw: string): BenchLeg[] {
  const legs = raw
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!legs.length || legs.some((l) => !BENCH_LEGS.includes(l as BenchLeg))) {
    process.stderr.write(`--legs must be a comma list from plan,build,review,learn, not ${raw}\n`);
    process.exit(2);
  }
  return BENCH_LEGS.filter((l) => legs.includes(l));
}

export const bench = defineCommand({
  meta: { name: 'bench', description: 'Measure the packet: continue capped runs from the transcript or from the packet plus the diff' },
  args: {
    tasks: { type: 'string', description: 'How many bench tasks to run (default: all)' },
    modes: { type: 'string', description: 'Comma list: transcript,packet', default: 'transcript,packet' },
    legs: { type: 'string', description: 'Comma list: plan,build,review,learn', default: 'build' },
    host: { type: 'string', description: 'Run the continuing leg on this host (a host id from config)' },
    implementer: { type: 'string', description: 'Adapter for the capped first run', default: 'muse-code' },
    continuer: { type: 'string', description: 'Adapter that continues the capped run', default: 'stint-agent' },
    repeat: { type: 'string', description: 'Repeats per task and mode', default: '1' },
    concurrency: { type: 'string', description: 'Bench runs at once', default: '2' },
    'no-digest': { type: 'boolean', description: 'Build packets without the diff digest that stint up adds' },
    replay: { type: 'boolean', description: 'Rebuild results from recorded runs; no model call' },
    from: { type: 'string', description: 'Recorded runs directory for --replay (default: bench/runs)' },
    out: { type: 'string', description: 'Where results and runs go (default: bench/ in the repository)' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Print the results object' },
  },
  async run({ args }) {
    const out = (s: string) => process.stdout.write(`${s}\n`);
    try {
      const root = repoRoot(args.repo);
      const outDir = args.out ? resolve(args.out) : join(root, 'bench');
      const modes = parseModes(args.modes);
      const legs = parseLegs(args.legs);
      const taskCount = args.tasks !== undefined ? positiveInt(args.tasks, 'tasks') : undefined;
      if (!args.replay) keepAwake();
      const results = args.replay
        ? await loadReplayResults(args.from ? resolve(args.from) : join(outDir, 'runs'), { ...(taskCount ? { tasks: taskCount } : {}), modes, legs, ...(args.host ? { host: args.host } : {}) })
        : await runBenchLive({
            tasks: (await loadBenchTasks(join(root, 'bench', 'tasks.json'))).slice(0, taskCount),
            modes,
            legs,
            ...(args.host ? { host: args.host } : {}),
            implementer: args.implementer,
            continuer: args.continuer,
            repeat: positiveInt(args.repeat, 'repeat'),
            concurrency: positiveInt(args.concurrency, 'concurrency'),
            outDir,
            digest: !args['no-digest'],
            log: (line) => process.stderr.write(`${line}\n`),
          });
      await writeBenchOutputs(outDir, results);
      if (args.json) {
        out(JSON.stringify(results));
        return;
      }
      for (const line of formatSummary(results)) out(line);
      out(`Wrote ${join(outDir, 'results.json')}, results.svg and results-light.svg`);
    } catch (err) {
      process.stderr.write(`bench failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  },
});
