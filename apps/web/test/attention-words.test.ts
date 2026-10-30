import { expect, test } from 'bun:test';
import type { Limits } from '@stint-dev/core';
import type { PendingPermission, TaskCardData, Verification } from '../src/api';
import { redReason } from '../src/components/ApprovalGate';
import { criteriaWords } from '../src/components/TaskCard';
import { attentionLine, limitsLine } from '../src/routes/Board';

const card = (id: string, status: string, extra: Partial<TaskCardData> = {}) =>
  ({ task: { id, status, title: id }, cost: { usd: 0 }, lastRun: null, lastEventAt: '2026-10-29T10:00:00.000Z', summary: null, ...extra }) as unknown as TaskCardData;
const ask = (task: string): PendingPermission => ({ task, run: 'r1', requestId: 'q1', tool: 'Bash', title: 'Run the test suite', options: [] });

test('the board says in words what needs you, each task with its reason, the first three by name', () => {
  expect(attentionLine([card('T-0001', 'planned'), card('T-0002', 'done')], new Map())).toBe('Nothing needs you right now.');
  expect(attentionLine([card('T-0001', 'awaiting_approval')], new Map())).toBe('T-0001 waits for your approval.');
  const stopped = card('T-0003', 'building', { autopilot: { on: false, step: null, reason: 'the build limit is reached', queued: false, needsYou: true } });
  const asking = card('T-0004', 'building');
  expect(attentionLine([card('T-0001', 'awaiting_approval'), card('T-0002', 'rejected'), stopped, asking], new Map([['T-0004', ask('T-0004')]]))).toBe(
    'T-0001 waits for your approval; T-0002 was rejected and waits for you to hand it on or leave it; T-0003 autopilot stopped and asks you; and 1 more.',
  );
  expect(attentionLine([asking], new Map([['T-0004', ask('T-0004')]]))).toBe('T-0004 has an agent waiting for your permission to use Bash.');
});

const limits = (builds: number | null, usd: number | null): Limits => ({ builds, handoffs: 2, reviewRounds: 1, usd, minutes: null });

test('Run all says what the planned tasks may use: the most builds, and the spend cap only when every one has a spend limit', () => {
  expect(limitsLine([limits(8, null), limits(3, 2)])).toBe('Each stops after at most 8 builds.');
  expect(limitsLine([limits(1, null)])).toBe('Each stops after at most 1 build.');
  expect(limitsLine([limits(8, 2), limits(null, 1.5)])).toBe('Some have no build limit. Spend is capped at $3.50 across them.');
});

const red: Verification = { run: 'r2', command: 'bun test', exitCode: 1, passed: 34, failed: 2, durationMs: 10, runBy: 'daemon', status: 'red', at: '2026-10-29T10:00:00.000Z' };

test('a red verification says what was red: tests, held-out scenarios, tampered tests or another check, never "0 failed"', () => {
  expect(redReason(red)).toBe('2 of 36 tests failed.');
  expect(redReason({ ...red, passed: 36, failed: 0, reason: 'scenarios', scenarios: { passed: 1, failed: 2, names: ['a', 'b', 'c'] } })).toBe('2 held-out scenarios failed.');
  expect(redReason({ ...red, passed: 36, failed: 0, reason: 'scenarios', scenarios: null })).toBe('The held-out scenarios could not run, so they proved nothing.');
  expect(redReason({ ...red, passed: 36, failed: 0, reason: 'tampered', tamper: { files: ['test/limits.test.ts'] } })).toBe('An agent changed the locked acceptance tests (test/limits.test.ts).');
  const checks: NonNullable<Verification['checks']> = [
    { name: 'tests', kind: 'test', exitCode: 0, durationMs: 1, status: 'green' },
    { name: 'typecheck', kind: 'typecheck', exitCode: 2, durationMs: 1, status: 'red' },
  ];
  expect(redReason({ ...red, passed: 36, failed: 0, checks })).toBe('The typecheck check failed.');
  expect(redReason({ ...red, passed: 0, failed: 0 })).toBe('The test command failed before any test was counted.');
});

test('a task names the goal criteria it covers in words', () => {
  expect(criteriaWords([1])).toBe('criterion 1');
  expect(criteriaWords([1, 2])).toBe('criteria 1 and 2');
  expect(criteriaWords([1, 2, 3])).toBe('criteria 1, 2 and 3');
});
