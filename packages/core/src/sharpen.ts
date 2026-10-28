// Sharpen (R-064): the rules a question must meet, which questions are material, and a task's sharpen state as a pure
// projection of its log. The daemon asks the model; everything that decides what a person sees is here, in code.
import type { StintEvent } from './schemas/event';
import type { Questions } from './schemas/questions';
import type { Task, TaskProof } from './schemas/task';

export const SHARPEN_CHANGES = ['implementation', 'proof', 'scope', 'authority'] as const;
export type SharpenChange = (typeof SHARPEN_CHANGES)[number];

export type ModelQuestion = Questions['questions'][number];
/** A question that passed the rules, numbered across rounds, with `material` as the code decided it. */
export type SharpenQuestion = Omit<ModelQuestion, 'changes'> & { id: string; changes: SharpenChange };
export type SharpenAssumed = { id: string; text: string; why: string };
export type ProofSuggestion = Questions['proofs'][number];
export type DroppedQuestion = { text: string; reason: string };
/** The payload of `sharpen.asked`, less the host, model and cost the daemon adds. */
export type SharpenRound = { questions: SharpenQuestion[]; assumed: SharpenAssumed[]; proofs: ProofSuggestion[]; dropped: DroppedQuestion[] };
export type SharpenAnswer = { option?: string; text?: string; decision: string; by: string };

// what the repository can answer, and asks for permission or an opinion: neither is worth a person's time
const REPO_CAN_ANSWER = /\b(which files?|what versions?|where is|does the repo(sitory)?|what frameworks?)\b/i;
const PERMISSION = /\b(should i proceed|do you want me to|any thoughts|is that ok(ay)?)\b/i;
// a wrong answer here is costly or hard to undo, so the question is always asked
const MATERIAL = /\b(security|secure|auth|authentication|authori[sz]ation|permissions?|secrets?|privacy|personal (data|information)|pii|billing|payments?|prices?|pricing|money|delet(e|es|ed|ing|ion)|drop(s|ped|ping)?|migrat(e|es|ed|ing|ion|ions)|irreversibl[ey]|cannot be undone)\b/i;

/**
 * Why a question is not worth asking, or null when it meets every rule. `criteria` is how many acceptance criteria
 * the task has; `blocks` counts them from 1.
 */
export function questionProblem(q: ModelQuestion, criteria: number): string | null {
  const text = q.text.trim();
  if (REPO_CAN_ANSWER.test(text)) return 'the repository can answer it';
  if (PERMISSION.test(text)) return 'it asks for permission or an opinion, not a decision';
  if (!text.endsWith('?')) return 'it does not end in a question mark';
  if (text.split(/\s+/).length < 5) return 'it has fewer than 5 words';
  if (!(SHARPEN_CHANGES as readonly string[]).includes(q.changes)) return `changes is "${q.changes}", not implementation, proof, scope or authority`;
  if (!q.evidence.trim()) return 'it does not say what Stint found that raised it';
  if (q.options.length < 2 || q.options.length > 4) return `it has ${q.options.length} option${q.options.length === 1 ? '' : 's'}; a question needs 2 to 4`;
  const labels = q.options.map((o) => o.label);
  if (labels.some((l) => !l.trim())) return 'an option has no label';
  if (new Set(labels).size !== labels.length) return 'two options have the same label';
  const bare = q.options.find((o) => !o.consequence.trim());
  if (bare) return `option "${bare.label}" has no consequence`;
  if (!labels.includes(q.recommendation.option)) return 'the recommendation is not one of its options';
  if (!q.recommendation.why.trim()) return 'the recommendation does not say why';
  if (q.safeDefault.option !== undefined && !labels.includes(q.safeDefault.option)) return 'the safe default is not one of its options';
  const outside = q.blocks.find((b) => b > criteria);
  if (outside !== undefined) return `it blocks criterion ${outside}, which the task does not have`;
  return null;
}

/** Material when the model says so, or when the code finds a reason; the code only ever adds one, never takes it away. */
export function isMaterial(q: Pick<ModelQuestion, 'material' | 'safeDefault' | 'changes' | 'text' | 'options'>): boolean {
  if (q.material || !q.safeDefault.exists || q.changes === 'scope' || q.changes === 'authority') return true;
  return MATERIAL.test([q.text, ...q.options.flatMap((o) => [o.label, o.consequence])].join('\n'));
}

/**
 * One round from the model's answer: invalid questions dropped with their reason, the rest classified, material
 * first and at most `maxQuestions`; ids continue from the earlier rounds; one proof suggestion per criterion.
 */
export function sharpenRound(out: Questions, o: { criteria: number; maxQuestions: number; firstQuestion: number; firstAssumed: number }): SharpenRound {
  const dropped: DroppedQuestion[] = [];
  const valid: Array<Omit<SharpenQuestion, 'id'>> = [];
  for (const q of out.questions) {
    const reason = questionProblem(q, o.criteria);
    if (reason) dropped.push({ text: q.text.slice(0, 300), reason });
    else valid.push({ ...q, text: q.text.trim(), changes: q.changes as SharpenChange, material: isMaterial(q) });
  }
  const ordered = [...valid.filter((q) => q.material), ...valid.filter((q) => !q.material)];
  for (const q of ordered.slice(o.maxQuestions)) dropped.push({ text: q.text, reason: `a round asks at most ${o.maxQuestions} questions` });
  const seen = new Set<number>();
  return {
    questions: ordered.slice(0, o.maxQuestions).map((q, i) => ({ id: `Q${o.firstQuestion + i}`, ...q })),
    assumed: out.assumed.map((a, i) => ({ id: `A${o.firstAssumed + i}`, text: a.text, why: a.why })),
    proofs: out.proofs.filter((p) => p.criterion <= o.criteria && !seen.has(p.criterion) && !!seen.add(p.criterion)),
    dropped,
  };
}

export type SharpenState = {
  /** The latest round, 0 before any. */
  round: number;
  questions: Array<SharpenQuestion & { round: number; answered?: SharpenAnswer }>;
  /** Ids of the questions with no answer yet, and of those among them that are material. */
  open: string[];
  openMaterial: string[];
  assumed: Array<SharpenAssumed & { round: number; changed?: SharpenAnswer }>;
  /** Accepted proofs are the task's; suggestions are the latest per criterion; missing lists criteria (from 1) with no accepted proof. */
  proofs: { accepted: TaskProof[]; suggested: ProofSuggestion[]; missing: number[] };
  /** No material question is open and every criterion has an accepted proof. */
  ready: boolean;
};

/** A task's sharpen state from its log and its accepted proofs. */
export function sharpenState(events: StintEvent[], task: Pick<Task, 'acceptance' | 'proofs'>): SharpenState {
  let round = 0;
  const questions: SharpenState['questions'] = [];
  const assumed: SharpenState['assumed'] = [];
  const suggested = new Map<number, ProofSuggestion>();
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'sharpen.asked') {
      const r = Number(p.round) || round + 1;
      round = Math.max(round, r);
      for (const q of (p.questions as SharpenQuestion[] | undefined) ?? []) questions.push({ ...q, round: r });
      for (const a of (p.assumed as SharpenAssumed[] | undefined) ?? []) assumed.push({ ...a, round: r });
      for (const s of (p.proofs as ProofSuggestion[] | undefined) ?? []) suggested.set(s.criterion, s);
    }
    if (e.type === 'sharpen.answered') {
      const answer: SharpenAnswer = { ...(typeof p.option === 'string' ? { option: p.option } : {}), ...(typeof p.text === 'string' ? { text: p.text } : {}), decision: String(p.decision), by: String(p.by ?? 'you') };
      const q = questions.find((x) => x.id === p.question);
      if (q) q.answered = answer;
      const a = assumed.find((x) => x.id === p.assumption);
      if (a) a.changed = answer;
    }
  }
  const open = questions.filter((q) => !q.answered);
  const accepted = task.proofs ?? [];
  const missing = task.acceptance.map((_, i) => i + 1).filter((n) => !accepted.some((p) => p.criterion === n));
  const openMaterial = open.filter((q) => q.material).map((q) => q.id);
  return {
    round,
    questions,
    open: open.map((q) => q.id),
    openMaterial,
    assumed,
    proofs: { accepted, suggested: [...suggested.values()].sort((a, b) => a.criterion - b.criterion), missing },
    ready: openMaterial.length === 0 && missing.length === 0,
  };
}
