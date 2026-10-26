import { z } from 'zod';
import { CostSchema, DECISION_ID, RUN_ID } from './handoff';

export const SeveritySchema = z.enum(['blocker', 'major', 'minor', 'note']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.strictObject({
  id: z.string().regex(/^F[0-9]+$/),
  severity: SeveritySchema,
  file: z.string().optional(),
  line: z.int().min(1).optional(),
  text: z.string().min(1).max(400),
  linksTo: z.string().optional(),
  contradictsDecision: z.string().regex(DECISION_ID).optional(),
  resolvedBy: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const NO_FINDINGS = 'No actionable findings.';

export const ReviewSchema = z
  .strictObject({
    version: z.literal('stint.review/1'),
    verdict: z.enum(['approve', 'request_changes', 'block']),
    summary: z.string().max(400).optional(),
    findings: z.array(FindingSchema).max(20),
    blockers: z.array(z.string().max(300)),
    model: z.string().min(1),
    offline: z.boolean(),
    cost: CostSchema.optional(),
    run: z.string().regex(RUN_ID).optional(),
    createdAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((r) => r.findings.length > 0 || r.verdict === 'approve', {
    path: ['verdict'],
    message: 'a review with no findings must approve',
  });
export type Review = z.infer<typeof ReviewSchema>;
