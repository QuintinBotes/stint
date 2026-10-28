// Goals above tasks (R-064 Part 2): a goal's status, its split into tasks, and the tasks made from it.
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { type Goal, type GoalOutcome, GoalSplitSchema, type GoalStatus, type NewEvent, type ProposedTask, type SharpenState, type Task, type TaskLimits, goalOutcome } from '@stint-dev/core';
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

/**
 * Creates the tasks a person accepted, possibly edited, through the normal task creation path: each with the goal,
 * the goal criteria it covers, the tasks it waits for and its share of the goal's limits, and a ledger that starts
 * with the goal's decisions. The goal lists them, starts running and records `goal.tasks_created`.
 */
export async function createGoalTasks(ctx: DaemonContext, id: string, proposed: ProposedTask[]): Promise<Task[]> {
  const goal = await ctx.ws.readGoal(id);
  if (goal.status === 'abandoned') throw new DaemonError('invalid', `${id} is abandoned`);
  const problem = splitProblem(proposed, goal.criteria.length);
  if (problem) throw new DaemonError('invalid', problem);
  if (goal.tasks.length + proposed.length > 50) throw new DaemonError('invalid', `a goal holds at most 50 tasks; ${id} has ${goal.tasks.length}`);
  const decisions = standingGoalDecisions(goal.decisions, await sharpenStateOf(ctx, id));
  const limits = shareOf(goal.limits, proposed.length);
  const made: Task[] = [];
  for (const p of proposed) {
    const t = await ctx.ws.createTask({
      title: p.title,
      goal: p.goal,
      acceptance: p.acceptance,
      goalId: id,
      goalCriteria: [...new Set(p.covers)].sort((a, b) => a - b),
      dependsOn: p.dependsOn.map((d) => (made[d] as Task).id),
      ...(limits ? { limits } : {}),
    });
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
  sharpen: SharpenState;
  /** The latest split no tasks were made from yet, or null. */
  proposal: ProposedTask[] | null;
};

/**
 * A goal as the page and the CLI read it: its rollup from each task's outcome record, its sharpen state and any split
 * waiting to be made into tasks. A draft that has become ready, or a running goal its rollup calls done, says so first.
 */
export async function goalView(ctx: DaemonContext, id: string): Promise<GoalView> {
  let goal = await settleGoal(ctx, id);
  const tasks = (await Promise.all(goal.tasks.map((t) => ctx.ws.readTask(t).catch(() => null)))).filter((t): t is Task => !!t);
  const outcomes = await Promise.all(tasks.map((t) => taskOutcome(ctx.ws, t.id)));
  const outcome = goalOutcome(goal, outcomes, Object.fromEntries(tasks.map((t) => [t.id, t.goalCriteria ?? []])));
  if (goal.status === 'running' && outcome.result === 'done') goal = await setGoalStatus(ctx, id, 'done');
  const events = await goalEvents(ctx.ws, id);
  const planned = events.findLastIndex((e) => e.type === 'goal.planned');
  const proposal = planned > events.findLastIndex((e) => e.type === 'goal.tasks_created') ? ((events[planned]?.payload.tasks as ProposedTask[] | undefined) ?? null) : null;
  return { goal, outcome, titles: Object.fromEntries(tasks.map((t) => [t.id, t.title])), sharpen: await sharpenStateOf(ctx, id), proposal };
}
