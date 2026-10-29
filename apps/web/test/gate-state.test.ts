import { expect, test } from 'bun:test';
import type { StintEvent } from '@stint-dev/core';
import type { RunSummary, TaskBundle, Verification } from '../src/api';
import { gateState } from '../src/components/ApprovalGate';

const run = (r: string, role: string, endedAt: string | null): RunSummary => ({ run: r, adapter: 'muse-code', vendor: 'meta', role, model: null, host: null, startedAt: '2026-10-29T09:00:00.000Z', endedAt, endedBy: endedAt ? 'completed' : null, cost: null, handoffFrom: null });
const green: Verification = { run: 'r1', command: 'bun test', exitCode: 0, passed: 1, failed: 0, durationMs: 100, runBy: 'daemon', status: 'green', at: '2026-10-29T09:01:00.000Z' };
const bundle = (status: string, runs: RunSummary[], extra: Partial<TaskBundle> = {}) =>
  ({ task: { id: 'T-0001', status }, plan: null, handoff: null, review: null, verification: green, runs, cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 }, outcomes: [], ...extra }) as unknown as TaskBundle;

test('the gate says a review is running only while a reviewer run is live', () => {
  const built = run('r1', 'implementer', '2026-10-29T09:00:30.000Z');
  expect(gateState(bundle('reviewing', [built])).reason).toBe('The tests passed, but no review is running.');
  expect(gateState(bundle('reviewing', [built, run('r2', 'reviewer', null)])).reason).toBe('The review is running.');
});

test('at the gate with no review the reason the daemon gave is shown, and one test is one test', () => {
  const built = run('r1', 'implementer', '2026-10-29T09:00:30.000Z');
  const asked = { type: 'approval.requested', payload: { review: null, reason: 'No reviewer could answer (routes.reviewer names no model).' } } as unknown as StintEvent;
  expect(gateState(bundle('awaiting_approval', [built]), [], [asked])).toEqual({ open: true, reason: '1 test passed, run by Stint. No reviewer could answer (routes.reviewer names no model).' });
  const reviewed = bundle('awaiting_approval', [built], { review: { verdict: 'approve' } as TaskBundle['review'], verification: { ...green, passed: 3 } });
  expect(gateState(reviewed, [], [asked]).reason).toBe('3 tests passed, run by Stint; review: approve.');
});
