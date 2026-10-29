import { z } from 'zod';
import { EndedBySchema, RUN_ID, TASK_ID } from './handoff';
import { SeveritySchema } from './review';

/** A share from 0 to 1 and the number of runs it rests on; null when it rests on none. */
export const ScorecardShareSchema = z.strictObject({ value: z.number().min(0).max(1).nullable(), n: z.int().min(0) });
/** A mean (USD or milliseconds) over n runs; null when it rests on none. */
export const ScorecardMeanSchema = z.strictObject({ value: z.number().min(0).nullable(), n: z.int().min(0) });
export type ScorecardShare = z.infer<typeof ScorecardShareSchema>;

const Verdict = z.enum(['green', 'red']);
const DateTime = z.iso.datetime({ offset: true });

/** One attempt at a seeded task from a fresh clone, mirroring the attempt in schemas/scorecard.schema.json. */
export const ScorecardAttemptSchema = z.strictObject({
  task: z.string().min(1),
  repo: z.string().min(1),
  attempt: z.int().min(1),
  live: z.boolean(),
  stintTask: z.string().regex(TASK_ID).nullable(),
  run: z.string().regex(RUN_ID).nullable(),
  adapter: z.string().min(1),
  model: z.string().min(1).nullable(),
  host: z.string().min(1).nullable(),
  endedBy: EndedBySchema.nullable(),
  tests: Verdict.nullable(),
  hidden: Verdict.nullable(),
  scenarios: z.strictObject({ passed: z.int().min(0), failed: z.int().min(0) }).nullable(),
  review: z
    .strictObject({
      verdict: z.enum(['approve', 'request_changes', 'block']),
      findings: z.array(z.strictObject({ severity: SeveritySchema, text: z.string().min(1) })),
      adapter: z.string().min(1).nullable(),
      model: z.string().min(1).nullable(),
      host: z.string().min(1).nullable(),
      offline: z.boolean().nullable(),
    })
    .nullable(),
  usd: z.number().min(0).nullable(),
  estimated: z.boolean(),
  wallMs: z.int().min(0).nullable(),
  retried: z.array(z.string().min(1)),
  outcome: z.string().min(1),
  startedAt: DateTime,
  finishedAt: DateTime,
});
export type ScorecardAttempt = z.infer<typeof ScorecardAttemptSchema>;

/** What verification and review catch on seeded tasks with hidden tests (R-070), mirroring schemas/scorecard.schema.json. */
export const ScorecardSchema = z.strictObject({
  version: z.literal('stint.scorecard/1'),
  live: z.boolean(),
  k: z.int().min(1),
  generatedAt: DateTime,
  models: z.array(
    z.strictObject({
      source: z.enum(['attempts', 'relays']),
      role: z.enum(['implementer', 'reviewer']),
      adapter: z.string().min(1),
      model: z.string().min(1).nullable(),
      host: z.string().min(1).nullable(),
      runs: z.int().min(1),
    }),
  ),
  tasks: z.array(z.strictObject({ id: z.string().min(1), repo: z.string().min(1), attempts: z.int().min(0), green: z.int().min(0), pass1: ScorecardShareSchema, passK: ScorecardShareSchema })),
  overall: z.strictObject({ pass1: ScorecardShareSchema, passK: ScorecardShareSchema }),
  handoff: z.strictObject({ value: z.number().min(0).max(1).nullable(), n: z.int().min(0), green: z.int().min(0), relays: z.array(z.string().min(1)) }),
  review: z.strictObject({ n: z.int().min(0), caught: z.int().min(0), missed: z.int().min(0), falseAlarm: z.int().min(0), agreed: z.int().min(0) }),
  badPatches: z.strictObject({ n: z.int().min(0), byTests: ScorecardShareSchema, byTestsAndReview: ScorecardShareSchema }),
  perGreen: z.strictObject({ usd: z.strictObject({ value: z.number().min(0).nullable(), n: z.int().min(0), unpriced: z.int().min(0) }), wallMs: ScorecardMeanSchema }),
  spend: z.strictObject({ usd: z.number().min(0), estimated: z.boolean() }),
  attempts: z.array(ScorecardAttemptSchema),
});
export type Scorecard = z.infer<typeof ScorecardSchema>;
