import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type Cost, type PermissionRequest, type Role, type StintEvent, type Task, countTokens, priceUsage } from '@stint-dev/core';
import { runsFromEvents, writeJsonAtomic } from '@stint-dev/core/node';
import { lockPlanTests } from './acceptance';
import type { Adapter, RunResult } from './adapter';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { daemonPort, drainDockerBlocked, prepareRun } from './sandbox';
import { git } from './git';
import { earlierHops } from './handoff';
import { renderPrompt } from './prompt';
import { sharpenBrief } from './sharpen';
import { currentWorktree, verifyBranch } from './routes/work';
import { skillsForTask } from './skills';
import { worktreePath } from './worktree';

export type AssignInput = {
  adapter: string;
  role: Role;
  model?: string;
  instruction?: string;
  handoffFrom?: string;
  /** Caps this run at this many model steps, replacing the adapter default (the bench first run). */
  steps?: number;
  /** Continues from a rendered transcript instead of a packet (the bench transcript mode). */
  resume?: { kind: 'transcript'; text: string };
};
export type Assigned = { run: string; worktree: string; done: Promise<void> };

/** The price key of a run: Muse Code bills the Meta Model API; a local CLI agent bills under <agent>/<model> (R-032); other agents bill the host that answered. */
export function priceKey(adapter: string, host: string | undefined, model: string | undefined): string {
  if (adapter === 'muse-code') return `meta-api/${model ?? 'muse-spark-1.3'}`;
  if (!host || host === 'local-cli') return `${adapter}/${model ?? ''}`;
  return `${host}/${model ?? ''}`;
}

export function priced(ctx: DaemonContext, adapter: string, r: Pick<RunResult, 'cost' | 'host' | 'model'>): Cost {
  if (r.cost.usd !== null) return r.cost;
  // an agent killed before it reported usage cost something unknown, not nothing
  if (r.cost.estimated && r.cost.inputTokens + r.cost.outputTokens === 0) return r.cost;
  const usd = priceUsage(ctx.ws.config.prices[priceKey(adapter, r.host, r.model)], r.cost);
  return { ...r.cost, usd };
}

/** Tokens a role has already spent on a task: fresh input plus output, the part that costs money (D-033). */
async function spentByRole(ctx: DaemonContext, task: string, role: Role): Promise<number> {
  const runs = runsFromEvents(await ctx.ws.events(task).read());
  return runs.filter((r) => r.role === role && r.cost).reduce((s, r) => s + Math.max(0, (r.cost?.inputTokens ?? 0) - (r.cost?.cachedTokens ?? 0)) + (r.cost?.outputTokens ?? 0), 0);
}

/** Removes the task's earlier worktrees that no run holds, so the branch can be checked out again. Never forced. */
export async function releaseWorktrees(ctx: DaemonContext, task: Task): Promise<void> {
  for (const r of runsFromEvents(await ctx.ws.events(task.id).read())) {
    const path = worktreePath(ctx.ws, task.id, r.run);
    if (existsSync(path) && !ctx.runs.holds(path)) await ctx.worktrees.remove(task, r.run);
  }
}

const DECISION = /^decision:\s*(.+)$/i;
const SUPERSEDES = /^supersedes:\s*(D[0-9]+)\s*$/i;

/** An agent's `decision: ...` lines become entries in decisions.md, with the message as evidence (R-014). */
export async function captureDecisions(ctx: DaemonContext, taskId: string, run: string, adapter: string, eventId: string, text: string): Promise<void> {
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = DECISION.exec(lines[i] as string);
    if (!m?.[1]) continue;
    const sup = SUPERSEDES.exec(lines[i + 1] ?? '');
    try {
      const d = await ctx.ws.decisions(taskId).append({ text: m[1].slice(0, 200), by: `${adapter} ${run}`, evidence: [`${taskId}/${run}#${eventId}`], ...(sup?.[1] ? { supersedes: sup[1] } : {}) });
      await ctx.ws.events(taskId).append({ task: taskId, run, adapter, vendor: 'daemon', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by, ...(d.supersedes ? { supersedes: d.supersedes } : {}) }, links: [{ kind: 'decision', ref: d.id }] });
    } catch (err) {
      // a supersedes naming no decision is reported, not recorded
      await ctx.ws.events(taskId).append({ task: taskId, run, vendor: 'daemon', type: 'agent.message', payload: { text: `A decision line was not recorded: ${err instanceof Error ? err.message : String(err)}`, stderr: true } });
    }
  }
}

/** \`.stint/active\`: the live run, for agents started outside Stint (AGENTS.md points at it). */
async function writeActive(ctx: DaemonContext, value: Record<string, string> | null): Promise<void> {
  const path = join(ctx.ws.stintDir, 'active');
  if (value) await writeJsonAtomic(path, value);
  else await rm(path, { force: true });
}

/** Starts a run: worktree, skills, prompt, run.started, then the adapter in the background. */
export async function assign(ctx: DaemonContext, taskId: string, input: AssignInput): Promise<Assigned> {
  const ws = ctx.ws;
  const task = await ws.readTask(taskId);
  const adapter: Adapter | undefined = ctx.adapters.find((a) => a.id === input.adapter);
  if (!adapter) {
    const ids = ctx.adapters.map((a) => a.id);
    throw new DaemonError('adapter_unavailable', `no adapter ${input.adapter} is configured (configured adapters: ${ids.join(', ') || 'none'})`, ids.join(', '));
  }
  if (!adapter.roles.includes(input.role)) {
    throw new DaemonError('capability_mismatch', `${adapter.id} cannot take the ${input.role} role`, `its roles: ${adapter.roles.join(', ')}`);
  }
  if (input.steps !== undefined && (!Number.isInteger(input.steps) || input.steps < 1)) {
    throw new DaemonError('invalid', `steps must be a positive whole number, not ${input.steps}`);
  }
  if (!ctx.runs.reserve(taskId)) throw new DaemonError('run_active', `${taskId} already has a live run`, 'stop it or wait for it to end');
  try {
    return await begin(ctx, taskId, input, task, adapter);
  } finally {
    ctx.runs.release(taskId);
  }
}

async function begin(ctx: DaemonContext, taskId: string, input: AssignInput, task: Task, adapter: Adapter): Promise<Assigned> {
  const ws = ctx.ws;
  // tester and learn runs draw on the implementer's budget unless the task gives them their own
  const budget = task.budgets[input.role] ?? task.budgets.implementer;
  const spent = await spentByRole(ctx, taskId, input.role);
  const av = await adapter.available();
  if (!av.ok) throw new DaemonError('adapter_unavailable', `${adapter.id} is unavailable: ${av.reason ?? 'no reason given'}`);

  await releaseWorktrees(ctx, task);
  // A task whose branch does not exist yet starts from where the base branch is now (D-024).
  if ((await git(ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code !== 0) {
    const head = (await git(ws.root, ['rev-parse', '--verify', '-q', 'HEAD'])).stdout.trim();
    if (head && head !== task.baseCommit) task = await ws.writeTask(taskId, { baseCommit: head }, undefined, { emit: false });
  }
  const skills = await skillsForTask(ws, task, input.role);
  const transcript = input.resume?.kind === 'transcript' ? input.resume.text : undefined;
  const packetName = transcript !== undefined ? null : (input.handoffFrom ?? (await ws.handoffs(taskId).names()).at(-1) ?? null);
  const handoff = packetName ? await ws.handoffs(taskId).read(packetName) : null;
  if (transcript === undefined && input.handoffFrom && !handoff) throw new DaemonError('not_found', `${taskId} has no packet ${input.handoffFrom}`);
  const prompt = renderPrompt({
    task,
    plan: await ws.readPlan(taskId),
    handoff,
    ...(transcript !== undefined ? { transcript } : {}),
    before: handoff ? await earlierHops(ctx, taskId, handoff.from.run) : [],
    skills,
    diff: (await ctx.worktrees.diff(task, 'json')) as never,
    ask: input.instruction ?? task.pendingAsk ?? null,
    // the first build, with no packet to continue from, starts from what sharpening settled
    ...(input.role === 'implementer' && !handoff && transcript === undefined ? { settled: await sharpenBrief(ws, task) } : {}),
  });
  // The role's spend on this task plus the prompt about to be sent must stay under the role's budget.
  const promptTokens = countTokens(prompt);
  if (spent + promptTokens > budget) {
    throw new DaemonError('budget_exceeded', `the ${input.role} budget on ${taskId} would be exceeded`, { spent, prompt: promptTokens, cap: budget });
  }
  // the next run id is above every run the log or the run folders know
  const fromDirs = Number((await ws.runs(taskId).nextRunId()).slice(1));
  const fromLog = runsFromEvents(await ws.events(taskId).read()).reduce((m, r) => Math.max(m, Number(r.run.slice(1)) + 1), 1);
  const run = `r${Math.max(fromDirs, fromLog)}`;
  // with no plan there was no plan time: the first assign locks the tests as they are now (R-029)
  await lockPlanTests(ctx, taskId);
  const wt = await ctx.worktrees.create(task, run);
  // the agent's process calls the daemon with a token good only for this run's own routes, never the daemon's (R-040)
  const token = randomBytes(24).toString('hex');
  const port = daemonPort(ctx);
  // a sandbox that is configured but cannot run refuses the run before anything is recorded
  const sandbox = await prepareRun(ctx, taskId, run, wt.path, adapter, { STINT_RUN_TOKEN: token, ...(port ? { STINT_DAEMON_PORT: String(port) } : {}) }).catch(async (err: unknown) => {
    await ctx.worktrees.remove(task, run).catch(() => undefined);
    throw err;
  });
  const startedAt = new Date().toISOString();
  const model = input.model ?? (adapter.id === 'muse-code' ? (ws.config.adapters['muse-code']?.model as string | undefined) : undefined);
  await ws.runs(taskId).create({
    run,
    adapter: adapter.id,
    vendor: adapter.vendor,
    role: input.role,
    ...(model ? { model } : {}),
    host: 'local-cli',
    startedAt,
    worktree: relative(ws.root, wt.path),
    ...(packetName ? { handoffFrom: packetName } : {}),
  });
  const promptPath = await ws.runs(taskId).writePrompt(run, prompt);
  const events = ws.events(taskId);
  const base = { task: taskId, run, adapter: adapter.id, vendor: adapter.vendor } as const;
  await events.append({ ...base, type: 'run.started', payload: { role: input.role, model: model ?? null, host: 'local-cli', worktree: relative(ws.root, wt.path), handoffFrom: packetName, skills: skills.map((s) => s.name) } });
  for (const s of skills) await events.append({ task: taskId, run, vendor: 'daemon', type: 'skill.applied', payload: { skill: s.name, run, by: s.by }, links: [{ kind: 'skill', ref: s.name }] });
  await ws.writeTask(taskId, {
    status: input.role === 'reviewer' ? 'reviewing' : 'building',
    assignee: { adapter: adapter.id, role: input.role, run, ...(model ? { model } : {}) },
    pendingAsk: null,
  });

  await writeActive(ctx, { task: taskId, run, worktree: relative(ws.root, wt.path), adapter: adapter.id });
  const abort = new AbortController();
  const live = {
    task: taskId,
    run,
    adapter: adapter.id,
    worktree: wt.path,
    startedAt,
    abort,
    inFlight: null as string | null,
    token: token as string | undefined,
    permissions: new Map<string, { requestId: string; tool: string; title: string; options: PermissionRequest['options']; resolve: (answer: { optionId: string } | 'cancelled') => void }>(),
    done: Promise.resolve() as Promise<unknown>,
  };
  const askPermission = async (req: PermissionRequest): Promise<{ optionId: string } | 'cancelled'> => {
    if (abort.signal.aborted) return 'cancelled';
    let resolveAnswer: (answer: { optionId: string } | 'cancelled') => void = () => undefined;
    const answer = new Promise<{ optionId: string } | 'cancelled'>((r) => {
      resolveAnswer = r;
    });
    live.permissions.set(req.requestId, { requestId: req.requestId, tool: req.tool, title: req.title, options: req.options, resolve: resolveAnswer });
    abort.signal.addEventListener(
      'abort',
      () => {
        if (live.permissions.delete(req.requestId)) resolveAnswer('cancelled');
      },
      { once: true },
    );
    await events.append({ ...base, type: 'permission.requested', payload: { requestId: req.requestId, run, tool: req.tool, title: req.title, options: req.options } });
    if (abort.signal.aborted) {
      live.permissions.delete(req.requestId);
      return 'cancelled';
    }
    return answer;
  };
  const done = (async () => {
    const snaps = ctx.worktrees.startSnapshots(task, run, wt.path, ctx.snapshotMs);
    let result: RunResult;
    try {
      // Muse Code steps scale with what is left of the role budget, not only with config (R-054)
      const configSteps = Number(ws.config.adapters[adapter.id]?.maxModelSteps ?? 60);
      const remainingSteps = adapter.id === 'muse-code' ? Math.max(1, Math.min(configSteps, Math.floor((configSteps * Math.max(0, budget - spent)) / Math.max(1, budget)))) : configSteps;
      result = await adapter.run({
        task,
        run,
        role: input.role,
        worktree: wt.path,
        prompt,
        promptPath,
        skills,
        ...(model ? { model } : {}),
        budget: {
          tokens: budget - spent,
          steps: input.steps ?? remainingSteps,
          ...(input.steps !== undefined ? { maxTurns: input.steps } : {}),
          timeoutMs: Number(ws.config.adapters[adapter.id]?.timeoutMs ?? 900_000),
        },
        env: sandbox.env,
        ...(sandbox.wrap ? { wrap: sandbox.wrap } : {}),
        signal: abort.signal,
        askPermission,
        onSpawn: (pid) => {
          (live as { pgid?: number }).pgid = pid;
        },
        emit: async (e) => {
          const appended = await events.append({ ...e, ...base, type: e.type, payload: e.payload });
          if (e.type === 'agent.message') await captureDecisions(ctx, taskId, run, adapter.id, appended.id, String(e.payload.text ?? ''));
        },
        transcript: (line) => ws.runs(taskId).appendTranscript(run, line),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await events.append({ ...base, type: 'agent.message', payload: { text: `The adapter failed: ${message}` } });
      result = { endedBy: abort.signal.aborted ? 'killed' : 'failed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true } };
    }
    // the run is over: its token opens nothing any more
    live.token = undefined;
    await snaps.stop();
    if (ws.config.sandbox?.kind === 'docker') await drainDockerBlocked(ctx);
    // Muse names the open tool without arguments; its PreToolUse hook adds them when it names the same tool
    const own = result.endedBy === 'killed' ? (result.inFlight ?? null) : null;
    const hooked = live.inFlight;
    await closeRun(ctx, task, base, wt.path, result, model, own && hooked?.startsWith(`${own} `) ? hooked : own);
  })().catch(async (err: unknown) => {
    ctx.runs.remove(taskId, run);
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `run ${taskId} ${run} failed to close: ${err instanceof Error ? err.message : String(err)}` })}\n`);
  });
  live.done = done;
  ctx.runs.add(live);
  ctx.pending.add(done);
  void done.finally(() => ctx.pending.delete(done));
  return { run, worktree: relative(ws.root, wt.path), done };
}

type RunBase = { task: string; run: string; adapter: string; vendor: StintEvent['vendor'] };

/** Closes a run that ended, one a restart cut off included: commit, run.finished, the daemon's verification, then the packet. */
async function closeRun(ctx: DaemonContext, task: Task, base: RunBase, worktree: string, result: RunResult, model: string | undefined, inFlight: string | null): Promise<void> {
  const { ws } = ctx;
  const { task: taskId, run, adapter } = base;
  const events = ws.events(taskId);
  const commit = existsSync(worktree) ? await ctx.worktrees.commit(task, run, worktree, result.endedBy) : null;
  const cost = priced(ctx, adapter, { ...result, model: result.model ?? model });
  if (cost.usd === null) await events.append({ task: taskId, run, vendor: 'daemon', type: 'cost.unpriced', payload: { key: priceKey(adapter, result.host, result.model ?? model) } });
  await ws.runs(taskId).updateMeta(run, { endedAt: new Date().toISOString(), endedBy: result.endedBy, cost, ...(result.sessionId ? { sessionId: result.sessionId } : {}) });
  await events.append({
    ...base,
    type: 'run.finished',
    payload: { endedBy: result.endedBy, cost, host: result.host ?? 'local-cli', model: result.model ?? model ?? null, inFlight, commit, ...(result.sessionId ? { sessionId: result.sessionId } : {}) },
  });
  await writeActive(ctx, null);
  ctx.runs.remove(taskId, run);
  await ws.writeTask(taskId, { status: 'verifying', assignee: null });
  const v = existsSync(worktree) ? await ctx.verifier.verify(await ws.readTask(taskId), run, worktree) : null;
  await ws.writeTask(taskId, { status: v?.status === 'green' ? 'reviewing' : 'building' });
  await ctx.afterRun?.(taskId, run, result);
}

const logError = (message: string) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message })}\n`);

/**
 * On start nothing is live, so a run the log leaves open was cut off by a crash or a stop: it is closed as killed
 * through the same path as any killed run. A task left verifying is verified again. Autopilot resumes after this,
 * so it never waits on a run that will not end (R-025).
 */
export async function recoverRuns(ctx: DaemonContext): Promise<void> {
  for (const t of await ctx.ws.listTasks()) {
    try {
      const events = await ctx.ws.events(t.id).read();
      for (const r of runsFromEvents(events).filter((x) => !x.endedAt)) {
        const started = events.find((e) => e.type === 'run.started' && e.run === r.run);
        // a replayed run was recorded, not lost; a live one is still running
        if (!started || started.payload.replay === true || ctx.runs.get(t.id)) continue;
        const base: RunBase = { task: t.id, run: r.run, adapter: started.adapter ?? 'unknown', vendor: started.vendor ?? 'other' };
        const killed: RunResult = { endedBy: 'killed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true } };
        await ctx.ws.events(t.id).append({ ...base, type: 'agent.message', payload: { text: 'This run was cut off because the daemon restarted, so it is closed as killed.' } });
        // a plan or review call has no worktree, commit or verification: it only ends
        if (typeof started.payload.worktree !== 'string') await ctx.ws.events(t.id).append({ ...base, type: 'run.finished', payload: { endedBy: 'killed', cost: killed.cost, reason: 'the daemon restarted' } });
        else await closeRun(ctx, t, base, worktreePath(ctx.ws, t.id, r.run), killed, r.model ?? undefined, null);
      }
      const task = await ctx.ws.readTask(t.id);
      if (task.status !== 'verifying' || ctx.runs.get(t.id)) continue;
      const wt = await currentWorktree(ctx, t.id).catch(() => null);
      const last = runsFromEvents(await ctx.ws.events(t.id).read()).filter((r) => r.role === 'implementer').at(-1);
      const v = wt ? await ctx.verifier.verify(task, wt.run, wt.path) : last ? await verifyBranch(ctx, task, last.run) : null;
      await ctx.ws.writeTask(t.id, { status: v?.status === 'green' ? 'reviewing' : 'building' });
    } catch (err) {
      logError(`a run of ${t.id} that a restart cut off could NOT be closed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Stops a live run: SIGKILL to the agent's process group, then waits up to 5 s for the run to close. */
export async function stop(ctx: DaemonContext, taskId: string, run: string): Promise<{ run: string; stopped: boolean }> {
  const live = ctx.runs.get(taskId);
  if (!live || live.run !== run) throw new DaemonError('not_found', `${taskId} ${run} is not running`);
  const pending = [...(live.permissions?.values() ?? [])];
  live.abort.abort();
  for (const p of pending) {
    live.permissions?.delete(p.requestId);
    p.resolve('cancelled');
    await ctx.ws
      .events(taskId)
      .append({ task: taskId, run, vendor: 'daemon', type: 'permission.decided', payload: { requestId: p.requestId, optionId: null, cancelled: true, by: 'stop' } })
      .catch(() => undefined);
  }
  const closed = await Promise.race([live.done.then(() => true), Bun.sleep(5_000).then(() => false)]);
  return { run, stopped: closed };
}

