import { z } from 'zod';
import { RUN_ID, RoleSchema, TASK_ID } from './handoff';

/** A goal's id, G-0001 (R-064). */
export const GOAL_ID = /^G-[0-9]{4,}$/;

export const TaskStatusSchema = z.enum([
  'planned',
  'building',
  'verifying',
  'reviewing',
  'in_review',
  'awaiting_approval',
  'approved',
  'rejected',
  'done',
  'abandoned',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const BudgetsSchema = z.strictObject({
  planner: z.int().min(0),
  implementer: z.int().min(0),
  reviewer: z.int().min(0),
  learn: z.int().min(0).optional(),
  tester: z.int().min(0).optional(),
  usdCap: z.number().min(0).optional(),
});
export type Budgets = z.infer<typeof BudgetsSchema>;

export const CheckSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  command: z.string().min(1).max(400),
  kind: z.enum(['test', 'typecheck', 'lint', 'custom']),
});
export type Check = z.infer<typeof CheckSchema>;

/** One `host/model` route entry, validated the same way as `config.routes` (R-054). */
const HostModelRef = z.string().regex(/^[a-z0-9-]+\/.+$/, 'expected host/model');

/** A task may override any role chain from config; the task chain wins where it is set (R-054). */
export const TaskRoutesSchema = z.strictObject({
  planner: z.array(HostModelRef).optional(),
  implementer: z.array(HostModelRef).optional(),
  reviewer: z.array(HostModelRef).optional(),
  tester: z.array(HostModelRef).optional(),
  learn: z.array(HostModelRef).optional(),
  agent: z.array(HostModelRef).optional(),
  summary: z.array(HostModelRef).optional(),
  quiz: z.array(HostModelRef).optional(),
  recall: z.array(HostModelRef).optional(),
});
export type TaskRoutes = z.infer<typeof TaskRoutesSchema>;

/** Caps a person sets on a task (R-062): a field left out takes the config default, and null means no limit. */
export const TaskLimitsSchema = z.strictObject({
  builds: z.int().min(1).max(50).nullable().optional(),
  handoffs: z.int().min(0).max(20).nullable().optional(),
  reviewRounds: z.int().min(0).max(10).nullable().optional(),
  usd: z.number().positive().max(1000).nullable().optional(),
  minutes: z.int().min(1).max(1440).nullable().optional(),
});
export type TaskLimits = z.infer<typeof TaskLimitsSchema>;
/**
 * How a criterion is proven: a test that must fail before and pass after, a held-out scenario, a check, a person
 * (R-064), or what a page shows, as `<path> :: <what should be seen>` (R-068).
 */
export const ProofKindSchema = z.enum(['test', 'scenario', 'check', 'human', 'visual']);
/** One criterion's proof; `criterion` counts from 1, the first line of `acceptance`. */
export const TaskProofSchema = z.strictObject({ criterion: z.int().min(1).max(12), kind: ProofKindSchema, ref: z.string().min(1).max(200) });
export type TaskProof = z.infer<typeof TaskProofSchema>;

/** A visual proof's ref split into the page and what should be seen there; null when it is not `<path> :: <what>`. */
export function visualRef(ref: string): { path: string; want: string } | null {
  const m = /^\s*(\/\S*)\s+::\s+(\S.*?)\s*$/.exec(ref);
  return m ? { path: m[1] as string, want: m[2] as string } : null;
}

export const TaskSchema = z.strictObject({
  version: z.literal('stint.task/1'),
  id: z.string().regex(TASK_ID),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  acceptance: z.array(z.string().min(1).max(300)).min(1).max(12),
  tags: z.array(z.string()).optional(),
  baseCommit: z.string().min(7),
  branch: z.string().regex(/^stint\/T-[0-9]{4,}$/),
  status: TaskStatusSchema,
  assignee: z
    .strictObject({
      adapter: z.string(),
      model: z.string().optional(),
      role: RoleSchema,
      run: z.string().regex(RUN_ID),
    })
    .nullable()
    .optional(),
  testCommand: z.string().min(1),
  budgets: BudgetsSchema,
  /** Per-role route overrides for this task, used before the config chains (R-054). */
  routes: TaskRoutesSchema.optional(),
  links: z.strictObject({
    beadsId: z.string().nullable().optional(),
    issueUrl: z.url().nullable().optional(),
  }),
  pendingAsk: z.string().max(400).nullable().optional(),
  /** The verify suite the daemon runs beside testCommand (R-029). */
  checks: z.array(CheckSchema).max(8).optional(),
  /** The task this one was split from, and the tasks it waits for (R-036). */
  parent: z.string().regex(TASK_ID).nullable().optional(),
  dependsOn: z.array(z.string().regex(TASK_ID)).max(20).optional(),
  /** The risk tier that decides how much gating the task needs (R-039). */
  risk: z.enum(['low', 'medium', 'high']).nullable().optional(),
  /** Where the task came from (R-041, R-044). */
  source: z.strictObject({ kind: z.enum(['manual', 'github', 'linear', 'gardening']), ref: z.string().max(200), url: z.url().optional() }).nullable().optional(),
  /** Builds, hand-offs, review rounds, spend and agent time autopilot may use before it stops and asks (R-062). */
  limits: TaskLimitsSchema.optional(),
  /** The accepted proof of each acceptance criterion (R-064). */
  proofs: z.array(TaskProofSchema).max(12).optional(),
  /** The goal this task is part of, and the goal criteria it covers, counting from 1 (R-064). */
  goalId: z.string().regex(GOAL_ID).optional(),
  goalCriteria: z.array(z.int().min(1).max(12)).max(12).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Task = z.infer<typeof TaskSchema>;
