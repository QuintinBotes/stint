import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type Cost, type Role, type Task, countTokens, priceUsage } from '@stint-dev/core';
import { runsFromEvents, writeJsonAtomic } from '@stint-dev/core/node';
import type { Adapter, RunResult } from './adapter';
import type { DaemonContext } from './app';
import { runEnv } from './env';
import { DaemonError } from './errors';
import { git } from './git';
import { earlierHops } from './handoff';
import { renderPrompt } from './prompt';
import { skillsFor } from './skills';
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

/** The price key of a run: Muse Code bills the Meta Model API; other agents bill the host that answered. */
export function priceKey(adapter: string, host: string | undefined, model: string | undefined): string {
  if (adapter === 'muse-code' || host === 'local-cli' || !host) return `meta-api/${model ?? 'muse-spark-1.3'}`;
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
  let task = await ws.readTask(taskId);
  const adapter: Adapter | undefined = ctx.adapters.find((a) => a.id === input.adapter);
  if (!adapter) throw new DaemonError('adapter_unavailable', `no adapter ${input.adapter} is configured`, ctx.adapters.map((a) => a.id).join(', '));
  if (!adapter.roles.includes(input.role)) {
    throw new DaemonError('capability_mismatch', `${adapter.id} cannot take the ${input.role} role`, `its roles: ${adapter.roles.join(', ')}`);
  }
  if (input.steps !== undefined && (!Number.isInteger(input.steps) || input.steps < 1)) {
    throw new DaemonError('invalid', `steps must be a positive whole number, not ${input.steps}`);
  }
  if (ctx.runs.get(taskId)) throw new DaemonError('run_active', `${taskId} already has a live run`, 'stop it or wait for it to end');
  const budget = task.budgets[input.role];
  const spent = await spentByRole(ctx, taskId, input.role);
  const av = await adapter.available();
  if (!av.ok) throw new DaemonError('adapter_unavailable', `${adapter.id} is unavailable: ${av.reason ?? 'no reason given'}`);

  await releaseWorktrees(ctx, task);
  // A task whose branch does not exist yet starts from where the base branch is now (D-024).
  if ((await git(ws.root, ['rev-parse', '--verify', '-q', `refs/heads/${task.branch}`])).code !== 0) {
    const head = (await git(ws.root, ['rev-parse', '--verify', '-q', 'HEAD'])).stdout.trim();
    if (head && head !== task.baseCommit) task = await ws.writeTask(taskId, { baseCommit: head }, undefined, { emit: false });
  }
  const skills = skillsFor(ws.root, input.role, task.tags ?? []);
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
  const wt = await ctx.worktrees.create(task, run);
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
  for (const s of skills) await events.append({ task: taskId, run, vendor: 'daemon', type: 'skill.applied', payload: { skill: s.name, run }, links: [{ kind: 'skill', ref: s.name }] });
  await ws.writeTask(taskId, {
    status: input.role === 'reviewer' ? 'reviewing' : 'building',
    assignee: { adapter: adapter.id, role: input.role, run, ...(model ? { model } : {}) },
    pendingAsk: null,
  });

  await writeActive(ctx, { task: taskId, run, worktree: relative(ws.root, wt.path), adapter: adapter.id });
  const abort = new AbortController();
  const live = { task: taskId, run, adapter: adapter.id, worktree: wt.path, startedAt, abort, inFlight: null as string | null, done: Promise.resolve() as Promise<unknown> };
  const done = (async () => {
    const snaps = ctx.worktrees.startSnapshots(task, run, wt.path, ctx.snapshotMs);
    let result: RunResult;
    try {
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
          steps: input.steps ?? Number(ws.config.adapters[adapter.id]?.maxModelSteps ?? 60),
          ...(input.steps !== undefined ? { maxTurns: input.steps } : {}),
          timeoutMs: Number(ws.config.adapters[adapter.id]?.timeoutMs ?? 900_000),
        },
        env: runEnv(taskId, run, wt.path),
        signal: abort.signal,
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
    await snaps.stop();
    const commit = existsSync(wt.path) ? await ctx.worktrees.commit(task, run, wt.path, result.endedBy) : null;
    const cost = priced(ctx, adapter.id, { ...result, model: result.model ?? model });
    if (cost.usd === null) await events.append({ task: taskId, run, vendor: 'daemon', type: 'cost.unpriced', payload: { key: priceKey(adapter.id, result.host, result.model ?? model) } });
    await ws.runs(taskId).updateMeta(run, { endedAt: new Date().toISOString(), endedBy: result.endedBy, cost, ...(result.sessionId ? { sessionId: result.sessionId } : {}) });
    // Muse names the open tool without arguments; its PreToolUse hook adds them when it names the same tool
    const own = result.endedBy === 'killed' ? (result.inFlight ?? null) : null;
    const hooked = live.inFlight;
    const inFlight = own && hooked?.startsWith(`${own} `) ? hooked : own;
    await events.append({
      ...base,
      type: 'run.finished',
      payload: { endedBy: result.endedBy, cost, host: result.host ?? 'local-cli', model: result.model ?? model ?? null, inFlight, commit, ...(result.sessionId ? { sessionId: result.sessionId } : {}) },
    });
    await writeActive(ctx, null);
    ctx.runs.remove(taskId, run);
    await ws.writeTask(taskId, { status: 'verifying', assignee: null });
    const v = existsSync(wt.path) ? await ctx.verifier.verify(await ws.readTask(taskId), run, wt.path) : null;
    await ws.writeTask(taskId, { status: v?.status === 'green' ? 'reviewing' : 'building' });
    await ctx.afterRun?.(taskId, run, result);
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

/** Stops a live run: SIGKILL to the agent's process group, then waits up to 5 s for the run to close. */
export async function stop(ctx: DaemonContext, taskId: string, run: string): Promise<{ run: string; stopped: boolean }> {
  const live = ctx.runs.get(taskId);
  if (!live || live.run !== run) throw new DaemonError('not_found', `${taskId} ${run} is not running`);
  live.abort.abort();
  const closed = await Promise.race([live.done.then(() => true), Bun.sleep(5_000).then(() => false)]);
  return { run, stopped: closed };
}

