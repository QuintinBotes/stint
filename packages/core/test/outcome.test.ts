import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG, OutcomeSchema, type StintEvent, type Task, outcome, outcomeLine, usageFromEvents } from '../src/index';
import type { VerificationRecord } from '../src/node';
import { example } from './ajv';

const T0 = Date.parse('2026-11-02T14:36:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const task = (over: Partial<Task> = {}): Task => ({ ...(example('task') as Task), status: 'awaiting_approval', ...over });

let seq = 0;
const ev = (min: number, type: string, payload: Record<string, unknown> = {}, run?: string): StintEvent =>
  ({ id: `01M5WBKEC0GGGGGGGGGGGGG${String(++seq).padStart(3, '0')}`, seq, ts: at(min), task: 'T-0042', type, payload, ...(run ? { run } : {}) }) as StintEvent;
const record = (run: string, min: number, status: 'green' | 'red', extra: Partial<VerificationRecord> = {}): VerificationRecord => ({
  run, command: 'bun run test', exitCode: status === 'green' ? 0 : 1, passed: 30, failed: status === 'green' ? 0 : 2, durationMs: 1600, runBy: 'daemon', status, outputRef: `verification/${run}.out.txt`, at: at(min), ...extra,
});
/** An implementer run that ends at `min + 2` with a verification and its record. */
const build = (run: string, min: number, status: 'green' | 'red', failing: string[] = [], usd = 0.2) => ({
  events: [
    ev(min, 'run.started', { role: 'implementer' }, run),
    ev(min + 2, 'run.finished', { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd } }, run),
    ev(min + 3, 'verification.ran', { status, passed: 30, failed: failing.length, failing }, run),
  ],
  record: record(run, min + 3, status),
});
const run = (events: StintEvent[], verifications: VerificationRecord[], over: Partial<Parameters<typeof outcome>[0]> = {}) => {
  const o = outcome({ task: task(), events, verifications, config: DEFAULT_CONFIG, now: at(60), ...over });
  expect(OutcomeSchema.safeParse(JSON.parse(JSON.stringify(o))).success).toBe(true);
  return o;
};

describe('R-063 Acceptance: outcome() on fixtures', () => {
  test('(a) tests first locked two failing tests, green in r2: every criterion is proven, with evidence naming the tests', () => {
    const locked = ['limiter.test.ts > 429 with Retry-After', 'limiter.test.ts > other tenants pass'];
    const r2 = build('r2', 5, 'green');
    const o = run([ev(1, 'acceptance.locked', { scope: 'plan', files: [], failing: locked }), ...r2.events, ev(9, 'approval.requested')], [r2.record]);
    expect(o.criteria.map((c) => c.state)).toEqual(['proven', 'proven', 'proven']);
    for (const c of o.criteria) for (const name of locked) expect(c.evidence).toContain(name);
    expect(o.criteria[0]?.evidence).toContain('pass in r2');
    expect(o.result).toBe('waiting_for_you');
    expect(o.timeToFirstGreen).toBe(8 * 60_000);
    expect(o.timeToApprovalRequest).toBe(9 * 60_000);
  });

  test('(b) no lock and green: every criterion passes but is not proven', () => {
    const r2 = build('r2', 5, 'green');
    const o = run(r2.events, [r2.record]);
    expect(o.criteria.map((c) => c.state)).toEqual(['passing', 'passing', 'passing']);
    expect(o.criteria[0]?.evidence).toBe('The tests pass in r2, but no test showed it failing first.');
  });

  test('(c) a test proof whose test is in the latest failing list is failing; one that failed earlier and passes now is proven', () => {
    const r2 = build('r2', 5, 'green');
    const r3 = build('r3', 10, 'red', ['limiter.test.ts > 429 with Retry-After']);
    const proofs = [{ criterion: 0, kind: 'test' as const, ref: '429 with Retry-After' }];
    const o = run([...r2.events, ...r3.events], [r2.record, r3.record], { proofs });
    expect(o.criteria[0]).toMatchObject({ state: 'failing', proof: { kind: 'test', ref: '429 with Retry-After' }, evidence: 'limiter.test.ts > 429 with Retry-After fails in r3.' });
    expect(o.criteria[1]?.state).toBe('failing');
    const r4 = build('r4', 20, 'green');
    const fixed = run([...r2.events, ...r3.events, ...r4.events], [r2.record, r3.record, r4.record], { proofs });
    expect(fixed.criteria[0]).toMatchObject({ state: 'proven', evidence: 'limiter.test.ts > 429 with Retry-After failed in r3 and passes in r4.' });
  });

  test('scenario and check proofs read the latest verification', () => {
    const r2 = build('r2', 5, 'green');
    const checks = [{ name: 'typecheck', kind: 'typecheck' as const, exitCode: 1, durationMs: 10, status: 'red' as const }];
    const events = [...r2.events, ev(8, 'scenario.ran', { run: 'r2', passed: 1, failed: 0, names: ['scenarios/burst.test.ts'], failing: [] }, 'r2')];
    const o = run(events, [{ ...r2.record, checks }], {
      proofs: [
        { criterion: 0, kind: 'scenario', ref: 'burst' },
        { criterion: 1, kind: 'check', ref: 'typecheck' },
        { criterion: 2, kind: 'check', ref: 'lint' },
      ],
    });
    expect(o.criteria.map((c) => c.state)).toEqual(['proven', 'failing', 'not_checked']);
  });

  test('(d) a human proof is yours to check before approval, and checked by you after', () => {
    const r2 = build('r2', 5, 'green');
    const proofs = [{ criterion: 1, kind: 'human' as const, ref: 'try two tenants by hand' }];
    const before = run(r2.events, [r2.record], { proofs });
    expect(before.criteria[1]).toMatchObject({ state: 'you_check', evidence: 'You check this before you approve.' });
    const after = run([...r2.events, ev(9, 'approval.requested'), ev(12, 'approval.granted', { by: 'human' })], [r2.record], { proofs, task: task({ status: 'approved' }) });
    expect(after.criteria[1]).toMatchObject({ state: 'checked_by_you', evidence: 'Checked by you at approval.' });
    expect(after.approvalWait).toBe(3 * 60_000);
  });

  test('(e) a follow-up inside the outcome window makes the result "needed a follow-up"; one outside it does not', () => {
    const r2 = build('r2', 5, 'green');
    const merged = [...r2.events, ev(10, 'merge.completed', { commit: 'abc1234' })];
    const days = (d: number) => 10 + d * 24 * 60;
    const inside = run([...merged, ev(days(2), 'outcome.followup', { followup: 'T-0050' })], [r2.record], { task: task({ status: 'done' }), now: at(days(3)) });
    expect(inside.result).toBe('merged_followup');
    expect(inside.resultLabel).toBe('Merged, needed a follow-up');
    expect(inside.afterMerge).toMatchObject({ followups: ['T-0050'], reverted: false, window: { days: 7, mature: false } });
    expect(inside.leadTime).toBe(10 * 60_000);
    const outside = run([...merged, ev(days(9), 'outcome.followup', { followup: 'T-0051' })], [r2.record], { task: task({ status: 'done' }), now: at(days(10)) });
    expect(outside.afterMerge?.followups).toEqual([]);
    expect(outside.result).toBe('merged_held_up');
    // while the window is open with nothing recorded, it is merged and still watched
    expect(run(merged, [r2.record], { task: task({ status: 'done' }), now: at(days(1)) }).result).toBe('merged');
    const reverted = run([...merged, ev(days(1), 'outcome.reverted', { commit: 'def5678' })], [r2.record], { task: task({ status: 'done' }), now: at(days(2)) });
    expect(reverted.result).toBe('merged_reverted');
  });

  test('(f) limit.reached then a stop gives "stopped at a limit"; another needs-you stop gives "stopped, needs you"', () => {
    const r2 = build('r2', 5, 'red', ['a > b']);
    const started = ev(1, 'autopilot.started');
    const limit = run([started, ...r2.events, ev(9, 'limit.reached', { limit: 'builds', used: 1, cap: 1 }), ev(9, 'autopilot.stopped', { reason: 'Needs you: the build limit is reached (1 of 1).', needsYou: true, limit: 'builds' })], [r2.record], { task: task({ status: 'building' }) });
    expect(limit.result).toBe('stopped_at_limit');
    expect(limit.resultLabel).toBe('Stopped at a limit');
    const stuck = run([started, ...r2.events, ev(9, 'autopilot.stopped', { reason: 'Needs you: two agents in a row got no further.', needsYou: true })], [r2.record], { task: task({ status: 'building' }) });
    expect(stuck.result).toBe('stopped_needs_you');
    // a run started after the stop puts it back in progress
    const later = run([started, ...r2.events, ev(9, 'autopilot.stopped', { needsYou: true }), ev(11, 'run.started', { role: 'implementer' }, 'r3')], [r2.record], { task: task({ status: 'building' }) });
    expect(later.result).toBe('in_progress');
  });

  test('no verification yet: every criterion is not checked, and the loops line says so', () => {
    const o = run([], [], { task: task({ status: 'planned' }) });
    expect(o.criteria.map((c) => c.state)).toEqual(['not_checked', 'not_checked', 'not_checked']);
    expect(o.result).toBe('in_progress');
    expect(outcomeLine(o)).toBe('0 builds, 0 hand-offs, $0.00, not green yet');
  });

  test('loops, spend, limits, review and hand-offs come from the log', () => {
    const r2 = build('r2', 5, 'red', ['x'], 0.21);
    const r3 = build('r3', 10, 'green', [], 0.4);
    const events = [
      ...r2.events,
      ev(9, 'autopilot.step', { step: 'hand' }),
      ev(9, 'handoff.created', { name: 'h1', from: { adapter: 'muse-code' }, to: { adapter: 'stint-agent' }, tokens: 412 }, 'r2'),
      ...r3.events,
      ev(15, 'review.recorded', { verdict: 'approve', review: { verdict: 'approve', findings: [{ severity: 'minor' }, { severity: 'note' }] } }, 'r4'),
      ev(16, 'cost.recorded', { for: 'digest', cost: { usd: null } }),
    ];
    const o = run(events, [r2.record, r3.record], { limits: { builds: 8, handoffs: 3, reviewRounds: 1, usd: null, minutes: null } });
    expect(o.loops).toEqual({ builds: 2, handoffs: 1, reviewRounds: 0 });
    expect(o.spend).toEqual({ usd: 0.61, unpriced: 1 });
    expect(o.minutes).toBe(4);
    expect(o.limits).toEqual({ builds: 8, handoffs: 3, reviewRounds: 1, usd: null, minutes: null });
    expect(o.review).toEqual({ rounds: 1, verdicts: ['approve'], findings: { total: 2, bySeverity: { blocker: 0, major: 0, minor: 1, note: 1 } } });
    expect(o.handoffs).toEqual([{ from: 'muse-code', to: 'stint-agent', packetTokens: 412 }]);
    expect(outcomeLine(o)).toBe('2 builds, 1 hand-off, $0.61 plus 1 unpriced call, 13 min to green');
    expect(usageFromEvents(events).builds).toBe(2);
  });
});
