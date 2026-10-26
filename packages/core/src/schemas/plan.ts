import { z } from 'zod';
import { TASK_ID } from './handoff';

export const PlanSchema = z.strictObject({
  version: z.literal('stint.plan/1'),
  steps: z
    .array(
      z.strictObject({
        id: z.int().min(1),
        text: z.string().min(1).max(300),
        files: z.array(z.string()),
        test: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(12),
  filesToTouch: z.array(z.string()),
  risks: z.array(z.strictObject({ id: z.string().regex(/^R[0-9]+$/), text: z.string().max(300) })).max(8),
  decisions: z
    .array(z.strictObject({ text: z.string().max(200), why: z.string().max(300).optional() }))
    .max(8)
    .optional(),
  similarTasks: z.array(z.string().regex(TASK_ID)),
  /** Decisions and open findings on the files this task names, from the memory graph; the daemon fills it (R-036). */
  constraints: z
    .array(z.strictObject({ kind: z.enum(['decision', 'finding']), id: z.string().max(80), task: z.string().regex(TASK_ID), text: z.string().max(400), files: z.array(z.string()).max(20) }))
    .max(20)
    .optional(),
  /** A task too large for one run, split; dependsOn names earlier subtasks by their index (R-036). */
  subtasks: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(120),
        goal: z.string().min(1).max(2000),
        acceptance: z.array(z.string().min(1).max(300)).min(1).max(8),
        dependsOn: z.array(z.int().min(0)).max(5),
      }),
    )
    .max(6)
    .optional(),
  model: z.string().min(1),
  offline: z.boolean().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;
