import { z } from 'zod';
import { TASK_ID } from './handoff';

export const OUTCOME_RESULTS = [
  'in_progress',
  'waiting_for_you',
  'stopped_at_limit',
  'stopped_needs_you',
  'rejected',
  'abandoned',
  'merged',
  'merged_reverted',
  'merged_followup',
  'merged_ci_failed',
  'merged_incident',
  'merged_held_up',
] as const;
export const OutcomeResultSchema = z.enum(OUTCOME_RESULTS);
export type OutcomeResult = z.infer<typeof OutcomeResultSchema>;

/** A criterion's state, from strongest to weakest (docs/metrics.md, How it went). */
export const CriterionStateSchema = z.enum(['proven', 'passing', 'failing', 'you_check', 'checked_by_you', 'not_checked']);
export type CriterionState = z.infer<typeof CriterionStateSchema>;

export const ProofKindSchema = z.enum(['test', 'scenario', 'check', 'human']);
export type ProofKind = z.infer<typeof ProofKindSchema>;

const count = z.int().min(0);
const ms = z.int().min(0);

export const OutcomeSchema = z.strictObject({
  version: z.literal('stint.outcome/1'),
  task: z.string().regex(TASK_ID),
  result: OutcomeResultSchema,
  resultLabel: z.string().min(1),
  criteria: z.array(
    z.strictObject({
      index: count,
      text: z.string().min(1),
      state: CriterionStateSchema,
      proof: z.strictObject({ kind: ProofKindSchema, ref: z.string().max(200) }).optional(),
      evidence: z.string().min(1),
    }),
  ),
  loops: z.strictObject({ builds: count, handoffs: count, reviewRounds: count }),
  /** The task's limits as it runs under them; null is no limit. */
  limits: z
    .strictObject({
      builds: count.nullable().optional(),
      handoffs: count.nullable().optional(),
      reviewRounds: count.nullable().optional(),
      usd: z.number().min(0).nullable().optional(),
      minutes: count.nullable().optional(),
    })
    .optional(),
  spend: z.strictObject({ usd: z.number().min(0), unpriced: count }),
  minutes: z.number().min(0),
  timeToFirstGreen: ms.optional(),
  timeToApprovalRequest: ms.optional(),
  approvalWait: ms.optional(),
  leadTime: ms.optional(),
  review: z.strictObject({
    rounds: count,
    verdicts: z.array(z.enum(['approve', 'request_changes', 'block'])),
    findings: z.strictObject({ total: count, bySeverity: z.strictObject({ blocker: count, major: count, minor: count, note: count }) }),
  }),
  handoffs: z.array(z.strictObject({ from: z.string().min(1), to: z.string().min(1), packetTokens: count })),
  afterMerge: z
    .strictObject({
      window: z.strictObject({ days: z.number().min(0), endsAt: z.iso.datetime({ offset: true }), mature: z.boolean() }),
      reverted: z.boolean(),
      followups: z.array(z.string().regex(TASK_ID)),
      ci: z.strictObject({ status: z.string().min(1), run: z.string().nullable() }).optional(),
      incidents: z.array(z.string().min(1)),
    })
    .optional(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;
