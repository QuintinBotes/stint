import { z } from 'zod';
import { CostSchema, EndedBySchema, RUN_ID } from './handoff';

export const EVENT_TYPES = [
  'task.created',
  'task.status',
  'run.started',
  'run.finished',
  'run.refused',
  'agent.message',
  'agent.tool_call',
  'agent.tool_result',
  'human.command',
  'file.changed',
  'decision.recorded',
  'verification.ran',
  'review.recorded',
  'handoff.created',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'rule.blocked',
  'skill.applied',
  'skill.proposed',
  'skill.approved',
  'skill.rejected',
  'merge.completed',
  'learn.skipped',
  'autopilot.started',
  'autopilot.step',
  'autopilot.stopped',
  'handoff.quizzed',
  'acceptance.locked',
  'acceptance.tampered',
  'verification.tampered',
  'scenario.ran',
  'outcome.reverted',
  'outcome.followup',
  'outcome.ci',
  'outcome.incident',
  'skill.evaluated',
  'skill.status',
  'skill.retire_proposed',
  'skill.imported',
  'skill.edit_proposed',
  'skill.unreviewed',
  'permission.requested',
  'permission.decided',
  'risk.assessed',
  'autoapprove.shadow',
  'autoapprove.granted',
  'intake.received',
  'intake.triaged',
  'release.pr_opened',
  'release.checks',
  'task.decomposed',
  'routing.chosen',
  'eval.ran',
  'bestofn.started',
  'bestofn.picked',
  'escalation.triggered',
  'provider.fallback',
  'cost.unpriced',
  'cost.recorded',
  'limit.reached',
  'limits.changed',
  'sharpen.asked',
  'sharpen.answered',
  'proofs.set',
  'goal.created',
  'goal.planned',
  'goal.tasks_created',
  'goal.status',
  'runtime.unclassified',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventVendorSchema = z.enum(['meta', 'openai', 'anthropic', 'local', 'other', 'human', 'daemon']);
export type EventVendor = z.infer<typeof EventVendorSchema>;

export const RawPointerSchema = z.strictObject({
  kind: z.enum(['transcript', 'stdout', 'stderr', 'file']),
  pointer: z.string(),
  byteLen: z.int().min(0),
  redacted: z.boolean(),
});

export const LinkSchema = z.strictObject({
  kind: z.enum(['file', 'diffHunk', 'decision', 'finding', 'run', 'handoff', 'commit', 'skill', 'url']),
  ref: z.string(),
  line: z.int().min(1).optional(),
});
export type Link = z.infer<typeof LinkSchema>;

const HEX64 = /^[0-9a-f]{64}$/;

const RunFinishedPayload = z.looseObject({
  endedBy: EndedBySchema,
  cost: CostSchema,
  sessionId: z.string().optional(),
  inFlight: z.string().nullable().optional(),
});
const UnclassifiedPayload = z.looseObject({ originalType: z.string() });
const FileChangedPayload = z.looseObject({ path: z.string(), added: z.int(), removed: z.int() });

const PAYLOAD_RULES: Partial<Record<EventType, z.ZodType>> = {
  'run.finished': RunFinishedPayload,
  'runtime.unclassified': UnclassifiedPayload,
  'file.changed': FileChangedPayload,
};

/** A task id, or `workspace` for an event that belongs to no task and lives on the workspace log (R-060). */
export const EVENT_TASK = /^(T-[0-9]{4,}|workspace)$/;

export const StintEventSchema = z
  .strictObject({
    id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    seq: z.int().min(1),
    ts: z.iso.datetime({ offset: true }),
    task: z.string().regex(EVENT_TASK),
    run: z.string().regex(RUN_ID).optional(),
    adapter: z.string().optional(),
    vendor: EventVendorSchema.optional(),
    type: EventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    raw: RawPointerSchema.optional(),
    links: z.array(LinkSchema).optional(),
    prev: z.string().regex(HEX64).optional(),
    hash: z.string().regex(HEX64).optional(),
  })
  .superRefine((e, ctx) => {
    const rule = PAYLOAD_RULES[e.type];
    if (!rule) return;
    const r = rule.safeParse(e.payload);
    if (r.success) return;
    for (const issue of r.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['payload', ...issue.path], message: issue.message });
    }
  });
export type StintEvent = z.infer<typeof StintEventSchema>;

/** An event before the log assigns id, seq, ts, prev and hash. */
export type NewEvent = Omit<StintEvent, 'id' | 'seq' | 'ts' | 'prev' | 'hash'>;

const KNOWN = new Set<string>(EVENT_TYPES);

/**
 * Adapter output with a type Stint does not know is kept, never dropped: it becomes
 * `runtime.unclassified` with the original type in `payload.originalType`.
 */
export function classifyEvent<T extends { type: string; payload?: Record<string, unknown> }>(
  input: T,
): Omit<T, 'type'> & { type: EventType; payload: Record<string, unknown> } {
  const payload = input.payload ?? {};
  if (KNOWN.has(input.type)) return { ...input, type: input.type as EventType, payload };
  return { ...input, type: 'runtime.unclassified', payload: { ...payload, originalType: input.type } };
}
