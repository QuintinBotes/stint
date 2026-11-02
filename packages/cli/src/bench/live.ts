import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { type Handoff, countTokens, renderHandoff } from '@stint-dev/core';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
import { type Adapter, assign, createApp, daemonContext, defaultAdapters } from '@stint-dev/daemon';
import { freshFixture } from '../demo';
import { type BenchClock, type HostBuckets, hostBuckets } from './limits';
import { BENCH_LEGS, type BenchLeg, type BenchMode, type BenchResults, type BenchRowFile, type BenchTaskDef, buildResults, taskKey } from './results';
import { renderTranscript } from './transcript';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Values that must never be published: anything in the environment named like a key, token, secret or password. */
function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string);
}

/** Artefacts are published: the fixture's temporary folder, the home directory, the user name and any secret become placeholders. */
export function scrubPaths(text: string): string {
  const home = homedir();
  const user = userInfo().username;
  let out = text
    .replace(/(\/private)?\/var\/folders\/[^/\s"']+\/[^/\s"']+\/T\/stint-[a-z]+-[A-Za-z0-9]+/g, '<fixture>')
    .replace(new RegExp(`${escape(tmpdir())}/stint-[a-z]+-[A-Za-z0-9]+`, 'g'), '<fixture>')
    .replace(new RegExp(escape(home), 'g'), '~')
    // the same home path written JSON-escaped or URL-encoded
    .replace(new RegExp(escape(home.replaceAll('/', '\\/')), 'g'), '~')
    .replace(new RegExp(escape(encodeURIComponent(home)), 'gi'), '~')
    // a path a tool output cut short still names the machine's temp folder
    .replace(/(\/private)?\/var\/folders\/[^\s"'\\]*/g, '<tmp>')
    .replace(/\/private\/var\/[^\s"'\\]*/g, '<tmp>')
    .replace(/\b([A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/g, '$1=[redacted]');
  for (const v of secretValues()) out = out.split(v).join('[redacted]');
  // the bare user name, as `whoami` or `ls -l` print it
  if (user.length >= 3) out = out.replace(new RegExp(`\\b${escape(user)}\\b`, 'g'), 'user');
  return out;
}

export type LiveBenchOptions = {
  tasks: BenchTaskDef[];
  modes: BenchMode[];
  /** The legs to run and record (R-055); the build pipeline also runs when review or learn needs it. */
  legs?: BenchLeg[];
  /** Runs the continuing leg, and the plan and review legs, on this host's model (R-055). */
  host?: string;
  implementer: string;
  continuer: string;
  repeat: number;
  concurrency: number;
  /** The clock the hosts' token buckets wait on; tests pass a fake one. */
  clock?: BenchClock;
  /** Holds results and runs/; the command defaults it to bench/ in the repository. */
  outDir: string;
  /** Marks rows synthetic; set only for fixture artefacts made with fake adapters. */
  synthetic?: boolean;
  /** Build packets as `stint up` does, with a digest of the diff for a run that cannot be asked. */
  digest?: boolean;
  /**
   * Held-out tests by task key (R-037). They are stored only after the continued run (and its review) is over,
   * so no agent sees them, and the daemon then verifies the run again with them, as the scorecard does.
   */
  scenarios?: Record<string, Array<{ name: string; content: string }>>;
  /** Fresh adapters per bench run; the live command leaves this out and uses the daemon defaults. */
  adapters?: () => Adapter[];
  makeFixture?: () => string;
  log?: (line: string) => void;
};

type Unit = { def: BenchTaskDef; task: string; mode: BenchMode; repeat: number };

/** One task's capped first run, which every continued run of that task starts from, each in its own copy. */
type Checkpoint = {
  fixture: string;
  id: string;
  baseRow: Pick<BenchRowFile, 'task' | 'synthetic' | 'commit' | 'implementer' | 'continuer'>;
  taskText: string;
  packetName: string;
  packet: Handoff;
  transcriptLines: string[];
  diff: string;
  implementerModel: string;
};

const asString = (v: unknown): string => (typeof v === 'string' && v ? v : 'unknown');

const firstHost = (chain: string[] | undefined): string => chain?.[0]?.split('/')[0] ?? 'unknown';

/** The daemon error message of a failed in-process route call, in plain words for a leg row. */
function routeError(body: unknown, status: number): string {
  const err = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  return typeof err?.message === 'string' ? err.message : typeof err?.code === 'string' ? err.code : `HTTP ${status}`;
}

const runDir = (opts: LiveBenchOptions, task: string, mode: BenchMode, repeat: number) =>
  join(opts.outDir, 'runs', opts.repeat > 1 ? `${task}-${mode}-r${repeat}` : `${task}-${mode}`);

const wallOf = (run: { startedAt?: string | null; endedAt?: string | null } | undefined, fallback: number) =>
  run?.startedAt && run.endedAt ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)) : fallback;

/** An in-process daemon on one fixture folder, called through its routes as `stint up` would be. */
async function daemonOn(opts: LiveBenchOptions, folder: string, buckets: HostBuckets) {
  const ws = await Workspace.open(folder);
  const token = randomBytes(16).toString('hex');
  const app = createApp(ws, opts.adapters ? opts.adapters() : defaultAdapters(ws.config), {
    token,
    quiet: true,
    webDist: null,
    snapshotMs: 1000,
    digest: opts.digest ?? false,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // The host a leg will call first: the one named, or the first host of the role's chain.
  // Its token bucket holds the leg until the host can take it (R-055 requirement 5).
  const acquire = (chain: string[] | undefined, tokens: number) => {
    const host = opts.host ?? firstHost(chain);
    return buckets.acquire(host, ws.config.hosts[host], tokens);
  };
  const latestRoleRun = async (task: string, role: string) => runsFromEvents(await ws.events(task).read()).filter((r) => r.role === role).at(-1);
  return { ws, ctx: daemonContext(app), post, acquire, latestRoleRun };
}

async function writeRow(opts: LiveBenchOptions, dir: string, row: BenchRowFile, label: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, row.leg === 'build' || !row.leg ? 'row.json' : `row-${row.leg}.json`), `${JSON.stringify(row, null, 2)}\n`);
  opts.log?.(`${label} ${row.leg ?? 'build'} leg: input ${row.inputTokens} tokens, ${row.result ?? ''}`);
}

/**
 * One task's shared start, in a fresh fixture copy: the plan leg (once per task, recorded with the first mode),
 * then the first run capped at the task's step. Its worktree is removed afterwards, so the folder can be copied
 * once per continued run with nothing linking a copy to it. Null when only the plan leg was asked for.
 */
async function makeCheckpoint(opts: LiveBenchOptions, def: BenchTaskDef, buckets: HostBuckets): Promise<{ rows: BenchRowFile[]; checkpoint: Checkpoint | null }> {
  const fixture = (opts.makeFixture ?? freshFixture)();
  const key = taskKey(def);
  const legs = opts.legs ?? ['build'];
  const rows: BenchRowFile[] = [];
  try {
    const d = await daemonOn(opts, fixture, buckets);
    const task = await d.ws.createTask({
      title: def.title,
      goal: def.goal,
      acceptance: def.acceptance,
      testCommand: def.testCommand,
      // The bench measures the continuation, not budget enforcement; the first run spends the same role budget.
      budgets: { implementer: 2_000_000 },
    });
    const baseRow = {
      task: key,
      ...(opts.synthetic ? { synthetic: true as const } : {}),
      commit: task.baseCommit,
      implementer: opts.implementer,
      continuer: opts.continuer,
    };
    const taskText = `${def.title}\n${def.goal}\n${def.acceptance.join('\n')}`;

    if (legs.includes('plan')) {
      const mode = opts.modes[0] as BenchMode;
      opts.log?.(`${key}: planning on ${opts.host ?? firstHost(d.ws.config.routes.planner)}`);
      const started = Date.now();
      await d.acquire(d.ws.config.routes.planner, countTokens(taskText));
      const res = await d.post(`/api/tasks/${task.id}/plan`, opts.host ? { host: opts.host } : {});
      const body = (await res.json().catch(() => ({}))) as { steps?: unknown[] };
      const run = await d.latestRoleRun(task.id, 'planner').catch(() => undefined);
      const dir = runDir(opts, key, mode, 1);
      if (res.ok) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'plan.json'), scrubPaths(`${JSON.stringify(body, null, 2)}\n`));
      }
      const row: BenchRowFile = {
        ...baseRow,
        mode,
        repeat: 1,
        leg: 'plan',
        result: res.ok ? `planned: ${Array.isArray(body.steps) ? body.steps.length : 0} steps` : `not planned: ${routeError(body, res.status)}`,
        host: asString(run?.host ?? opts.host ?? firstHost(d.ws.config.routes.planner)),
        model: asString(run?.model),
        inputTokens: run?.cost?.inputTokens ?? 0,
        cachedTokens: run?.cost?.cachedTokens ?? 0,
        outputTokens: run?.cost?.outputTokens ?? 0,
        usd: run?.cost?.usd ?? null,
        wallMs: wallOf(run, Date.now() - started),
        verified: res.ok,
        promptTokens: 0,
        ...(run?.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run?.endedAt ? { finishedAt: run.endedAt } : {}),
      };
      rows.push(row);
      await writeRow(opts, dir, row, key);
    }

    // Review and learn stand on the build, so the build pipeline runs for them whether or not its row is kept.
    if (!legs.some((l) => l !== 'plan')) {
      rmSync(fixture, { recursive: true, force: true });
      return { rows, checkpoint: null };
    }
    opts.log?.(`${key}: first run capped at ${def.killAfterSteps} steps, shared by every mode`);
    const firstBucket = opts.implementer === 'muse-code' ? 'meta-api' : firstHost(d.ws.config.routes.agent);
    await buckets.acquire(firstBucket, d.ws.config.hosts[firstBucket], countTokens(taskText));
    const first = await assign(d.ctx, task.id, { adapter: opts.implementer, role: 'implementer', steps: def.killAfterSteps });
    await first.done;
    const packetName = (await d.ws.handoffs(task.id).names()).at(-1);
    const packet = packetName ? await d.ws.handoffs(task.id).read(packetName) : null;
    if (!packetName || !packet) throw new Error(`${key}: the first run built no packet`);
    const transcriptPath = await d.ws.runs(task.id).transcriptPath(first.run);
    const transcriptLines = existsSync(transcriptPath) ? (await readFile(transcriptPath, 'utf8')).split('\n').filter((l) => l.trim()) : [];
    const now = await d.ws.readTask(task.id);
    const diff = (await d.ctx.worktrees.diff(now, 'unified')) as string;
    const events = await d.ws.events(task.id).read();
    const firstFinished = events.find((e) => e.type === 'run.finished' && e.run === first.run);
    const implementerModel = asString(firstFinished?.payload.model ?? runsFromEvents(events).find((r) => r.run === first.run)?.model);
    await d.ctx.worktrees.remove(now, first.run);
    return { rows, checkpoint: { fixture, id: task.id, baseRow, taskText, packetName, packet, transcriptLines, diff, implementerModel } };
  } catch (err) {
    rmSync(fixture, { recursive: true, force: true });
    throw err;
  }
}

/**
 * One continued run, in its own copy of the task's checkpoint: from the transcript, the packet, or the task and
 * the first run's diff; then review, the held-out tests and learn as the legs ask. Each leg that runs is recorded
 * with its cost and result, and the run's artefacts are kept.
 */
async function continueFrom(opts: LiveBenchOptions, cp: Checkpoint, unit: Unit, buckets: HostBuckets): Promise<BenchRowFile[]> {
  const copy = mkdtempSync(join(tmpdir(), 'stint-bench-'));
  const label = `${unit.task} ${unit.mode}${opts.repeat > 1 ? ` repeat ${unit.repeat}` : ''}`;
  const legs = opts.legs ?? ['build'];
  const rows: BenchRowFile[] = [];
  const dir = runDir(opts, unit.task, unit.mode, unit.repeat);
  try {
    // relative links stay relative, so no copy points back into the checkpoint folder
    cpSync(cp.fixture, copy, { recursive: true, verbatimSymlinks: true });
    const d = await daemonOn(opts, copy, buckets);
    const baseRow = { ...cp.baseRow, mode: unit.mode, repeat: unit.repeat };
    const recordLeg = async (row: BenchRowFile): Promise<void> => {
      rows.push(row);
      await writeRow(opts, dir, row, label);
    };
    opts.log?.(`${label}: continuing from the ${unit.mode}${opts.host ? ` on ${opts.host}` : ''}`);
    const resume =
      unit.mode === 'transcript'
        ? { kind: 'transcript' as const, text: renderTranscript(cp.transcriptLines) }
        : unit.mode === 'diff'
          ? { kind: 'diff' as const, text: cp.diff }
          : null;
    await d.acquire(d.ws.config.routes.agent, countTokens(resume?.text ?? renderHandoff(cp.packet)));
    // One host's model for the continuing leg: the agent chain's entry on that host, named as
    // host/model for the Stint agent (which runs exactly that entry) and by its short model name otherwise.
    const hostEntry = opts.host ? d.ws.config.routes.agent?.find((e) => e.startsWith(`${opts.host}/`)) : undefined;
    const continuerModel = hostEntry ? (opts.continuer === 'stint-agent' ? hostEntry : hostEntry.split('/').slice(1).join('/')) : undefined;
    const second = await assign(d.ctx, cp.id, {
      adapter: opts.continuer,
      role: 'implementer',
      ...(continuerModel ? { model: continuerModel } : {}),
      ...(resume ? { resume } : { handoffFrom: cp.packetName }),
    });
    await second.done;

    const events = await d.ws.events(cp.id).read();
    const cont = runsFromEvents(events).find((r) => r.run === second.run);
    const finished = events.find((e) => e.type === 'run.finished' && e.run === second.run);
    const verification = await d.ws.verification(cp.id).read(second.run);
    const prompt = (await d.ws.runs(cp.id).readPrompt(second.run)) ?? '';
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'transcript.jsonl'), scrubPaths(cp.transcriptLines.length ? `${cp.transcriptLines.join('\n')}\n` : ''));
    await writeFile(join(dir, 'handoff.json'), scrubPaths(`${JSON.stringify(cp.packet, null, 2)}\n`));
    await writeFile(join(dir, 'prompt.md'), scrubPaths(prompt));
    const buildRow: BenchRowFile = {
      ...baseRow,
      leg: 'build',
      result: verification?.status === 'green' ? 'verified by the daemon' : 'not verified by the daemon',
      host: asString(finished?.payload.host ?? cont?.host),
      model: asString(finished?.payload.model ?? cont?.model),
      inputTokens: cont?.cost?.inputTokens ?? 0,
      cachedTokens: cont?.cost?.cachedTokens ?? 0,
      outputTokens: cont?.cost?.outputTokens ?? 0,
      usd: cont?.cost?.usd ?? null,
      wallMs: wallOf(cont, 0),
      verified: verification?.status === 'green',
      promptTokens: countTokens(prompt),
      implementerModel: cp.implementerModel,
      ...(cont?.startedAt ? { startedAt: cont.startedAt } : {}),
      ...(cont?.endedAt ? { finishedAt: cont.endedAt } : {}),
    };

    if (legs.includes('review')) {
      opts.log?.(`${label}: reviewing on ${opts.host ?? firstHost(d.ws.config.routes.reviewer)}`);
      const started = Date.now();
      await d.acquire(d.ws.config.routes.reviewer, countTokens(renderHandoff(cp.packet)));
      const res = await d.post(`/api/tasks/${cp.id}/review`, opts.host ? { host: opts.host } : {});
      const body = (await res.json().catch(() => ({}))) as { verdict?: unknown; findings?: unknown[] };
      const run = await d.latestRoleRun(cp.id, 'reviewer').catch(() => undefined);
      if (res.ok) await writeFile(join(dir, 'review.json'), scrubPaths(`${JSON.stringify(body, null, 2)}\n`));
      await recordLeg({
        ...baseRow,
        leg: 'review',
        result: res.ok ? `reviewed: ${asString(body.verdict)}, ${Array.isArray(body.findings) ? body.findings.length : 0} findings` : `not reviewed: ${routeError(body, res.status)}`,
        host: asString(run?.host ?? opts.host ?? firstHost(d.ws.config.routes.reviewer)),
        model: asString(run?.model),
        inputTokens: run?.cost?.inputTokens ?? 0,
        cachedTokens: run?.cost?.cachedTokens ?? 0,
        outputTokens: run?.cost?.outputTokens ?? 0,
        usd: run?.cost?.usd ?? null,
        wallMs: wallOf(run, Date.now() - started),
        verified: res.ok,
        promptTokens: 0,
        implementerModel: cp.implementerModel,
        ...(run?.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run?.endedAt ? { finishedAt: run.endedAt } : {}),
      });
    }

    const held = opts.scenarios?.[unit.task];
    if (held?.length) {
      // the run and its review are over, so no agent can see the held-out tests now
      let stored = true;
      for (const s of held) stored &&= (await d.post(`/api/tasks/${cp.id}/scenarios`, s)).ok;
      const res = stored ? await d.post(`/api/tasks/${cp.id}/verify`, { run: second.run }) : null;
      const v = res?.ok ? ((await res.json()) as { status?: string; scenarios?: { passed: number; failed: number } | null }) : null;
      // held-out tests that could not run grade nothing
      buildRow.hidden = v?.scenarios ? (v.status === 'green' ? 'green' : 'red') : null;
      buildRow.scenarios = v?.scenarios ? { passed: v.scenarios.passed, failed: v.scenarios.failed } : null;
      buildRow.result = `${buildRow.result}; with the held-out tests ${buildRow.hidden ?? 'not run'}`;
    }
    if (legs.includes('build')) await recordLeg(buildRow);
    // the run's own record: the task's events, the packet it built and the change on the branch
    await writeFile(join(dir, 'events.jsonl'), scrubPaths((await readFile(d.ws.events(cp.id).path, 'utf8').catch(() => ''))));
    const after = await d.ws.handoffs(cp.id).latest();
    if (after && after.from.run === second.run) await writeFile(join(dir, 'handoff-continued.json'), scrubPaths(`${JSON.stringify(after, null, 2)}\n`));
    await writeFile(join(dir, 'diff.patch'), scrubPaths((await d.ctx.worktrees.diff(await d.ws.readTask(cp.id), 'unified')) as string));

    if (legs.includes('learn')) {
      opts.log?.(`${label}: approving so the daemon learn step runs`);
      const started = Date.now();
      const before = (await d.ws.events(cp.id).read()).length;
      await d.acquire(d.ws.config.routes.learn, countTokens(renderHandoff(cp.packet)));
      const res = await d.post(`/api/tasks/${cp.id}/approve`, {});
      const body = (await res.json().catch(() => ({}))) as unknown;
      let result = `not learned: approve did not run (${routeError(body, res.status)})`;
      let verified = false;
      let cost = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null as number | null };
      let host: string = firstHost(d.ws.config.routes.learn);
      let model = 'unknown';
      if (res.ok) {
        // learn runs after the approval and writes skill.proposed or learn.skipped on this timeline
        for (let i = 0; i < 1200; i++) {
          const later = (await d.ws.events(cp.id).read()).slice(before);
          const proposed = later.find((e) => e.type === 'skill.proposed');
          const skipped = later.find((e) => e.type === 'learn.skipped');
          if (proposed) {
            const c = proposed.payload.cost as { inputTokens?: number; cachedTokens?: number; outputTokens?: number; usd?: number | null } | undefined;
            cost = { inputTokens: c?.inputTokens ?? 0, cachedTokens: c?.cachedTokens ?? 0, outputTokens: c?.outputTokens ?? 0, usd: c?.usd ?? null };
            host = asString(proposed.payload.host ?? host);
            model = asString(proposed.payload.model);
            result = `proposed skill ${asString(proposed.payload.id)}`;
            verified = true;
            break;
          }
          if (skipped) {
            const reason = asString(skipped.payload.reason ?? 'no reason recorded');
            result = `learn skipped: ${reason}`;
            // no recurrence means no model call was made; any other skip leaves the cost unrecorded
            cost = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: reason === 'no recurrence' ? 0 : null };
            verified = true;
            break;
          }
          if (i === 1199) result = 'not learned: the learn step did not finish while the bench waited';
          await Bun.sleep(100);
        }
      }
      await recordLeg({
        ...baseRow,
        leg: 'learn',
        result,
        host,
        model,
        inputTokens: cost.inputTokens,
        cachedTokens: cost.cachedTokens,
        outputTokens: cost.outputTokens,
        usd: cost.usd,
        wallMs: Date.now() - started,
        verified,
        promptTokens: 0,
        implementerModel: cp.implementerModel,
      });
    }
    return rows;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** Runs at most n jobs at once; a finishing job hands its slot straight to the next one waiting. */
function slots(n: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active < n) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/**
 * The live bench: one capped first run per task, and from that one checkpoint every mode and repeat continues,
 * each in its own copy, so the modes differ only in what the continuer is handed. Bounded by concurrency and by
 * each host's token bucket (R-055). Returns the results; the caller writes them.
 */
export async function runBenchLive(opts: LiveBenchOptions): Promise<BenchResults> {
  const startedAt = new Date().toISOString();
  const buckets = hostBuckets(opts.clock);
  const units: Unit[] = [];
  for (const def of opts.tasks) {
    for (const mode of opts.modes) for (let r = 1; r <= opts.repeat; r++) units.push({ def, task: taskKey(def), mode, repeat: r });
  }
  const rows: BenchRowFile[] = [];
  const slot = slots(Math.max(1, opts.concurrency));
  // every run that starts finishes and keeps its row, even when another fails; the first failure is thrown after
  const settle = async (jobs: Array<Promise<unknown>>) => {
    const failed = (await Promise.allSettled(jobs)).find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  };
  await settle(
    opts.tasks.map(async (def) => {
      const made = await slot(() => makeCheckpoint(opts, def, buckets));
      rows.push(...made.rows);
      const cp = made.checkpoint;
      if (!cp) return;
      try {
        await settle(units.filter((u) => u.def === def).map((u) => slot(async () => rows.push(...(await continueFrom(opts, cp, u, buckets))))));
      } finally {
        rmSync(cp.fixture, { recursive: true, force: true });
      }
    }),
  );
  rows.sort((a, b) => {
    const ua = units.findIndex((u) => u.task === a.task && u.mode === a.mode && u.repeat === a.repeat);
    const ub = units.findIndex((u) => u.task === b.task && u.mode === b.mode && u.repeat === b.repeat);
    return ua - ub || BENCH_LEGS.indexOf(a.leg ?? 'build') - BENCH_LEGS.indexOf(b.leg ?? 'build');
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
