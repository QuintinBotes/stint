import { z } from 'zod';

export const TASK_ID = /^T-[0-9]{4,}$/;
export const RUN_ID = /^r[0-9]+$/;
export const DECISION_ID = /^D[0-9]+$/;

export const RoleSchema = z.enum(['planner', 'implementer', 'reviewer']);
export type Role = z.infer<typeof RoleSchema>;

export const EndedBySchema = z.enum(['completed', 'capped', 'killed', 'failed', 'handed']);
export type EndedBy = z.infer<typeof EndedBySchema>;

export const VendorSchema = z.enum(['meta', 'openai', 'anthropic', 'local', 'other']);
export type Vendor = z.infer<typeof VendorSchema>;

export const HostIdSchema = z.enum(['meta-api', 'baseten', 'fireworks', 'modal', 'ollama', 'local-cli']);
export type HostId = z.infer<typeof HostIdSchema>;

export const CostSchema = z.strictObject({
  inputTokens: z.int().min(0),
  cachedTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  usd: z.number().min(0).nullable(),
  estimated: z.boolean().optional(),
});
export type Cost = z.infer<typeof CostSchema>;

export const ShortListSchema = z.array(z.string().min(1).max(200)).max(12);

export const VerificationSummarySchema = z.strictObject({
  command: z.string(),
  exitCode: z.int(),
  passed: z.int().min(0),
  failed: z.int().min(0),
  durationMs: z.int().min(0),
  runBy: z.literal('daemon'),
  status: z.enum(['green', 'red', 'not_run']).optional(),
});
export type VerificationSummary = z.infer<typeof VerificationSummarySchema>;

export const RefusalSchema = z.strictObject({
  action: z.string().max(200),
  by: z.enum(['stint-rules', 'runtime', 'unattributed']),
  reason: z.string().max(200).optional(),
  carriedFrom: z.string().optional(),
});
export type Refusal = z.infer<typeof RefusalSchema>;

export const HandoffSchema = z.strictObject({
  version: z.literal('stint.handoff/1'),
  task: z.string().regex(TASK_ID),
  from: z.strictObject({
    adapter: z.string().min(1),
    vendor: VendorSchema,
    model: z.string().min(1),
    role: RoleSchema,
    run: z.string().regex(RUN_ID),
    endedBy: EndedBySchema,
    sessionId: z.string().optional(),
    host: HostIdSchema.optional(),
  }),
  to: z.strictObject({ adapter: z.string().min(1), role: RoleSchema }).optional(),
  summary: z.string().min(1).max(400),
  done: ShortListSchema,
  open: ShortListSchema,
  leftOut: ShortListSchema,
  refusals: z.array(RefusalSchema).max(12).optional(),
  decisions: z.array(z.strictObject({ id: z.string().regex(DECISION_ID), text: z.string().max(200) })).max(12),
  risks: ShortListSchema,
  changedFiles: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        added: z.int().min(0),
        removed: z.int().min(0),
        run: z.string().regex(RUN_ID).optional(),
      }),
    )
    .max(50),
  diffRef: z.strictObject({ base: z.string().min(7), head: z.string().min(7) }),
  verification: VerificationSummarySchema.nullable().optional(),
  askOfNext: z.string().min(1).max(400),
  cost: CostSchema,
  createdAt: z.iso.datetime({ offset: true }),
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type Handoff = z.infer<typeof HandoffSchema>;
