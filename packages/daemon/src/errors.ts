import { StoreError } from '@stint-dev/core/node';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'dirty_tree'
  | 'no_commits'
  | 'path_in_use'
  | 'budget_exceeded'
  | 'adapter_unavailable'
  | 'capability_mismatch'
  | 'run_active'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid'
  | 'packet_too_large'
  | 'verification_red'
  | 'review_blocked'
  | 'decision_pending'
  | 'skill_invalid'
  | 'skill_blocked'
  | 'skill_unacknowledged'
  | 'merge_conflict';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  dirty_tree: 409,
  no_commits: 409,
  path_in_use: 409,
  budget_exceeded: 409,
  adapter_unavailable: 503,
  capability_mismatch: 400,
  run_active: 409,
  not_found: 404,
  unauthorized: 401,
  forbidden: 403,
  invalid: 400,
  packet_too_large: 422,
  verification_red: 409,
  review_blocked: 409,
  decision_pending: 409,
  skill_invalid: 422,
  skill_blocked: 409,
  skill_unacknowledged: 409,
  merge_conflict: 409,
};

export class DaemonError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: unknown,
  ) {
    super(message);
  }
}

/** Every error leaves the daemon as `{ error: { code, message, hint } }`. */
export function errorResponse(c: Context, err: unknown) {
  if (err instanceof DaemonError) {
    return c.json({ error: { code: err.code, message: err.message, hint: err.hint ?? null } }, STATUS[err.code]);
  }
  if (err instanceof StoreError) {
    const code: ErrorCode = err.code === 'exists' ? 'invalid' : err.code;
    return c.json({ error: { code, message: err.message, hint: null } }, STATUS[code]);
  }
  if (err instanceof ZodError) {
    return c.json({ error: { code: 'invalid', message: 'the request is not valid', hint: err.issues } }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message })}\n`);
  return c.json({ error: { code: 'invalid', message, hint: null } }, 500);
}
