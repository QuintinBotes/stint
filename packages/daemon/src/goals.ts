// Goals above tasks (R-064 Part 2): a goal's status, its split into tasks, and the tasks made from it.
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { type Goal, type GoalOutcome, GoalSplitSchema, type GoalStatus, type NewEvent, type ProposedTask, type SharpenState, type Task, type TaskLimits, type TaskProof, goalOutcome } from '@stint-dev/core';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git } from './git';
import { effectiveChain, walkChain } from './route';
import { taskOutcome } from './routes/outcome';
import { goalEvents, sharpenStateOf, standingGoalDecisions } from './sharpen';

const list = (items: string[]) => (items.length ? items.join('\n') : '- none');
const usd = (v: number) => `$${v.toFixed(2)}`;

/** Changes a goal's status and records `goal.status` in the workspace log; the same status records nothing. */
export async function setGoalStatus(ctx: DaemonContext, id: string, to: GoalStatus, by: 'you' | 'daemon' = 'daemon'): Promise<Goal> {
  let from: GoalStatus = to;
  const goal = await ctx.ws.updateGoal(id, (g) => {
    from = g.status;
    return { status: to };
  });
  if (from !== to) await ctx.ws.workspaceEvents().append({ task: 'workspace', vendor: by === 'you' ? 'human' : 'daemon', type: 'goal.status', payload: { goal: id, from, to, by } });
  return goal;
}

/** A draft goal is ready once it is sharpened, no material question is open and each criterion has a proof. */
export async function settleGoal(ctx: DaemonContext, id: string): Promise<Goal> {
  const goal = await ctx.ws.readGoal(id);
  if (goal.status !== 'draft') return goal;
  const st = await sharpenStateOf(ctx, id);
  return st.round > 0 && st.ready ? setGoalStatus(ctx, id, 'ready') : goal;
}

/** What a split must hold to: the criteria a task covers are the goal's, and a task waits only on tasks before it. */
function splitProblem(tasks: ProposedTask[], criteria: number): string | null {
  for (const [i, t] of tasks.entries()) {
    const outside = t.covers.find((c) => c > criteria);
    if (outside !== undefined) return `task ${i + 1} covers criterion ${outside}, which the goal does not have`;
    const later = t.dependsOn.find((d) => d >= i);
    if (later !== undefined) return `task ${i + 1} waits on task ${later + 1}, which does not come before it`;
  }
  return null;
}

function splitPrompt(goal: Goal, i: { decisions: string[]; files: string[] }): string {
  const caps = [typeof goal.limits?.usd === 'number' ? `${usd(goal.limits.usd)} of spend` : '', typeof goal.limits?.builds === 'number' ? `${goal.limits.builds} builds` : ''].filter(Boolean);
  return `You split a goal into tasks for Stint. Return only JSON matching the schema given with this prompt.

Split the goal below into 1 to 6 tasks, each small enough for one agent to build and verify in one run. For each task give:
- a title of a few words;
- a goal: what is true once the task is done;
- acceptance: 1 to 8 checks that prove it, one line each;
- covers: the numbers of the goal's criteria it helps meet;
- dependsOn: the indexes, counting from 0, of earlier tasks in your list that must be merged before it starts.
Cover every criterion of the goal with at least one task, and leave out what the goal says is not in scope.

## Decisions on this goal
${list(i.decisions)}

## Tracked files (the first ${i.files.length})
${list(i.files)}

## The goal
Id: ${goal.id}
Title: ${goal.title}
Outcome: ${goal.outcome}
Criteria:
${goal.criteria.map((c, n) => `${n + 1}. ${c.text}${c.proof ? ` (proven by ${c.proof.kind}: ${c.proof.ref})` : ''}`).join('\n')}
Not in scope: ${goal.nonGoals.length ? goal.nonGoals.join('; ') : 'nothing named'}
Limits across its tasks: ${caps.length ? caps.join(' and ') : 'none'}

## Ask
Split the goal into tasks now.`;
}

/**
 * Asks the planner chain to split a goal into tasks and returns the proposal without creating anything; `goal.planned`
 * records it and what the call cost. Choosing to split makes a draft goal ready.
 */
export async function planGoal(ctx: DaemonContext, id: string): Promise<ProposedTask[]> {
  const goal = await ctx.ws.readGoal(id);
  if (goal.status === 'abandoned') throw new DaemonError('invalid', `${id} is abandoned`);
  const log = ctx.ws.workspaceEvents();
  const decisions = standingGoalDecisions(goal.decisions, await sharpenStateOf(ctx, id)).map((d) => `- ${d.id}: ${d.text}`);
  const files = (await git(ctx.ws.root, ['ls-files'])).stdout.split('\n').filter(Boolean).slice(0, 200).map((f) => `- ${f}`);
  const prompt = splitPrompt(goal, { decisions, files });
  const r = await walkChain<{ value: { tasks: ProposedTask[] } }>({
    role: 'planner',
    chain: effectiveChain('planner', ctx.ws.config.routes),
    hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
    emit: (e) => log.append({ task: 'workspace', vendor: 'daemon', type: e.type as NewEvent['type'], payload: { goal: id, ...e.payload } }).then(() => undefined),
    call: (h, model, c) => h.complete(GoalSplitSchema, prompt, { model, timeoutMs: c.timeoutMs, maxTokens: ctx.ws.config.budgets.planner, emit: c.emit }),
  }).catch((err: unknown) => {
    throw new DaemonError('adapter_unavailable', 'no planner could split this goal', err instanceof Error ? err.message : String(err));
  });
  const value = ((r.value as { value?: { tasks: ProposedTask[] } }).value ?? r.value) as { tasks: ProposedTask[] };
  // the model's numbers are kept only where they mean something: the goal's criteria, and earlier tasks
  const tasks = value.tasks.map((t, i) => ({ ...t, covers: [...new Set(t.covers.filter((c) => c <= goal.criteria.length))].sort((a, b) => a - b), dependsOn: [...new Set(t.dependsOn.filter((d) => d < i))] }));
  await log.append({ task: 'workspace', vendor: 'daemon', type: 'goal.planned', payload: { goal: id, tasks, host: r.host, model: r.model, cost: r.cost } });
  if (goal.status === 'draft') await setGoalStatus(ctx, id, 'ready');
  return tasks;
}

/** Each task's share of the goal's spend and builds; the goal's other limits apply to each task as they are. */
export function shareOf(limits: TaskLimits | undefined, n: number): TaskLimits | undefined {
  const set = Object.entries(limits ?? {}).filter(([, v]) => typeof v === 'number');
  if (!set.length) return undefined;
  const out = Object.fromEntries(set) as TaskLimits;
  if (typeof out.usd === 'number') out.usd = Math.max(0.01, Math.floor((out.usd / n) * 100) / 100);
  if (typeof out.builds === 'number') out.builds = Math.max(1, Math.floor(out.builds / n));
  return out;
}

/** What each of the `n` subtasks or best-of candidates made from a task takes from it: its goal, the goal criteria it covers, and a share of its limits. */
export function inherited(parent: Task, n: number): { goalId?: string; goalCriteria?: number[]; limits?: TaskLimits } {
  const limits = shareOf(parent.limits, n);
  return { ...(parent.goalId ? { goalId: parent.goalId, goalCriteria: parent.goalCriteria ?? [] } : {}), ...(limits ? { limits } : {}) };
}

/** Every task that spends on a goal: the goal's own tasks, and the subtasks and candidates made from them, which carry its id. */
export async function goalTasks(ctx: DaemonContext, goal: Goal): Promise<Task[]> {
  return (await ctx.ws.listTasks()).filter((t) => t.goalId === goal.id || goal.tasks.includes(t.id));
}

/**
 * A proposed task's acceptance with each covered goal criterion that has a proof added as a line of its own, unless
 * the task already has that line, and the proof on that line: the task's outcome then judges the criterion the way
 * the goal said it is proven, and the goal's rollup reads that line.
 */
function carryProofs(goal: Goal, p: ProposedTask): { acceptance: string[]; proofs: TaskProof[] } {
  const acceptance = [...p.acceptance];
  const proofs: TaskProof[] = [];
  for (const c of p.covers) {
    const { text, proof } = goal.criteria[c - 1] ?? {};
    if (!text || !proof) continue;
    const at = acceptance.includes(text) ? acceptance.indexOf(text) : acceptance.push(text) - 1;
    if (!proofs.some((x) => x.criterion === at + 1)) proofs.push({ criterion: at + 1, ...proof });
  }
  return { acceptance, proofs };
}

/**
 * Creates the tasks a person accepted, possibly edited, through the normal task creation path: each with the goal,
 * the goal criteria it covers and their proofs, the tasks it waits for and its share of the goal's limits, and a
 * ledger that starts with the goal's decisions. The goal lists them, starts running and records `goal.tasks_created`.
 */
export async function createGoalTasks(ctx: DaemonContext, id: string, proposed: ProposedTask[]): Promise<Task[]> {
  const goal = await ctx.ws.readGoal(id);
  if (goal.status === 'abandoned') throw new DaemonError('invalid', `${id} is abandoned`);
  const problem = splitProblem(proposed, goal.criteria.length);
  if (problem) throw new DaemonError('invalid', problem);
  if (goal.tasks.length + proposed.length > 50) throw new DaemonError('invalid', `a goal holds at most 50 tasks; ${id} has ${goal.tasks.length}`);
  const carried = proposed.map((p) => carryProofs(goal, p));
  // checked before any task is made, so a refused split makes none
  const over = carried.findIndex((c) => c.acceptance.length > 12);
  if (over >= 0) throw new DaemonError('invalid', `task ${over + 1} would have ${carried[over]?.acceptance.length} criteria once the goal's proven ones are added; a task holds at most 12`, 'cover fewer criteria with it, or drop some of its own acceptance lines');
  const decisions = standingGoalDecisions(goal.decisions, await sharpenStateOf(ctx, id));
  const limits = shareOf(goal.limits, proposed.length);
  const made: Task[] = [];
  for (const [i, p] of proposed.entries()) {
    const { acceptance, proofs } = carried[i] as (typeof carried)[number];
    let t = await ctx.ws.createTask({
      title: p.title,
      goal: p.goal,
      acceptance,
      goalId: id,
      goalCriteria: [...new Set(p.covers)].sort((a, b) => a - b),
      dependsOn: p.dependsOn.map((d) => (made[d] as Task).id),
      ...(limits ? { limits } : {}),
    });
    if (proofs.length) {
      t = await ctx.ws.writeTask(t.id, { proofs });
      await ctx.ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'proofs.set', payload: { proofs, from: [], goal: id } });
    }
    for (const d of decisions) {
      const entry = await ctx.ws.decisions(t.id).append({ text: d.text, by: 'goal', evidence: [`goal:${id}/${d.id}`] });
      await ctx.ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'decision.recorded', payload: { id: entry.id, text: entry.text, by: entry.by, goal: id }, links: [{ kind: 'decision', ref: entry.id }] });
    }
    made.push(t);
  }
  const ids = made.map((t) => t.id);
  await ctx.ws.updateGoal(id, (g) => ({ tasks: [...g.tasks, ...ids] }));
  await ctx.ws.workspaceEvents().append({ task: 'workspace', vendor: 'human', type: 'goal.tasks_created', payload: { goal: id, tasks: ids } });
  await setGoalStatus(ctx, id, 'running');
  if (ctx.ws.config.autopilot?.onCreate) for (const t of ids) await ctx.autopilot.start(t);
  return made;
}

export type GoalView = {
  goal: Goal;
  outcome: GoalOutcome;
  /** Each task's title, for the goal page and `stint goal show`. */
  titles: Record<string, string>;
  /** The goal's tasks in its order, each with its status and the tasks it waits for. */
  tasks: Array<{ id: string; title: string; status: Task['status']; dependsOn: string[] }>;
  sharpen: SharpenState;
  /** The latest split no tasks were made from yet, or null. */
  proposal: ProposedTask[] | null;
};

/**
 * A goal as the page and the CLI read it: its rollup from each task's outcome record, its sharpen state and any split
 * waiting to be made into tasks. A draft that has become ready, or a running goal its rollup calls done, says so first.
 * The subtasks and candidates under its tasks count towards its spend and builds, as its limits count them.
 */
export async function goalView(ctx: DaemonContext, id: string): Promise<GoalView> {
  let goal = await settleGoal(ctx, id);
  const all = await goalTasks(ctx, goal);
  const tasks = goal.tasks.flatMap((t) => all.filter((x) => x.id === t));
  const outcomes = await Promise.all(tasks.map((t) => taskOutcome(ctx.ws, t.id)));
  const under = await Promise.all(all.filter((t) => !goal.tasks.includes(t.id)).map((t) => taskOutcome(ctx.ws, t.id)));
  const outcome = goalOutcome(goal, outcomes, Object.fromEntries(tasks.map((t) => [t.id, t.goalCriteria ?? []])), under);
  if (goal.status === 'running' && outcome.result === 'done') goal = await setGoalStatus(ctx, id, 'done');
  const events = await goalEvents(ctx.ws, id);
  const planned = events.findLastIndex((e) => e.type === 'goal.planned');
  const proposal = planned > events.findLastIndex((e) => e.type === 'goal.tasks_created') ? ((events[planned]?.payload.tasks as ProposedTask[] | undefined) ?? null) : null;
  return {
    goal,
    outcome,
    titles: Object.fromEntries(tasks.map((t) => [t.id, t.title])),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dependsOn: t.dependsOn ?? [] })),
    sharpen: await sharpenStateOf(ctx, id),
    proposal,
  };
}

const CLOSED: Array<Task['status']> = ['done', 'approved', 'abandoned'];

/**
 * Puts every open task of the goal on autopilot, in the goal's order, which puts each task after the tasks it waits
 * for; a task whose dependencies are not merged waits on autopilot until they are. Returns the tasks it started.
 */
export async function runGoal(ctx: DaemonContext, id: string): Promise<string[]> {
  const goal = await ctx.ws.readGoal(id);
  if (goal.status === 'abandoned') throw new DaemonError('invalid', `${id} is abandoned`);
  if (!goal.tasks.length) throw new DaemonError('invalid', `${id} has no tasks yet`, `split it into tasks first: stint goal plan ${id}`);
  const started: string[] = [];
  for (const t of goal.tasks) {
    const task = await ctx.ws.readTask(t).catch(() => null);
    if (!task || CLOSED.includes(task.status)) continue;
    await ctx.autopilot.start(t);
    started.push(t);
  }
  return started;
}

/** Switches autopilot on again on each of the goal's tasks that it stopped at one of the goal's `raised` limits. */
export async function resumeAtGoalLimit(ctx: DaemonContext, goal: Goal, raised: string[]): Promise<string[]> {
  const resumed: string[] = [];
  for (const t of await goalTasks(ctx, goal)) {
    const events = await ctx.ws.events(t.id).read();
    const stop = events.findLastIndex((e) => e.type === 'autopilot.started' || e.type === 'autopilot.stopped');
    if (events[stop]?.type !== 'autopilot.stopped') continue;
    const start = events.findLastIndex((e) => e.type === 'autopilot.started');
    const hit = events.slice(start + 1, stop).findLast((e) => e.type === 'limit.reached' && e.payload.scope === 'goal');
    if (!hit || !raised.includes(String(hit.payload.limit))) continue;
    await ctx.autopilot.start(t.id);
    resumed.push(t.id);
  }
  return resumed;
}
