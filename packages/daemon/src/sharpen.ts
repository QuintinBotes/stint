// Sharpen a task or a goal before work starts (R-064): one model call asks the questions, the code in core decides
// which are worth a person's time, and every answer becomes a decision that the plan and the first build carry.
import { join } from 'node:path';
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { GOAL_ID, type NewEvent, type Questions, QuestionsSchema, type SharpenState, type StintEvent, type Task, type TaskProof, sharpenRound, sharpenState } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git } from './git';
import { effectiveChain, walkChain } from './route';
import { planMemory } from './routes/models';

const SCHEMA = join(import.meta.dir, '..', '..', 'core', 'schemas', 'questions.schema.json');

const list = (items: string[]) => (items.length ? items.join('\n') : '- none');

/**
 * What a round is about, a task or a goal, so one validator, one classifier and one set of routes serve both. A
 * task's criteria are its acceptance and its log is its own; a goal's are its criteria, its log is the workspace
 * log's events that name it, and its answers go to `goal.decisions`.
 */
type Subject = {
  noun: 'task' | 'goal';
  id: string;
  /** The criteria, counting from 1, and their accepted proofs. */
  criteria: string[];
  proofs: TaskProof[];
  /** The prompt's last section: the subject itself. */
  section: string;
  chain: string[];
  maxTokens: number;
  read(): Promise<StintEvent[]>;
  append(e: Omit<NewEvent, 'task'>): Promise<unknown>;
  /** The valid decisions, as prompt lines. */
  decisions(st: SharpenState): Promise<string[]>;
  /** Records an answer as a decision and returns its id. */
  decide(d: { text: string; by: string; evidence: string; supersedes?: string }): Promise<string>;
};

/** The goal decisions that stand: the latest answer to each question and the latest change to each assumption. */
export function standingGoalDecisions<D extends { id: string }>(decisions: D[], st: SharpenState): D[] {
  const latest = new Set([...st.questions.map((q) => q.answered?.decision), ...st.assumed.map((a) => a.changed?.decision)]);
  return decisions.filter((d) => latest.has(d.id));
}

/** A goal's own events in the workspace log. */
export async function goalEvents(ws: Workspace, id: string): Promise<StintEvent[]> {
  return (await ws.workspaceEvents().read()).filter((e) => e.payload.goal === id);
}

async function subjectOf(ctx: DaemonContext, id: string): Promise<Subject> {
  const ws = ctx.ws;
  if (GOAL_ID.test(id)) {
    const goal = await ws.readGoal(id);
    return {
      noun: 'goal',
      id,
      criteria: goal.criteria.map((c) => c.text),
      proofs: goal.criteria.flatMap((c, i) => (c.proof ? [{ criterion: i + 1, ...c.proof }] : [])),
      section: `## The goal
Id: ${goal.id}
Title: ${goal.title}
Outcome: ${goal.outcome}
Criteria:
${goal.criteria.map((c, n) => `${n + 1}. ${c.text}`).join('\n')}
Not in scope: ${goal.nonGoals.length ? goal.nonGoals.join('; ') : 'nothing named'}`,
      chain: ws.config.routes.sharpen ?? effectiveChain('planner', ws.config.routes),
      maxTokens: ws.config.budgets.planner,
      read: () => goalEvents(ws, id),
      append: (e) => ws.workspaceEvents().append({ ...e, task: 'workspace', payload: { goal: id, ...e.payload } }),
      decisions: async (st) => standingGoalDecisions((await ws.readGoal(id)).decisions, st).map((d) => `- ${d.id}: ${d.text}`),
      decide: async (d) => {
        // the next id is taken inside the edit, so two answers at once never share one
        const at = new Date().toISOString();
        const g = await ws.updateGoal(id, (now) => ({ decisions: [...now.decisions, { id: `D${now.decisions.length + 1}`, text: d.text.slice(0, 2000), by: d.by, at }] }));
        return (g.decisions.at(-1) as { id: string }).id;
      },
    };
  }
  const task = await ws.readTask(id);
  const log = ws.events(id);
  return {
    noun: 'task',
    id,
    criteria: task.acceptance,
    proofs: task.proofs ?? [],
    section: `## The task
Id: ${task.id}
Title: ${task.title}
Goal: ${task.goal}
Acceptance:
${task.acceptance.map((a, n) => `${n + 1}. ${a}`).join('\n')}
Test command: ${task.testCommand}
Checks: ${task.checks?.length ? task.checks.map((c) => `${c.name} (${c.kind}): ${c.command}`).join('; ') : 'none'}`,
    chain: ws.config.routes.sharpen ?? effectiveChain('planner', ws.config.routes, task.routes),
    maxTokens: task.budgets.planner,
    read: () => log.read(),
    append: (e) => log.append({ ...e, task: id }),
    decisions: async () => (await ws.decisions(id).validAt()).map((d) => `- ${d.id}: ${d.text}`),
    decide: async ({ text, by, evidence, supersedes }) => {
      const d = await ws.decisions(id).append({ text, by, evidence: [evidence], ...(supersedes ? { supersedes } : {}) });
      await log.append({ task: id, vendor: by === 'you' ? 'human' : 'daemon', type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by, ...(supersedes ? { supersedes } : {}) }, links: [{ kind: 'decision', ref: d.id }] });
      return d.id;
    },
  };
}

function sharpenPrompt(s: Subject, i: { round: number; max: number; similar: string[]; constraints: string[]; files: string[]; decisions: string[]; earlier: string[] }): string {
  return `You sharpen a ${s.noun} for Stint before any agent works on it. Return only JSON matching the schema given with this prompt. Set version to "stint.questions/1".

Ask only the few questions whose answers change what gets built (implementation), how a criterion is proven (proof), what is in or out of scope (scope), or who may decide or do something (authority). For each question:
- write it as a question of at least 5 words that ends in "?";
- say in evidence what you found in the ${s.noun}, the files or the memory below that raised it;
- give 2 to 4 options with distinct labels, each with its consequence;
- recommend one option by its exact label, and say why;
- say whether a safe default exists, an answer that is cheap to reverse later, and give its label;
- list in blocks the numbers of the criteria the answer affects;
- set material to true when a wrong answer is costly or hard to undo.
Never ask what the repository can answer (which file, what version, where something is, what framework), and never ask for permission or an opinion. Settle reversible details yourself and list them under assumed, each with why. Suggest one proof per criterion: a test (a test name or part of one), a scenario, a check (a check name) or human (what a person checks), with ref and why.

## Similar tasks
${list(i.similar)}

## Constraints on the files this ${s.noun} touches
${list(i.constraints)}

## Tracked files (the first ${i.files.length})
${list(i.files)}

## Decisions on this ${s.noun}
${list(i.decisions)}

## Earlier rounds
${list(i.earlier)}

${s.section}

## Ask
Write round ${i.round} now. Ask at most ${i.max} questions, and none that an earlier round asked.`;
}

const stateOf = async (s: Subject) => sharpenState(await s.read(), { acceptance: s.criteria, proofs: s.proofs });

/** The sharpen state of a task or a goal, from its log and its accepted proofs. */
export async function sharpenStateOf(ctx: DaemonContext, id: string): Promise<SharpenState> {
  return stateOf(await subjectOf(ctx, id));
}

/**
 * Starts a round: the sharpen chain (the planner chain unless `routes.sharpen` is set) is asked once, every question is
 * checked in code, and `sharpen.asked` records what is kept, what was dropped and why, and what the call cost.
 */
export async function sharpen(ctx: DaemonContext, id: string): Promise<SharpenState> {
  const s = await subjectOf(ctx, id);
  if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'sharpen before work starts, or once the run ends');
  const before = await stateOf(s);
  // a goal is not a task yet, so the memory has nothing to say about its files
  const memory = s.noun === 'task' ? await planMemory(ctx, id, await ctx.ws.readDoc<unknown>(id, 'context.json')) : { similar: [], constraints: [] };
  const files = (await git(ctx.ws.root, ['ls-files'])).stdout.split('\n').filter(Boolean).slice(0, 200);
  const max = ctx.ws.config.sharpen?.maxQuestions ?? 5;
  const prompt = sharpenPrompt(s, {
    round: before.round + 1,
    max,
    similar: memory.similar.map((t) => `- ${t.id} ${t.title}: ${t.summary}`),
    constraints: memory.constraints.map((c) => `- ${c.kind} ${c.id} (${c.task}, on ${c.files.join(', ')}): ${c.text}`),
    files: files.map((f) => `- ${f}`),
    decisions: await s.decisions(before),
    earlier: [
      ...before.questions.map((q) => `- ${q.id} (round ${q.round}): ${q.text} ${q.answered ? `Answered: ${[q.answered.option, q.answered.text].filter(Boolean).join(', ')}` : 'Not answered yet.'}`),
      ...before.assumed.map((a) => `- ${a.id} assumed: ${a.text}${a.changed ? ` Changed to: ${a.changed.text}` : ''}`),
    ],
  });
  const jsonSchema = JSON.parse(await Bun.file(SCHEMA).text());
  const r = await walkChain<{ value: Questions }>({
    role: 'sharpen',
    chain: s.chain,
    hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
    emit: (e) => s.append({ vendor: 'daemon', type: e.type as NewEvent['type'], payload: e.payload }).then(() => undefined),
    call: (h, model, c) => h.complete(QuestionsSchema, jsonSchema, prompt, { model, timeoutMs: c.timeoutMs, maxTokens: s.maxTokens, emit: c.emit }),
  }).catch((err: unknown) => {
    throw new DaemonError('adapter_unavailable', `no model could sharpen this ${s.noun}`, err instanceof Error ? err.message : String(err));
  });
  const value = ((r.value as { value?: Questions }).value ?? r.value) as Questions;
  const round = sharpenRound(value, { criteria: s.criteria.length, maxQuestions: max, firstQuestion: before.questions.length + 1, firstAssumed: before.assumed.length + 1 });
  await s.append({ vendor: 'daemon', type: 'sharpen.asked', payload: { round: before.round + 1, ...round, host: r.host, model: r.model, cost: r.cost } });
  return stateOf(s);
}

export type SharpenAnswerInput = { question?: string; assumption?: string; option?: string; text?: string };

/**
 * Answers a question or changes an assumption: `sharpen.answered`, and a decision that pairs the question with the
 * answer, with `sharpen:<id>` as its evidence unless another is given. On a task, answering again supersedes the earlier decision; on a goal,
 * the latest answer is the one that stands. Returns the decision id.
 */
export async function answerSharpen(ctx: DaemonContext, id: string, input: SharpenAnswerInput, by: 'you' | 'autopilot', recommended = false, evidence?: string): Promise<string> {
  const s = await subjectOf(ctx, id);
  const st = await stateOf(s);
  const text = input.text?.trim() || undefined;
  let said: string;
  let ref: string;
  let previous: string | undefined;
  if (input.question) {
    const q = st.questions.find((x) => x.id === input.question);
    if (!q) throw new DaemonError('not_found', `${id} has no question ${input.question}`);
    if (input.option !== undefined && !q.options.some((o) => o.label === input.option)) throw new DaemonError('invalid', `"${input.option}" is not an option of ${q.id}`, q.options.map((o) => o.label).join(', '));
    if (input.option === undefined && !text) throw new DaemonError('invalid', `answering ${q.id} needs an option or your own words`);
    said = `${q.text} Answer: ${[input.option, text].filter(Boolean).join(', ')}${recommended ? ' (the recommendation)' : ''}`;
    ref = q.id;
    previous = q.answered?.decision;
  } else {
    const a = st.assumed.find((x) => x.id === input.assumption);
    if (!a) throw new DaemonError('not_found', `${id} has no assumption ${input.assumption ?? ''}`.trim());
    if (!text) throw new DaemonError('invalid', `changing ${a.id} needs your own words`);
    said = `Assumed: ${a.text} Changed to: ${text}`;
    ref = a.id;
    previous = a.changed?.decision;
  }
  const decision = await s.decide({ text: said, by, evidence: evidence ?? `sharpen:${ref}`, ...(previous ? { supersedes: previous } : {}) });
  await s.append({ vendor: by === 'you' ? 'human' : 'daemon', type: 'sharpen.answered', payload: { [input.question ? 'question' : 'assumption']: ref, ...(input.option !== undefined ? { option: input.option } : {}), ...(text ? { text } : {}), decision, by, ...(recommended ? { recommended } : {}) } });
  return decision;
}

/** Records a round asked before the task or goal existed, the spec builder's, as its own, so its answers stand like any other. */
export async function recordRound(ctx: DaemonContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await (await subjectOf(ctx, id)).append({ vendor: 'daemon', type: 'sharpen.asked', payload });
}

/** Takes the recommendation for every open question that is not material; material ones wait for a person. */
export async function takeRecommendations(ctx: DaemonContext, id: string, by: 'you' | 'autopilot'): Promise<string[]> {
  const st = await sharpenStateOf(ctx, id);
  const out: string[] = [];
  for (const q of st.questions.filter((x) => !x.answered && !x.material)) out.push(await answerSharpen(ctx, id, { question: q.id, option: q.recommendation.option }, by, true));
  return out;
}

/** Accepts the proof of each criterion: a task's go to `task.proofs`, which the outcome record reads; a goal's to its criteria. */
export async function setProofs(ctx: DaemonContext, id: string, proofs: TaskProof[]): Promise<TaskProof[]> {
  const s = await subjectOf(ctx, id);
  const outside = proofs.find((p) => p.criterion > s.criteria.length);
  if (outside) throw new DaemonError('invalid', `${id} has no criterion ${outside.criterion}`, `it has ${s.criteria.length}`);
  if (new Set(proofs.map((p) => p.criterion)).size !== proofs.length) throw new DaemonError('invalid', 'one proof per criterion');
  const sorted = [...proofs].sort((a, b) => a.criterion - b.criterion);
  if (s.noun === 'goal') {
    const criteria = (g: { criteria: Array<{ text: string }> }) =>
      g.criteria.map(({ text }, i) => {
        const p = sorted.find((x) => x.criterion === i + 1);
        return p ? { text, proof: { kind: p.kind, ref: p.ref } } : { text };
      });
    await ctx.ws.updateGoal(id, (g) => ({ criteria: criteria(g) }));
  } else await ctx.ws.writeTask(id, { proofs: sorted });
  await s.append({ vendor: 'human', type: 'proofs.set', payload: { proofs: sorted, from: s.proofs } });
  return sorted;
}

/**
 * What sharpening settled, for the planner prompt and the first build's ask: the answers as decisions (the task's own
 * and those it took from its goal), the assumptions no one changed, and the accepted proofs. Empty when nothing was
 * settled, so an unsharpened task's prompts do not change.
 */
export async function sharpenBrief(ws: Workspace, task: Task): Promise<string> {
  const st = sharpenState(await ws.events(task.id).read(), task);
  const settled = [
    ...(await ws.decisions(task.id).validAt()).filter((d) => d.evidence.some((e) => e.startsWith('sharpen:') || e.startsWith('goal:') || e === 'spec builder')).map((d) => `- ${d.id}: ${d.text}`),
    ...st.assumed.filter((a) => !a.changed).map((a) => `- Assumed ${a.id}: ${a.text}`),
  ];
  const proofs = (task.proofs ?? []).map((p) => `- Criterion ${p.criterion} (${task.acceptance[p.criterion - 1] ?? 'not in the task'}): ${p.kind} "${p.ref}"`);
  return [...(settled.length ? ['Settled before work started:', ...settled] : []), ...(settled.length && proofs.length ? [''] : []), ...(proofs.length ? ['How each criterion is proven:', ...proofs] : [])].join('\n');
}
