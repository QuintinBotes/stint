// Sharpen a task before work starts (R-064): one model call asks the questions, the code in core decides which are
// worth a person's time, and every answer becomes a decision that the plan and the first build carry.
import { join } from 'node:path';
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { type Questions, QuestionsSchema, type SharpenState, type Task, sharpenRound, sharpenState } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git } from './git';
import { effectiveChain, walkChain } from './route';
import { planMemory } from './routes/models';

const SCHEMA = join(import.meta.dir, '..', '..', 'core', 'schemas', 'questions.schema.json');

const list = (items: string[]) => (items.length ? items.join('\n') : '- none');

function sharpenPrompt(task: Task, i: { round: number; max: number; similar: string[]; constraints: string[]; files: string[]; decisions: string[]; earlier: string[] }): string {
  return `You sharpen a task for Stint before any agent works on it. Return only JSON matching the schema given with this prompt. Set version to "stint.questions/1".

Ask only the few questions whose answers change what gets built (implementation), how a criterion is proven (proof), what is in or out of scope (scope), or who may decide or do something (authority). For each question:
- write it as a question of at least 5 words that ends in "?";
- say in evidence what you found in the task, the files or the memory below that raised it;
- give 2 to 4 options with distinct labels, each with its consequence;
- recommend one option by its exact label, and say why;
- say whether a safe default exists, an answer that is cheap to reverse later, and give its label;
- list in blocks the numbers of the criteria the answer affects;
- set material to true when a wrong answer is costly or hard to undo.
Never ask what the repository can answer (which file, what version, where something is, what framework), and never ask for permission or an opinion. Settle reversible details yourself and list them under assumed, each with why. Suggest one proof per criterion: a test (a test name or part of one), a scenario, a check (a check name) or human (what a person checks), with ref and why.

## Similar tasks
${list(i.similar)}

## Constraints on the files this task touches
${list(i.constraints)}

## Tracked files (the first ${i.files.length})
${list(i.files)}

## Decisions on this task
${list(i.decisions)}

## Earlier rounds
${list(i.earlier)}

## The task
Id: ${task.id}
Title: ${task.title}
Goal: ${task.goal}
Acceptance:
${task.acceptance.map((a, n) => `${n + 1}. ${a}`).join('\n')}
Test command: ${task.testCommand}
Checks: ${task.checks?.length ? task.checks.map((c) => `${c.name} (${c.kind}): ${c.command}`).join('; ') : 'none'}

## Ask
Write round ${i.round} now. Ask at most ${i.max} questions, and none that an earlier round asked.`;
}

/**
 * Starts a round: the sharpen chain (the planner chain unless `routes.sharpen` is set) is asked once, every question is
 * checked in code, and `sharpen.asked` records what is kept, what was dropped and why, and what the call cost.
 */
export async function sharpen(ctx: DaemonContext, id: string): Promise<SharpenState> {
  const task = await ctx.ws.readTask(id);
  if (ctx.runs.get(id)) throw new DaemonError('run_active', `${id} has a live run`, 'sharpen before work starts, or once the run ends');
  const log = ctx.ws.events(id);
  const before = sharpenState(await log.read(), task);
  const memory = await planMemory(ctx, id, await ctx.ws.readDoc<unknown>(id, 'context.json'));
  const files = (await git(ctx.ws.root, ['ls-files'])).stdout.split('\n').filter(Boolean).slice(0, 200);
  const max = ctx.ws.config.sharpen?.maxQuestions ?? 5;
  const prompt = sharpenPrompt(task, {
    round: before.round + 1,
    max,
    similar: memory.similar.map((t) => `- ${t.id} ${t.title}: ${t.summary}`),
    constraints: memory.constraints.map((c) => `- ${c.kind} ${c.id} (${c.task}, on ${c.files.join(', ')}): ${c.text}`),
    files: files.map((f) => `- ${f}`),
    decisions: (await ctx.ws.decisions(id).validAt()).map((d) => `- ${d.id}: ${d.text}`),
    earlier: [
      ...before.questions.map((q) => `- ${q.id} (round ${q.round}): ${q.text} ${q.answered ? `Answered: ${[q.answered.option, q.answered.text].filter(Boolean).join(', ')}` : 'Not answered yet.'}`),
      ...before.assumed.map((a) => `- ${a.id} assumed: ${a.text}${a.changed ? ` Changed to: ${a.changed.text}` : ''}`),
    ],
  });
  const chain = ctx.ws.config.routes.sharpen ?? effectiveChain('planner', ctx.ws.config.routes, task.routes);
  const jsonSchema = JSON.parse(await Bun.file(SCHEMA).text());
  const r = await walkChain<{ value: Questions }>({
    role: 'sharpen',
    chain,
    hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
    emit: (e) => log.append({ task: id, vendor: 'daemon', type: e.type, payload: e.payload }).then(() => undefined),
    call: (h, model, c) => h.complete(QuestionsSchema, jsonSchema, prompt, { model, timeoutMs: c.timeoutMs, maxTokens: task.budgets.planner, emit: c.emit }),
  }).catch((err: unknown) => {
    throw new DaemonError('adapter_unavailable', 'no model could sharpen this task', err instanceof Error ? err.message : String(err));
  });
  const value = ((r.value as { value?: Questions }).value ?? r.value) as Questions;
  const round = sharpenRound(value, { criteria: task.acceptance.length, maxQuestions: max, firstQuestion: before.questions.length + 1, firstAssumed: before.assumed.length + 1 });
  await log.append({ task: id, vendor: 'daemon', type: 'sharpen.asked', payload: { round: before.round + 1, ...round, host: r.host, model: r.model, cost: r.cost } });
  return sharpenState(await log.read(), task);
}

export type SharpenAnswerInput = { question?: string; assumption?: string; option?: string; text?: string };

/**
 * Answers a question or changes an assumption: `sharpen.answered`, and a decision that pairs the question with the
 * answer, with `sharpen:<id>` as its evidence. Answering again supersedes the earlier decision. Returns its id.
 */
export async function answerSharpen(ctx: DaemonContext, id: string, input: SharpenAnswerInput, by: 'you' | 'autopilot', recommended = false): Promise<string> {
  const task = await ctx.ws.readTask(id);
  const st = sharpenState(await ctx.ws.events(id).read(), task);
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
  const d = await ctx.ws.decisions(id).append({ text: said, by, evidence: [`sharpen:${ref}`], ...(previous ? { supersedes: previous } : {}) });
  const vendor = by === 'you' ? ('human' as const) : ('daemon' as const);
  const events = ctx.ws.events(id);
  await events.append({ task: id, vendor, type: 'sharpen.answered', payload: { [input.question ? 'question' : 'assumption']: ref, ...(input.option !== undefined ? { option: input.option } : {}), ...(text ? { text } : {}), decision: d.id, by, ...(recommended ? { recommended } : {}) } });
  await events.append({ task: id, vendor, type: 'decision.recorded', payload: { id: d.id, text: d.text, by: d.by, ...(previous ? { supersedes: previous } : {}) }, links: [{ kind: 'decision', ref: d.id }] });
  return d.id;
}

/** Takes the recommendation for every open question that is not material; material ones wait for a person. */
export async function takeRecommendations(ctx: DaemonContext, id: string, by: 'you' | 'autopilot'): Promise<string[]> {
  const st = sharpenState(await ctx.ws.events(id).read(), await ctx.ws.readTask(id));
  const out: string[] = [];
  for (const q of st.questions.filter((x) => !x.answered && !x.material)) out.push(await answerSharpen(ctx, id, { question: q.id, option: q.recommendation.option }, by, true));
  return out;
}

/**
 * What sharpening settled, for the planner prompt and the first build's ask: the answers as decisions, the assumptions
 * no one changed, and the accepted proofs. Empty when nothing was settled, so an unsharpened task's prompts do not change.
 */
export async function sharpenBrief(ws: Workspace, task: Task): Promise<string> {
  const st = sharpenState(await ws.events(task.id).read(), task);
  const settled = [
    ...(await ws.decisions(task.id).validAt()).filter((d) => d.evidence.some((e) => e.startsWith('sharpen:'))).map((d) => `- ${d.id}: ${d.text}`),
    ...st.assumed.filter((a) => !a.changed).map((a) => `- Assumed ${a.id}: ${a.text}`),
  ];
  const proofs = (task.proofs ?? []).map((p) => `- Criterion ${p.criterion} (${task.acceptance[p.criterion - 1] ?? 'not in the task'}): ${p.kind} "${p.ref}"`);
  return [...(settled.length ? ['Settled before work started:', ...settled] : []), ...(settled.length && proofs.length ? [''] : []), ...(proofs.length ? ['How each criterion is proven:', ...proofs] : [])].join('\n');
}
