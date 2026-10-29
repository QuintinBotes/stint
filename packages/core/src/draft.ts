// The spec builder (R-066): a draft's rounds of questions and what a draft becomes, as pure functions. The daemon asks
// the model; which questions a person sees and what gets created is decided here.
import type { Draft, DraftAnswer, DraftOutput, DraftScenario, DraftStory } from './schemas/draft';
import type { ProposedTask } from './schemas/goal';
import type { TaskProof } from './schemas/task';
import { sharpenRound } from './sharpen';

/** A draft asks at most two rounds of questions; after that, what is still open is listed as assumed. */
export const DRAFT_ROUNDS = 2;

/** What a draft keeps from before a model call: the person's words, their answers, and what earlier rounds asked. */
export type DraftBefore = Pick<Draft, 'input' | 'questions' | 'assumed' | 'answers'> & Partial<Pick<Draft, 'kind' | 'kindReason' | 'split'>>;

/** The round the next model call asks: one after the latest round that asked anything. */
export const nextRound = (d: Pick<Draft, 'questions'>): number => Math.max(0, ...d.questions.map((q) => q.round)) + 1;

/** Moves what is still open into `assumed`, so nothing the spec left unclear is lost once no one will ask about it. */
export function closeOpen(d: Draft, why: string): Draft {
  const assumed = [...d.assumed, ...d.open.map((o, i) => ({ id: `A${d.assumed.length + i + 1}`, text: `Still open: ${o.text}`.slice(0, 300), why }))];
  return { ...d, open: [], assumed };
}

/**
 * A draft from the model's answer. Its questions pass Sharpen's rules, with the success criteria as the criteria a
 * question may block, and are numbered after the earlier rounds'. A call past the last round keeps no question and
 * lists what is still open as assumed. A kind the person chose stands over the model's.
 */
export function draftFromOutput(out: DraftOutput, before: DraftBefore, maxQuestions: number): Draft {
  const round = nextRound(before);
  const last = round > DRAFT_ROUNDS;
  const asked = sharpenRound(
    { version: 'stint.questions/1', questions: last ? [] : out.questions, assumed: out.assumed, proofs: [] },
    { criteria: out.success.length, maxQuestions, firstQuestion: before.questions.length + 1, firstAssumed: before.assumed.length + 1 },
  );
  const kind = before.kind ?? out.kind;
  const draft: Draft = {
    version: 'stint.draft/1',
    input: before.input,
    ...out,
    kind,
    kindReason: before.kindReason ?? (kind === out.kind ? out.kindReason : `You asked for a ${kind}.`),
    questions: [...before.questions, ...asked.questions.map((q) => ({ ...q, round }))],
    assumed: [...before.assumed, ...asked.assumed],
    answers: before.answers,
    ...(before.split ? { split: before.split } : {}),
  };
  return last ? closeOpen(draft, `Still open after ${DRAFT_ROUNDS} rounds of questions; change it on the ${kind} if it matters.`) : draft;
}

/** Answers again to the same question replace the earlier one. */
export function mergeAnswers(earlier: DraftAnswer[], later: DraftAnswer[]): DraftAnswer[] {
  return [...new Map([...earlier, ...later].map((a) => [a.question, a])).values()];
}

/** Why a draft cannot be created as it is, or null: every answer names one of its questions and, by label, an option. */
export function draftProblem(d: Draft): string | null {
  for (const a of d.answers) {
    const q = d.questions.find((x) => x.id === a.question);
    if (!q) return `${a.question} is not a question of this draft`;
    if (a.choice !== undefined && !q.options.some((o) => o.label === a.choice)) return `"${a.choice}" is not an option of ${q.id}; its options are ${q.options.map((o) => o.label).join(', ')}`;
  }
  if (d.kind === 'goal' && d.success.length === 0) return 'a goal needs at least one success criterion (SC-001)';
  return null;
}

export const scenarioLine = (s: DraftScenario): string => `Given ${s.given}, when ${s.when}, then ${s.then}`.slice(0, 300);

/** P1 first; stories of one priority keep their order. */
const byPriority = (stories: DraftStory[]) => [...stories].sort((a, b) => a.priority.localeCompare(b.priority));
const section = (head: string, items: string[]) => (items.length ? `${head}:\n${items.map((i) => `- ${i}`).join('\n')}` : '');
// shortcut: a goal text past 2000 characters is cut; carry the spec.md into the task folder if specs grow that long
const prose = (parts: string[]) => parts.filter(Boolean).join('\n\n').slice(0, 2000);

/** The task schema's limit on acceptance lines. */
const ACCEPTANCE_MAX = 12;

/**
 * A task from a draft: one acceptance line per scenario, P1 first, each proven by its scenario. Lines past the task's
 * twelve go into the goal text with the requirements and what is not in scope, since a task has no field for either.
 */
export function taskFromDraft(d: Draft): { title: string; goal: string; acceptance: string[]; proofs: TaskProof[] } {
  const scenarios = byPriority(d.stories).flatMap((s) => s.scenarios);
  const kept = scenarios.slice(0, ACCEPTANCE_MAX);
  const requirements = [...d.requirements.map((r) => `${r.id}: ${r.text}`), ...scenarios.slice(ACCEPTANCE_MAX).map(scenarioLine)];
  return {
    title: d.title,
    goal: prose([d.summary, section('Requirements', requirements), section('Not in scope', d.nonGoals)]),
    acceptance: kept.map(scenarioLine),
    proofs: kept.map((s, i) => ({ criterion: i + 1, kind: 'scenario', ref: s.then.slice(0, 200) })),
  };
}

/**
 * A goal from a draft: its outcome, its success criteria and its non-goals, and a split to show before any task is
 * made: the imported tasks.md's phases, or one task per story, P1 first. Every success criterion describes the whole
 * goal, so each task covers all of them.
 */
export function goalFromDraft(d: Draft): { title: string; outcome: string; criteria: string[]; nonGoals: string[]; split: ProposedTask[] } {
  const covers = d.success.map((_, i) => i + 1);
  return {
    title: d.title,
    outcome: prose([d.summary, section('Requirements', d.requirements.map((r) => `${r.id}: ${r.text}`))]),
    criteria: d.success.map((s) => s.text),
    nonGoals: d.nonGoals,
    split: d.split ?? byPriority(d.stories).map((s) => ({ title: s.title, goal: `${s.title}: ${s.why}`.slice(0, 2000), acceptance: s.scenarios.map(scenarioLine), covers, dependsOn: [] })),
  };
}
