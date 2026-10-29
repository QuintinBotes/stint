import { z } from 'zod';
import { SHARPEN_CHANGES } from '../sharpen';
import { GoalSplitSchema } from './goal';
import { QuestionsSchema } from './questions';

const text = (max: number) => z.string().min(1).max(max);

export const DraftKindSchema = z.enum(['task', 'goal']);
export type DraftKind = z.infer<typeof DraftKindSchema>;

/**
 * How a scenario is proven once it is a task's acceptance line: a held-out scenario the agent cannot see, which is
 * also what no proof means, or what a page shows, with `ref` as `<path> :: <what should be seen>` (R-068). Flat, as the
 * other shapes a model writes are; a visual proof whose ref names no page is checked in code (`draftProblem`).
 */
export const DraftProofSchema = z.strictObject({ kind: z.enum(['scenario', 'visual']), ref: text(200).optional() });
export type DraftProof = z.infer<typeof DraftProofSchema>;

/** One acceptance scenario in Spec Kit's Given/When/Then shape, each part without its keyword, and how it is proven. */
export const DraftScenarioSchema = z.strictObject({ given: text(300), when: text(300), then: text(300), proof: DraftProofSchema.optional() });
export type DraftScenario = z.infer<typeof DraftScenarioSchema>;

export const DraftStorySchema = z.strictObject({
  title: text(120),
  priority: z.enum(['P1', 'P2', 'P3']),
  why: text(1000),
  scenarios: z.array(DraftScenarioSchema).min(1).max(6),
});
export type DraftStory = z.infer<typeof DraftStorySchema>;

/** What the model writes and the person edits: the spec itself, in Spec Kit's sections. */
const SPEC = {
  kind: DraftKindSchema,
  kindReason: text(300),
  title: text(120),
  summary: text(1000),
  stories: z.array(DraftStorySchema).min(1).max(6),
  requirements: z.array(z.strictObject({ id: z.string().regex(/^FR-[0-9]{3}$/), text: text(300) })).max(12),
  success: z.array(z.strictObject({ id: z.string().regex(/^SC-[0-9]{3}$/), text: text(300) })).max(8),
  edgeCases: z.array(text(300)).max(8),
  assumptions: z.array(text(300)).max(8),
  nonGoals: z.array(text(300)).max(8),
  /** The `[NEEDS CLARIFICATION: ...]` items. */
  open: z.array(z.strictObject({ id: z.string().regex(/^O[0-9]+$/), text: text(300) })).max(12),
};

const ModelQuestionSchema = QuestionsSchema.shape.questions.element;

/** A question that passed Sharpen's rules (R-064), numbered across rounds, with the round that asked it. */
export const DraftQuestionSchema = ModelQuestionSchema.extend({ id: z.string().regex(/^Q[0-9]+$/), round: z.int().min(1).max(2), changes: z.enum(SHARPEN_CHANGES) });

/** A person's answer: an option's label, their own words, or both. */
export const DraftAnswerSchema = z
  .strictObject({ question: z.string().regex(/^Q[0-9]+$/), choice: text(120).optional(), text: text(1000).optional() })
  .refine((a) => a.choice !== undefined || a.text !== undefined, { message: 'an answer needs a choice or your own words', path: ['choice'] });
export type DraftAnswer = z.infer<typeof DraftAnswerSchema>;

/**
 * A spec drafted with the person before a task or a goal exists (R-066), mirroring schemas/draft.schema.json. The
 * daemon writes nothing for it until the person creates, so the client holds it and sends it back whole.
 */
export const DraftSchema = z.strictObject({
  version: z.literal('stint.draft/1'),
  input: text(2000),
  ...SPEC,
  questions: z.array(DraftQuestionSchema).max(20),
  assumed: z.array(z.strictObject({ id: z.string().regex(/^A[0-9]+$/), text: text(300), why: z.string().max(300) })).max(40),
  answers: z.array(DraftAnswerSchema).max(20),
  /** A goal's split as an imported tasks.md gives it, one task per phase; without it a goal is split one task per story. */
  split: GoalSplitSchema.shape.tasks.optional(),
});
export type Draft = z.infer<typeof DraftSchema>;

/** What the model returns for a draft or a refine: the spec, and Sharpen's questions over what it cannot know. */
export const DraftOutputSchema = z.strictObject({ ...SPEC, questions: QuestionsSchema.shape.questions, assumed: QuestionsSchema.shape.assumed });
export type DraftOutput = z.infer<typeof DraftOutputSchema>;
