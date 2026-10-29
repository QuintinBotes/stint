import { CRITERION_STATE_LABELS, type Goal, type GoalOutcome, type ProposedTask, type Task } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { getDaemon, postDaemon } from './client';
import { limitsFromFlags } from './limits';
import { repoRoot } from './repo';
import { sharpenAt } from './sharpen';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const money = (v: number) => `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)}`;
const STATUS: Record<Goal['status'], string> = { draft: 'draft', ready: 'ready', running: 'running', done: 'done', abandoned: 'abandoned' };

type View = { goal: Goal; outcome: GoalOutcome; titles: Record<string, string> };

/** Every value of a flag that may be given more than once (`--criterion a --criterion b`); citty keeps only the last. */
export function repeated(raw: string[], flag: string): string[] {
  const out: string[] = [];
  raw.forEach((a, i) => {
    if (a === `--${flag}` && raw[i + 1] !== undefined) out.push(raw[i + 1] as string);
    else if (a.startsWith(`--${flag}=`)) out.push(a.slice(flag.length + 3));
  });
  return out.map((v) => v.trim()).filter(Boolean);
}

const met = (o: GoalOutcome) => `${o.met} of ${o.criteria.length} ${o.criteria.length === 1 ? 'criterion' : 'criteria'} met`;
const spend = (o: GoalOutcome) => `${money(o.spend.usd)}${o.spend.limit === null ? '' : ` of ${money(o.spend.limit)}`}${o.spend.unpriced ? `, plus ${plural(o.spend.unpriced, 'unpriced call')}` : ''}`;

/** The rollup in lines, the way `stint outcome` prints a task: each criterion with its state and evidence, the tasks, spend and builds. */
export function goalLines({ goal, outcome: o, titles }: View): string[] {
  const lines = [`${goal.id}: ${goal.title} (${STATUS[goal.status]}), ${met(o)}`];
  for (const c of o.criteria) lines.push(`  ${c.index + 1}. ${CRITERION_STATE_LABELS[c.state]}: ${c.text}`, `     ${c.evidence}`);
  lines.push(`Tasks: ${o.tasks.length ? `${o.tasks.length}, ${o.merged} merged` : `none yet; split it with: stint goal plan ${goal.id}`}`);
  for (const t of o.tasks) lines.push(`  ${t.id} ${t.resultLabel}: ${titles[t.id] ?? ''}${t.covers.length ? ` (covers ${t.covers.join(', ')})` : ''}`);
  lines.push(`Spend: ${spend(o)}`, `Builds: ${o.builds.used}${o.builds.limit === null ? '' : ` of ${o.builds.limit}`}`, `Result: ${o.result === 'done' ? 'done' : goal.status === 'abandoned' ? 'abandoned' : 'in progress'}`);
  return lines;
}

/** A proposed split in lines: each task with the criteria it covers, the tasks it waits for, its goal and its checks. */
export function proposalLines(tasks: ProposedTask[]): string[] {
  return tasks.flatMap((t, i) => [
    `  ${i + 1}. ${t.title}${t.covers.length ? ` (covers ${t.covers.join(', ')}` : ' (covers no criterion'}${t.dependsOn.length ? `; after ${t.dependsOn.map((d) => d + 1).join(', ')})` : ')'}`,
    `     ${t.goal}`,
    ...t.acceptance.map((a) => `     - ${a}`),
  ]);
}

const newGoal = defineCommand({
  meta: { name: 'new', description: 'Make a goal: an outcome, the criteria that prove it, and limits for all its tasks' },
  args: {
    title: { type: 'positional', required: true, description: 'What the goal is, in a few words' },
    outcome: { type: 'string', required: true, description: 'What is true once the goal is met' },
    criterion: { type: 'string', description: 'A success criterion; give it once per criterion' },
    'non-goal': { type: 'string', description: 'Something the goal leaves out; give it once per item' },
    'max-usd': { type: 'string', description: 'Dollars all its tasks may spend together' },
    'max-builds': { type: 'string', description: 'Builds all its tasks may start together' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...repoArg,
  },
  async run({ args, rawArgs }) {
    const criteria = repeated(rawArgs, 'criterion');
    if (criteria.length === 0) {
      process.stderr.write('A goal needs at least one --criterion, the check that proves part of it.\n');
      process.exit(2);
    }
    const limits = limitsFromFlags(args);
    const goal = await postDaemon<Goal>(repoRoot(args.repo), '/api/goals', { title: args.title, outcome: args.outcome, criteria, nonGoals: repeated(rawArgs, 'non-goal'), ...(Object.keys(limits).length ? { limits } : {}) });
    process.stdout.write(args.json ? `${JSON.stringify(goal)}\n` : `${goal.id}\n`);
  },
});

const sharpenGoal = defineCommand({
  meta: { name: 'sharpen', description: 'Answer the few questions that change what the goal asks for, before it is split' },
  args: {
    goal: { type: 'positional', required: true, description: 'Goal id, e.g. G-0001' },
    recommended: { type: 'boolean', description: 'Take the recommendation for every question that is not material' },
    json: { type: 'boolean', description: 'Machine-readable output; asks nothing' },
    ...repoArg,
  },
  async run({ args }) {
    await sharpenAt(repoRoot(args.repo), `/api/goals/${args.goal}/sharpen`, args, 'Accept them on the goal page.');
  },
});

const planGoal = defineCommand({
  meta: { name: 'plan', description: 'Ask the planner to split the goal into tasks, then create them' },
  args: {
    goal: { type: 'positional', required: true, description: 'Goal id' },
    yes: { type: 'boolean', description: 'Create the proposed tasks without asking' },
    json: { type: 'boolean', description: 'Machine-readable output; creates the tasks only with --yes' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const { tasks } = await postDaemon<{ tasks: ProposedTask[] }>(root, `/api/goals/${args.goal}/plan`, {});
    if (!args.json) process.stdout.write(`${args.goal}: ${plural(tasks.length, 'proposed task')}\n${proposalLines(tasks).join('\n')}\n`);
    let create = !!args.yes;
    if (!create && !args.json) {
      process.stdout.write(`Create ${tasks.length === 1 ? 'this task' : `these ${tasks.length} tasks`}? [y/N] `);
      const line = await console[Symbol.asyncIterator]().next();
      create = !line.done && /^y(es)?$/i.test(String(line.value).trim());
    }
    if (!create) {
      if (args.json) process.stdout.write(`${JSON.stringify({ tasks, created: [] })}\n`);
      else process.stdout.write('Nothing was created. Run it again with --yes to create them.\n');
      return;
    }
    const made = await postDaemon<{ tasks: Task[] }>(root, `/api/goals/${args.goal}/tasks`, { tasks });
    process.stdout.write(args.json ? `${JSON.stringify({ tasks, created: made.tasks.map((t) => t.id) })}\n` : `Created ${made.tasks.map((t) => t.id).join(', ')}.\n`);
  },
});

const showGoal = defineCommand({
  meta: { name: 'show', description: "How a goal is going: each criterion's state from its tasks, the tasks' results, spend and builds" },
  args: {
    goal: { type: 'positional', required: true, description: 'Goal id' },
    json: { type: 'boolean', description: 'Machine-readable output: the goal and its rollup' },
    ...repoArg,
  },
  async run({ args }) {
    const v = await getDaemon<View>(repoRoot(args.repo), `/api/goals/${args.goal}`);
    process.stdout.write(args.json ? `${JSON.stringify({ goal: v.goal, outcome: v.outcome })}\n` : `${goalLines(v).join('\n')}\n`);
  },
});

const listGoals = defineCommand({
  meta: { name: 'list', description: 'Every goal with its status, criteria met, tasks and spend' },
  args: { json: { type: 'boolean', description: 'Machine-readable output' }, ...repoArg },
  async run({ args }) {
    const { goals } = await getDaemon<{ goals: Array<{ goal: Goal; outcome: GoalOutcome }> }>(repoRoot(args.repo), '/api/goals');
    if (args.json) {
      process.stdout.write(`${JSON.stringify(goals)}\n`);
      return;
    }
    if (!goals.length) {
      process.stdout.write('No goals yet. Make one with: stint goal new "<title>" --outcome "<what is true once it is met>" --criterion "<a check>"\n');
      return;
    }
    for (const { goal, outcome: o } of goals) process.stdout.write(`${goal.id}  ${STATUS[goal.status]}  ${met(o)}  ${plural(o.tasks.length, 'task')}  ${spend(o)}  ${goal.title}\n`);
  },
});

const runGoal = defineCommand({
  meta: { name: 'run', description: 'Put every open task of the goal on autopilot; a task waits for the tasks it depends on to be merged' },
  args: { goal: { type: 'positional', required: true, description: 'Goal id' }, json: { type: 'boolean', description: 'Machine-readable output' }, ...repoArg },
  async run({ args }) {
    const r = await postDaemon<{ started: string[]; running: string[]; queued: string[] }>(repoRoot(args.repo), `/api/goals/${args.goal}/run`, {});
    if (args.json) process.stdout.write(`${JSON.stringify(r)}\n`);
    else process.stdout.write(r.started.length ? `${args.goal}: ${r.started.join(', ')} on autopilot. Each stops at your approval, and a task waits for the tasks it depends on to be merged.\n` : `${args.goal}: every task is merged or abandoned, so there is nothing to start.\n`);
  },
});

const goalLimits = defineCommand({
  meta: { name: 'limits', description: "Show what a goal's tasks have spent and built against its limits, or change them" },
  args: {
    goal: { type: 'positional', required: true, description: 'Goal id' },
    'max-usd': { type: 'string', description: 'Dollars all its tasks may spend together' },
    'max-builds': { type: 'string', description: 'Builds all its tasks may start together' },
    none: { type: 'string', description: 'Take a limit off: usd or builds (both with a comma)' },
    json: { type: 'boolean', description: 'Machine-readable output' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const none = args.none ? args.none.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const other = none.find((n) => n !== 'usd' && n !== 'builds');
    if (other) {
      process.stderr.write(`--none takes usd or builds for a goal, not ${other}\n`);
      process.exit(2);
    }
    const change = limitsFromFlags(args, none);
    const resumed = Object.keys(change).length ? (await postDaemon<{ resumed: string[] }>(root, `/api/goals/${args.goal}/limits`, change, 'PATCH')).resumed : [];
    const { goal, outcome: o } = await getDaemon<View>(root, `/api/goals/${args.goal}`);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ limits: goal.limits ?? {}, spend: o.spend, builds: o.builds, resumed })}\n`);
      return;
    }
    const lines = [`Spend         ${spend(o)}${o.spend.limit === null ? ', no limit' : ''}`, `Builds        ${o.builds.used}${o.builds.limit === null ? ', no limit' : ` of ${o.builds.limit}`}`];
    if (resumed.length) lines.push(`Autopilot goes on with ${resumed.join(', ')}, which stopped at the limit you raised.`);
    process.stdout.write(`${lines.join('\n')}\n`);
  },
});

const abandonGoal = defineCommand({
  meta: { name: 'abandon', description: 'Give up a goal: it is not split or run again, and its tasks stay as they are' },
  args: { goal: { type: 'positional', required: true, description: 'Goal id' }, ...repoArg },
  async run({ args }) {
    const goal = await postDaemon<Goal>(repoRoot(args.repo), `/api/goals/${args.goal}/abandon`, {});
    process.stdout.write(`${goal.id} is abandoned.\n`);
  },
});

export const goalCommand = defineCommand({
  meta: { name: 'goal', description: 'An outcome bigger than one task: make it, sharpen it, split it into tasks, run them, see how it goes' },
  subCommands: { new: newGoal, sharpen: sharpenGoal, plan: planGoal, run: runGoal, show: showGoal, list: listGoals, limits: goalLimits, abandon: abandonGoal },
});
