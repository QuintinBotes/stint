import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { countTokens } from '@stint-dev/core';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
import { type Adapter, assign, createApp, daemonContext, defaultAdapters } from '@stint-dev/daemon';
import { freshFixture } from '../demo';
import { type BenchMode, type BenchResults, type BenchRowFile, type BenchTaskDef, buildResults, taskKey } from './results';
import { renderTranscript } from './transcript';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Artefacts are published: the fixture's temporary folder and the home directory become placeholders. */
export function scrubPaths(text: string): string {
  return text
    .replace(/(\/private)?\/var\/folders\/[^/\s"']+\/[^/\s"']+\/T\/stint-[a-z]+-[A-Za-z0-9]+/g, '<fixture>')
    .replace(new RegExp(`${escape(tmpdir())}/stint-[a-z]+-[A-Za-z0-9]+`, 'g'), '<fixture>')
    .replace(new RegExp(escape(homedir()), 'g'), '~')
    // a path a tool output cut short still names the machine's temp folder
    .replace(/(\/private)?\/var\/folders\/[^\s"'\\]*/g, '<tmp>')
    .replace(/\/private\/var\/[^\s"'\\]*/g, '<tmp>');
}

export type LiveBenchOptions = {
  tasks: BenchTaskDef[];
  modes: BenchMode[];
  implementer: string;
  continuer: string;
  repeat: number;
  concurrency: number;
  /** Holds results and runs/; the command defaults it to bench/ in the repository. */
  outDir: string;
  /** Marks rows synthetic; set only for fixture artefacts made with fake adapters. */
  synthetic?: boolean;
  /** Build packets as `stint up` does, with a digest of the diff for a run that cannot be asked. */
  digest?: boolean;
  /** Fresh adapters per bench run; the live command leaves this out and uses the daemon defaults. */
  adapters?: () => Adapter[];
  makeFixture?: () => string;
  log?: (line: string) => void;
};

type Unit = { def: BenchTaskDef; task: string; mode: BenchMode; repeat: number; taskAt: number; modeAt: number };

const asString = (v: unknown): string => (typeof v === 'string' && v ? v : 'unknown');

/** One task in one mode, from a fresh fixture copy: capped first run, then the continuer. Artefacts are kept. */
async function runUnit(opts: LiveBenchOptions, unit: Unit): Promise<BenchRowFile> {
  const fixture = (opts.makeFixture ?? freshFixture)();
  const label = `${unit.task} ${unit.mode}${opts.repeat > 1 ? ` repeat ${unit.repeat}` : ''}`;
  try {
    const ws = await Workspace.open(fixture);
    const app = createApp(ws, opts.adapters ? opts.adapters() : defaultAdapters(ws.config), {
      token: randomBytes(16).toString('hex'),
      quiet: true,
      webDist: null,
      snapshotMs: 1000,
      digest: opts.digest ?? false,
    });
    const ctx = daemonContext(app);
    const task = await ws.createTask({
      title: unit.def.title,
      goal: unit.def.goal,
      acceptance: unit.def.acceptance,
      testCommand: unit.def.testCommand,
      // The bench measures the continuation, not budget enforcement; the first run spends the same role budget.
      budgets: { implementer: 2_000_000 },
    });
    opts.log?.(`${label}: first run capped at ${unit.def.killAfterSteps} steps`);
    const first = await assign(ctx, task.id, { adapter: opts.implementer, role: 'implementer', steps: unit.def.killAfterSteps });
    await first.done;
    const packetName = (await ws.handoffs(task.id).names()).at(-1);
    const packet = packetName ? await ws.handoffs(task.id).read(packetName) : null;
    if (!packetName || !packet) throw new Error(`${label}: the first run built no packet`);
    const transcriptPath = await ws.runs(task.id).transcriptPath(first.run);
    const transcriptLines = existsSync(transcriptPath) ? (await readFile(transcriptPath, 'utf8')).split('\n').filter((l) => l.trim()) : [];
    opts.log?.(`${label}: continuing from the ${unit.mode}`);
    const second = await assign(
      ctx,
      task.id,
      unit.mode === 'packet'
        ? { adapter: opts.continuer, role: 'implementer', handoffFrom: packetName }
        : { adapter: opts.continuer, role: 'implementer', resume: { kind: 'transcript', text: renderTranscript(transcriptLines) } },
    );
    await second.done;

    const events = await ws.events(task.id).read();
    const runs = runsFromEvents(events);
    const cont = runs.find((r) => r.run === second.run);
    const firstRun = runs.find((r) => r.run === first.run);
    const finished = events.find((e) => e.type === 'run.finished' && e.run === second.run);
    const firstFinished = events.find((e) => e.type === 'run.finished' && e.run === first.run);
    const verification = await ws.verification(task.id).read(second.run);
    const prompt = (await ws.runs(task.id).readPrompt(second.run)) ?? '';
    const wallMs =
      cont?.startedAt && cont.endedAt ? Math.max(0, Date.parse(cont.endedAt) - Date.parse(cont.startedAt)) : 0;
    const row: BenchRowFile = {
      task: unit.task,
      mode: unit.mode,
      host: asString(finished?.payload.host ?? cont?.host),
      model: asString(finished?.payload.model ?? cont?.model),
      inputTokens: cont?.cost?.inputTokens ?? 0,
      cachedTokens: cont?.cost?.cachedTokens ?? 0,
      outputTokens: cont?.cost?.outputTokens ?? 0,
      usd: cont?.cost?.usd ?? null,
      wallMs,
      verified: verification?.status === 'green',
      promptTokens: countTokens(prompt),
      repeat: unit.repeat,
      ...(opts.synthetic ? { synthetic: true as const } : {}),
      commit: task.baseCommit,
      implementer: opts.implementer,
      continuer: opts.continuer,
      implementerModel: asString(firstFinished?.payload.model ?? firstRun?.model),
      ...(cont?.startedAt ? { startedAt: cont.startedAt } : {}),
      ...(cont?.endedAt ? { finishedAt: cont.endedAt } : {}),
    };
    const dirName = opts.repeat > 1 ? `${unit.task}-${unit.mode}-r${unit.repeat}` : `${unit.task}-${unit.mode}`;
    const dir = join(opts.outDir, 'runs', dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'transcript.jsonl'), scrubPaths(transcriptLines.length ? `${transcriptLines.join('\n')}\n` : ''));
    await writeFile(join(dir, 'handoff.json'), scrubPaths(`${JSON.stringify(packet, null, 2)}\n`));
    await writeFile(join(dir, 'prompt.md'), scrubPaths(prompt));
    await writeFile(join(dir, 'row.json'), `${JSON.stringify(row, null, 2)}\n`);
    opts.log?.(`${label}: input ${row.inputTokens} tokens, prompt ${row.promptTokens} tokens, verified ${row.verified}`);
    return row;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/** The live bench: every task in every mode, bounded by concurrency. Returns the results; the caller writes them. */
export async function runBenchLive(opts: LiveBenchOptions): Promise<BenchResults> {
  const startedAt = new Date().toISOString();
  const units: Unit[] = [];
  opts.tasks.forEach((def, taskAt) => {
    opts.modes.forEach((mode, modeAt) => {
      for (let r = 1; r <= opts.repeat; r++) units.push({ def, task: taskKey(def), mode, repeat: r, taskAt, modeAt });
    });
  });
  const rows: BenchRowFile[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, units.length)) }, async () => {
    while (next < units.length) {
      const unit = units[next++] as Unit;
      rows.push(await runUnit(opts, unit));
    }
  });
  await Promise.all(workers);
  rows.sort((a, b) => {
    const ua = units.findIndex((u) => u.task === a.task && u.mode === a.mode && u.repeat === a.repeat);
    const ub = units.findIndex((u) => u.task === b.task && u.mode === b.mode && u.repeat === b.repeat);
    return ua - ub;
  });
  return buildResults({
    rows,
    replay: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    implementer: opts.implementer,
    continuer: opts.continuer,
  });
}
