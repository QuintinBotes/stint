// The spec builder (R-066): a person's words become a draft spec in GitHub Spec Kit's shape with Sharpen's questions
// over what it cannot know, the answers fold back in, and the draft becomes a task or a goal. Drafting and refining
// are one planner-route call each, recorded as workspace spend; nothing else is written until the person creates.
import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import { DRAFT_ROUNDS, type Draft, type DraftAnswer, type DraftKind, type DraftOutput, DraftOutputSchema, answerProblem, closeOpen, draftFromOutput, draftProblem, goalFromDraft, mergeAnswers, nextRound, taskFromDraft } from '@stint-dev/core';
import type { DaemonContext } from './app';
import { draftPrompt, refinePrompt } from './draftPrompt';
import { DaemonError } from './errors';
import { git } from './git';
import { effectiveChain, walkChain } from './route';
import { answerSharpen, recordRound, setProofs } from './sharpen';

const EVIDENCE = 'spec builder';

/** One structured call on the planner route; what it cost goes to the workspace log as `cost.recorded { for: 'draft' }`. */
async function ask(ctx: DaemonContext, prompt: string, step: 'draft' | 'refine'): Promise<DraftOutput> {
  if (ctx.replayer.loaded) throw new DaemonError('forbidden', 'a replay calls no model, so it cannot draft a spec', 'open a Spec Kit spec, or write the task yourself');
  const r = await walkChain<{ value: DraftOutput }>({
    role: 'planner',
    chain: ctx.ws.config.routes.draft ?? effectiveChain('planner', ctx.ws.config.routes),
    hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
    call: (h, model, c) => h.complete(DraftOutputSchema, prompt, { model, timeoutMs: c.timeoutMs, maxTokens: ctx.ws.config.budgets.planner, emit: c.emit }),
  }).catch((err: unknown) => {
    throw new DaemonError('adapter_unavailable', 'no model could draft this spec', err instanceof Error ? err.message : String(err));
  });
  // a draft is not a task yet, so its spend is in the workspace log
  await ctx.ws.workspaceEvents().append({ task: 'workspace', vendor: 'daemon', type: 'cost.recorded', payload: { for: 'draft', step, host: r.host, model: r.model, cost: r.cost } });
  return ((r.value as { value?: DraftOutput }).value ?? r.value) as DraftOutput;
}

const tracked = async (ctx: DaemonContext) => (await git(ctx.ws.root, ['ls-files'])).stdout.split('\n').filter(Boolean).slice(0, 200);
const maxQuestions = (ctx: DaemonContext) => ctx.ws.config.sharpen?.maxQuestions ?? 5;

/** A draft and round 1 of its questions from the person's words; a kind they give stands over the model's. */
export async function draftSpec(ctx: DaemonContext, input: string, kind?: DraftKind): Promise<Draft> {
  const max = maxQuestions(ctx);
  const out = await ask(ctx, draftPrompt({ input, ...(kind ? { kind } : {}), files: await tracked(ctx), max }), 'draft');
  return draftFromOutput(out, { input, questions: [], assumed: [], answers: [], ...(kind ? { kind } : {}) }, max);
}

/** The answers folded into the draft, and the next round of questions; past the second round none is asked. */
export async function refineDraft(ctx: DaemonContext, draft: Draft, answers: DraftAnswer[]): Promise<Draft> {
  const merged = { ...draft, answers: mergeAnswers(draft.answers, answers) };
  const problem = answerProblem(merged);
  if (problem) throw new DaemonError('invalid', problem);
  const max = maxQuestions(ctx);
  const round = nextRound(merged);
  const out = await ask(ctx, refinePrompt({ draft: merged, round, last: round > DRAFT_ROUNDS, files: await tracked(ctx), max }), 'refine');
  return draftFromOutput(out, merged, max);
}

/**
 * The task or the goal a draft describes. Its questions become the new task's or goal's first Sharpen round and each
 * answer a decision on it, with "spec builder" as the evidence, so later rounds, the plan and every run keep them.
 * A goal's split is proposed for the person to check, one task per story or per tasks.md phase.
 */
export async function createFromDraft(ctx: DaemonContext, draft: Draft): Promise<{ kind: DraftKind; id: string }> {
  const problem = draftProblem(draft);
  if (problem) throw new DaemonError('invalid', problem);
  const d = closeOpen(draft, `Still open when the ${draft.kind} was made; change it if it matters.`);
  let id: string;
  if (d.kind === 'task') {
    const t = taskFromDraft(d);
    id = (await ctx.ws.createTask({ title: t.title, goal: t.goal, acceptance: t.acceptance })).id;
    await setProofs(ctx, id, t.proofs);
  } else {
    const g = goalFromDraft(d);
    const goal = await ctx.ws.createGoal({ title: g.title, outcome: g.outcome, criteria: g.criteria, nonGoals: g.nonGoals });
    id = goal.id;
    const log = ctx.ws.workspaceEvents();
    await log.append({ task: 'workspace', vendor: 'human', type: 'goal.created', payload: { goal: id, title: goal.title, criteria: goal.criteria.length, from: EVIDENCE } });
    await log.append({ task: 'workspace', vendor: 'daemon', type: 'goal.planned', payload: { goal: id, tasks: g.split, from: EVIDENCE } });
  }
  if (d.questions.length || d.assumed.length) {
    // a question blocks success criteria; a task's criteria are its acceptance lines, so the numbers would mislead there
    const questions = d.questions.map(({ round: _, ...q }) => (d.kind === 'task' ? { ...q, blocks: [] } : q));
    await recordRound(ctx, id, { round: 1, questions, assumed: d.assumed, proofs: [], dropped: [], from: EVIDENCE });
  }
  for (const a of d.answers) await answerSharpen(ctx, id, { question: a.question, ...(a.choice ? { option: a.choice } : {}), ...(a.text ? { text: a.text } : {}) }, 'you', false, EVIDENCE);
  if (d.kind === 'task' && ctx.ws.config.autopilot?.onCreate) await ctx.autopilot.start(id);
  return { kind: d.kind, id };
}
