import { expect, test } from 'bun:test';
import { LIMIT_DEFAULTS, type StintEvent, type Task } from '@stint-dev/core';
import { AUTOPILOT_DEFAULTS, nextStep } from '../src/index';

type Line = Partial<StintEvent> & { type: string };
const log = (lines: Line[]): StintEvent[] => lines.map((l, i) => ({ id: `E${i}`, seq: i + 1, ts: new Date(Date.UTC(2026, 9, 29, 10, i)).toISOString(), task: 'T-0001', payload: {}, ...l }) as StintEvent);
const task = (status: string, pendingAsk: string | null = null) => ({ id: 'T-0001', status, tags: [], pendingAsk, budgets: { planner: 1, implementer: 1, reviewer: 1 } }) as unknown as Task;
const zero = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 };
// a build by hand, before autopilot was ever on
const byHand = (command: string): Line[] => [
  { type: 'run.started', run: 'r1', adapter: 'muse-code', payload: { role: 'implementer' } },
  { type: 'run.finished', run: 'r1', adapter: 'muse-code', payload: { endedBy: 'completed', cost: zero } },
  { type: 'verification.ran', run: 'r1', payload: { status: 'green', passed: 1, failed: 0, command } },
];
const reviewed: Line[] = [
  { type: 'review.recorded', payload: { verdict: 'approve', review: { verdict: 'approve', findings: [] } } },
  { type: 'approval.requested', payload: { review: 'approve' } },
];
const step = (events: StintEvent[], t: Task) => nextStep(events, t, AUTOPILOT_DEFAULTS, false, LIMIT_DEFAULTS);

test('Autopilot switched on for a task already at the gate stops at the gate instead of building it again', () => {
  const events = log([...byHand('bun run test'), ...reviewed, { type: 'autopilot.started' }]);
  expect(step(events, task('awaiting_approval'))).toEqual({ kind: 'stop', reason: 'Waiting for your approval.', needsYou: false });
});

test('Autopilot switched on for a green build nobody reviewed goes to review, saying the command plainly', () => {
  expect(step(log([...byHand('bun run test'), { type: 'autopilot.started' }]), task('reviewing'))).toEqual({ kind: 'review', verified: 'Stint ran bun run test, and 1 of 1 passed.' });
  expect(step(log([...byHand(`sh -c 'test -f src/lib/x.ts && bun test'`), { type: 'autopilot.started' }]), task('reviewing'))).toEqual({ kind: 'review', verified: 'Stint ran test -f src/lib/x.ts && bun test, and 1 of 1 passed.' });
});

test('A green build sent back with changes is built again from the ask, and a red build is built again as before', () => {
  const planned: Line[] = [
    { type: 'run.started', run: 'r0', payload: { role: 'planner' } },
    { type: 'run.finished', run: 'r0', payload: { endedBy: 'completed', cost: zero } },
  ];
  const sentBack = log([...planned, ...byHand('bun run test'), ...reviewed, { type: 'approval.rejected', payload: { reason: 'Name it LIMIT.', changes: true } }, { type: 'autopilot.started' }]);
  expect(step(sentBack, task('building', 'Name it LIMIT.'))).toEqual({ kind: 'build', reason: 'It was sent back with changes to make.' });
  const red = log([...planned, ...byHand('bun run test').slice(0, 2), { type: 'verification.ran', run: 'r1', payload: { status: 'red', passed: 0, failed: 1 } }, { type: 'autopilot.started' }]);
  expect(step(red, task('building'))).toEqual({ kind: 'build', reason: 'Nothing is built yet.' });
});
