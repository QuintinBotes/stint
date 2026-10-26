import { z } from 'zod';
import { RUN_ID, RoleSchema, TASK_ID } from './handoff';

export const SkillProposalSchema = z.strictObject({
  version: z.literal('stint.skillProposal/1'),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
  roles: z.array(RoleSchema).min(1),
  tags: z.array(z.string()),
  rule: z.string().min(1).max(4000),
  examples: z.array(
    z.strictObject({
      task: z.string().regex(TASK_ID),
      run: z.string().regex(RUN_ID),
      diff: z.string().optional(),
    }),
  ),
  evidence: z.array(z.string().regex(/^T-[0-9]{4,}\/r[0-9]+#(F[0-9]+|reject)$/)).min(2),
  confidence: z.number().min(0).max(1),
  model: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
export type SkillProposal = z.infer<typeof SkillProposalSchema>;
