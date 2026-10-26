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
  model: z.string().min(1),
  offline: z.boolean().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;
