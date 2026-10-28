import { z } from 'zod';
import { TASK_ID } from './handoff';
import { GOAL_ID, ProofKindSchema, TaskLimitsSchema } from './task';

export const GoalStatusSchema = z.enum(['draft', 'ready', 'running', 'done', 'abandoned']);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

/** One goal decision: what sharpening the goal settled, copied into the ledger of each task made from it. */
export const GoalDecisionSchema = z.strictObject({
  id: z.string().regex(/^D[0-9]+$/),
  text: z.string().min(1).max(2000),
  by: z.string().min(1).max(80),
  at: z.iso.datetime({ offset: true }),
});
export type GoalDecision = z.infer<typeof GoalDecisionSchema>;

/** An outcome above tasks (R-064), mirroring schemas/goal.schema.json. Only spend and builds are enforced for a goal. */
export const GoalSchema = z.strictObject({
  version: z.literal('stint.goal/1'),
  id: z.string().regex(GOAL_ID),
  title: z.string().min(1).max(120),
  outcome: z.string().min(1).max(2000),
  criteria: z
    .array(z.strictObject({ text: z.string().min(1).max(300), proof: z.strictObject({ kind: ProofKindSchema, ref: z.string().min(1).max(200) }).optional() }))
    .min(1)
    .max(12),
  nonGoals: z.array(z.string().min(1).max(300)).max(8),
  limits: TaskLimitsSchema.optional(),
  status: GoalStatusSchema,
  tasks: z.array(z.string().regex(TASK_ID)).max(50),
  decisions: z.array(GoalDecisionSchema).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Goal = z.infer<typeof GoalSchema>;
