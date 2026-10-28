import { z } from 'zod';
import { ProofKindSchema } from './task';

/**
 * What the sharpen model returns (R-064), mirroring schemas/questions.schema.json. It is the shape only: the rules a
 * question must meet are checked in code by `questionProblem`, so one bad question is dropped and the rest are kept.
 */
export const QuestionsSchema = z.strictObject({
  version: z.literal('stint.questions/1'),
  questions: z
    .array(
      z.strictObject({
        text: z.string().max(300),
        changes: z.string().max(40),
        evidence: z.string().max(400),
        options: z.array(z.strictObject({ label: z.string().max(120), consequence: z.string().max(300) })).max(6),
        recommendation: z.strictObject({ option: z.string().max(120), why: z.string().max(300) }),
        safeDefault: z.strictObject({ exists: z.boolean(), option: z.string().max(120).optional(), why: z.string().max(300).optional() }),
        blocks: z.array(z.int().min(1)).max(12),
        material: z.boolean(),
      }),
    )
    .max(12),
  assumed: z.array(z.strictObject({ text: z.string().min(1).max(300), why: z.string().max(300) })).max(12),
  proofs: z.array(z.strictObject({ criterion: z.int().min(1), kind: ProofKindSchema, ref: z.string().min(1).max(200), why: z.string().max(300) })).max(12),
});
export type Questions = z.infer<typeof QuestionsSchema>;
