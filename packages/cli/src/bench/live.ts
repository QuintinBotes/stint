import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { countTokens, renderHandoff } from '@stint-dev/core';
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
  /** Fresh adapters per bench run; the live command leaves this out and uses the daemon defaults. */
  adapters?: () => Adapter[];
  makeFixture?: () => string;
  log?: (line: string) => void;
};

type Unit = { def: BenchTaskDef; task: string; mode: BenchMode; repeat: number; taskAt: number; modeAt: number };

const asString = (v: unknown): string => (typeof v === 'string' && v ? v : 'unknown');

const firstHost = (chain: string[] | undefined): string => chain?.[0]?.split('/')[0] ?? 'unknown';

/** The daemon error message of a failed in-process route call, in plain words for a leg row. */
function routeError(body: unknown, status: number): string {
  const err = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  return typeof err?.message === 'string' ? err.message : typeof err?.code === 'string' ? err.code : `HTTP ${status}`;
}

/**
 * One task in one mode, from a fresh fixture copy: the legs in order (R-055), plan through the
 * daemon's planner, a capped first run and the continuer for build, review through the daemon's
 * reviewer, and learn by approving, which is the call that triggers the daemon's learn step.
 * Each leg that runs is recorded with its cost and result; artefacts are kept.
 */
async function runUnit(opts: LiveBenchOptions, unit: Unit, buckets: HostBuckets): Promise<BenchRowFile[]> {
  const fixture = (opts.makeFixture ?? freshFixture)();
  const label = `${unit.task} ${unit.mode}${opts.repeat > 1 ? ` repeat ${unit.repeat}` : ''}`;
  const legs = opts.legs ?? ['build'];
  const rows: BenchRowFile[] = [];
  try {
    const ws = await Workspace.open(fixture);
    const token = randomBytes(16).toString('hex');
    const app = createApp(ws, opts.adapters ? opts.adapters() : defaultAdapters(ws.config), {
      token,
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
    const dirName = opts.repeat > 1 ? `${unit.task}-${unit.mode}-r${unit.repeat}` : `${unit.task}-${unit.mode}`;
    const dir = join(opts.outDir, 'runs', dirName);
    const baseRow = {
      task: unit.task,
      mode: unit.mode,
      repeat: unit.repeat,
      ...(opts.synthetic ? { synthetic: true as const } : {}),
      commit: task.baseCommit,
      implementer: opts.implementer,
      continuer: opts.continuer,
    } satisfies Partial<BenchRowFile>;
    const recordLeg = async (row: BenchRowFile): Promise<void> => {
      rows.push(row);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, row.leg === 'build' || !row.leg ? 'row.json' : `row-${row.leg}.json`), `${JSON.stringify(row, null, 2)}\n`);
      opts.log?.(`${label} ${row.leg ?? 'build'} leg: input ${row.inputTokens} tokens, ${row.result ?? ''}`);
    };
    const post = (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // The host a leg will call first: the one named, or the first host of the role's chain.
    // Its token bucket holds the leg until the host can take it (R-055 requirement 5).
    const acquire = (chain: string[] | undefined, tokens: number) => {
      const host = opts.host ?? firstHost(chain);
      return buckets.acquire(host, ws.config.hosts[host], tokens);
    };
    const latestRoleRun = async (role: string) => runsFromEvents(await ws.events(task.id).read()).filter((r) => r.role === role).at(-1);
    const wallOf = (run: { startedAt?: string | null; endedAt?: string | null } | undefined, fallback: number) =>
      run?.startedAt && run.endedAt ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)) : fallback;
    const taskText = `${unit.def.title}\n${unit.def.goal}\n${unit.def.acceptance.join('\n')}`;

    if (legs.includes('plan')) {
      opts.log?.(`${label}: planning on ${opts.host ?? firstHost(ws.config.routes.planner)}`);
      const started = Date.now();
      await acquire(ws.config.routes.planner, countTokens(taskText));
      const res = await post(`/api/tasks/${task.id}/plan`, opts.host ? { host: opts.host } : {});
      const body = (await res.json().catch(() => ({}))) as { steps?: unknown[] };
      const run = await latestRoleRun('planner').catch(() => undefined);
      if (res.ok) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'plan.json'), scrubPaths(`${JSON.stringify(body, null, 2)}\n`));
      }
      await recordLeg({
        ...baseRow,
        leg: 'plan',
        result: res.ok ? `planned: ${Array.isArray(body.steps) ? body.steps.length : 0} steps` : `not planned: ${routeError(body, res.status)}`,
        host: asString(run?.host ?? opts.host ?? firstHost(ws.config.routes.planner)),
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
      });
    }

    // Review and learn stand on the build, so the build pipeline runs for them whether or not its row is kept.
    if (!legs.some((l) => l !== 'plan')) return rows;
    opts.log?.(`${label}: first run capped at ${unit.def.killAfterSteps} steps`);
    await buckets.acquire(opts.implementer === 'muse-code' ? 'meta-api' : firstHost(ws.config.routes.agent), ws.config.hosts[opts.implementer === 'muse-code' ? 'meta-api' : firstHost(ws.config.routes.agent)], countTokens(taskText));
    const first = await assign(ctx, task.id, { adapter: opts.implementer, role: 'implementer', steps: unit.def.killAfterSteps });
    await first.done;
    const packetName = (await ws.handoffs(task.id).names()).at(-1);
    const packet = packetName ? await ws.handoffs(task.id).read(packetName) : null;
    if (!packetName || !packet) throw new Error(`${label}: the first run built no packet`);
    const transcriptPath = await ws.runs(task.id).transcriptPath(first.run);
    const transcriptLines = existsSync(transcriptPath) ? (await readFile(transcriptPath, 'utf8')).split('\n').filter((l) => l.trim()) : [];
    opts.log?.(`${label}: continuing from the ${unit.mode}${opts.host ? ` on ${opts.host}` : ''}`);
    const resumeText = unit.mode === 'transcript' ? renderTranscript(transcriptLines) : null;
    await acquire(ws.config.routes.agent, countTokens(resumeText ?? renderHandoff(packet)));
    // One host's model for the continuing leg: the agent chain's entry on that host, named as
    // host/model for the Stint agent (which runs exactly that entry) and by its short model name otherwise.
    const hostEntry = opts.host ? ws.config.routes.agent?.find((e) => e.startsWith(`${opts.host}/`)) : undefined;
    const continuerModel = hostEntry ? (opts.continuer === 'stint-agent' ? hostEntry : hostEntry.split('/').slice(1).join('/')) : undefined;
    const second = await assign(ctx, task.id, {
      adapter: opts.continuer,
      role: 'implementer',
      ...(continuerModel ? { model: continuerModel } : {}),
      ...(unit.mode === 'packet' ? { handoffFrom: packetName } : { resume: { kind: 'transcript' as const, text: resumeText as string } }),
    });
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
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'transcript.jsonl'), scrubPaths(transcriptLines.length ? `${transcriptLines.join('\n')}\n` : ''));
    await writeFile(join(dir, 'handoff.json'), scrubPaths(`${JSON.stringify(packet, null, 2)}\n`));
    await writeFile(join(dir, 'prompt.md'), scrubPaths(prompt));
    if (legs.includes('build')) {
      await recordLeg({
        ...baseRow,
        leg: 'build',
        result: verification?.status === 'green' ? 'verified by the daemon' : 'not verified by the daemon',
        host: asString(finished?.payload.host ?? cont?.host),
        model: asString(finished?.payload.model ?? cont?.model),
        inputTokens: cont?.cost?.inputTokens ?? 0,
        cachedTokens: cont?.cost?.cachedTokens ?? 0,
        outputTokens: cont?.cost?.outputTokens ?? 0,
        usd: cont?.cost?.usd ?? null,
        wallMs,
        verified: verification?.status === 'green',
        promptTokens: countTokens(prompt),
        implementerModel: asString(firstFinished?.payload.model ?? firstRun?.model),
        ...(cont?.startedAt ? { startedAt: cont.startedAt } : {}),
        ...(cont?.endedAt ? { finishedAt: cont.endedAt } : {}),
      });
    }

    if (legs.includes('review')) {
      opts.log?.(`${label}: reviewing on ${opts.host ?? firstHost(ws.config.routes.reviewer)}`);
      const started = Date.now();
      await acquire(ws.config.routes.reviewer, countTokens(renderHandoff(packet)));
      const res = await post(`/api/tasks/${task.id}/review`, opts.host ? { host: opts.host } : {});
      const body = (await res.json().catch(() => ({}))) as { verdict?: unknown; findings?: unknown[] };
      const run = await latestRoleRun('reviewer').catch(() => undefined);
      if (res.ok) await writeFile(join(dir, 'review.json'), scrubPaths(`${JSON.stringify(body, null, 2)}\n`));
      await recordLeg({
        ...baseRow,
        leg: 'review',
        result: res.ok ? `reviewed: ${asString(body.verdict)}, ${Array.isArray(body.findings) ? body.findings.length : 0} findings` : `not reviewed: ${routeError(body, res.status)}`,
        host: asString(run?.host ?? opts.host ?? firstHost(ws.config.routes.reviewer)),
        model: asString(run?.model),
        inputTokens: run?.cost?.inputTokens ?? 0,
        cachedTokens: run?.cost?.cachedTokens ?? 0,
        outputTokens: run?.cost?.outputTokens ?? 0,
        usd: run?.cost?.usd ?? null,
        wallMs: wallOf(run, Date.now() - started),
        verified: res.ok,
        promptTokens: 0,
        implementerModel: asString(firstFinished?.payload.model ?? firstRun?.model),
        ...(run?.startedAt ? { startedAt: run.startedAt } : {}),
        ...(run?.endedAt ? { finishedAt: run.endedAt } : {}),
      });
    }

    if (legs.includes('learn')) {
      opts.log?.(`${label}: approving so the daemon learn step runs`);
      const started = Date.now();
      const before = (await ws.events(task.id).read()).length;
      await acquire(ws.config.routes.learn, countTokens(renderHandoff(packet)));
      const res = await post(`/api/tasks/${task.id}/approve`, {});
      const body = (await res.json().catch(() => ({}))) as unknown;
      let result = `not learned: approve did not run (${routeError(body, res.status)})`;
      let verified = false;
      let cost = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null as number | null };
      let host: string = firstHost(ws.config.routes.learn);
      let model = 'unknown';
      if (res.ok) {
        // learn runs after the approval and writes skill.proposed or learn.skipped on this timeline
        for (let i = 0; i < 1200; i++) {
          const after = (await ws.events(task.id).read()).slice(before);
          const proposed = after.find((e) => e.type === 'skill.proposed');
          const skipped = after.find((e) => e.type === 'learn.skipped');
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
        implementerModel: asString(firstFinished?.payload.model ?? firstRun?.model),
      });
    }
    return rows;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/**
 * The live bench: every task in every mode, bounded by concurrency and by each host's token
 * bucket (R-055). Returns the results; the caller writes them.
 */
export async function runBenchLive(opts: LiveBenchOptions): Promise<BenchResults> {
  const startedAt = new Date().toISOString();
  const buckets = hostBuckets(opts.clock);
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
      rows.push(...(await runUnit(opts, unit, buckets)));
    }
  });
  await Promise.all(workers);
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
