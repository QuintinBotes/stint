import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG, GoalSchema, type StintEvent, TaskSchema, outcome, taskUsage, visualRef } from '../src/index';
import type { VerificationRecord } from '../src/node';
import { example } from './ajv';

const at = (min: number) => new Date(Date.parse('2026-11-02T14:36:00Z') + min * 60_000).toISOString();
let seq = 0;
const ev = (min: number, type: string, payload: Record<string, unknown>, run = 'r2'): StintEvent =>
  ({ id: `01M5WBKEC0HHHHHHHHHHHHH${String(++seq).padStart(3, '0')}`, seq, ts: at(min), task: 'T-0042', run, type, payload }) as StintEvent;
const record = (run: string, min: number, status: 'green' | 'red'): VerificationRecord => ({
  run, command: 'bun test', exitCode: 0, passed: 3, failed: 0, durationMs: 10, runBy: 'daemon', status, outputRef: `verification/${run}.out.txt`, at: at(min),
});
const cost = { inputTokens: 1400, cachedTokens: 0, outputTokens: 500, usd: 0.0043 };
const ref = '/admin :: a 429 banner saying try again in 60 s';
const proofs = [{ criterion: 1, kind: 'visual' as const, ref }];
const task = { ...(example('task') as ReturnType<typeof TaskSchema.parse>), status: 'awaiting_approval' as const };
const judge = (events: StintEvent[], verifications: VerificationRecord[]) => outcome({ task, events, verifications, config: DEFAULT_CONFIG, now: at(60), proofs }).criteria[0];

describe('R-068 Acceptance 1: visual proofs', () => {
  test('a visual proof parses on a task and a goal, and its ref splits into the page and what should be seen', () => {
    expect(TaskSchema.safeParse({ ...task, proofs }).success).toBe(true);
    expect(GoalSchema.shape.criteria.element.safeParse({ text: 'The banner shows', proof: { kind: 'visual', ref } }).success).toBe(true);
    expect(visualRef(ref)).toEqual({ path: '/admin', want: 'a 429 banner saying try again in 60 s' });
    expect(visualRef('admin :: a banner')).toBeNull();
    expect(visualRef('/admin a banner')).toBeNull();
  });

  test('outcome() proves a visual criterion from visual.checked that holds, and fails it from one that does not', () => {
    const holds = [ev(3, 'visual.checked', { criterion: 1, ref, holds: true, seen: 'A yellow banner says try again in 60 s.', screenshot: 'verification/r2/visual-1.png', cost }), ev(4, 'verification.ran', { status: 'green', failing: [] })];
    expect(judge(holds, [record('r2', 4, 'green')])).toMatchObject({ state: 'proven', evidence: 'Muse Spark saw it on /admin in r2: A yellow banner says try again in 60 s.', proof: { kind: 'visual', ref } });

    const fails = [ev(3, 'visual.checked', { criterion: 1, ref, holds: false, seen: 'A banner says NaN s.', problem: 'The banner says NaN s, not 60 s.', element: 'yellow banner', screenshot: 'verification/r2/visual-1.png', marked: 'verification/r2/visual-1-marked.png', cost }), ev(4, 'verification.ran', { status: 'red', failing: [] })];
    expect(judge(fails, [record('r2', 4, 'red')])).toMatchObject({ state: 'failing', evidence: 'Muse Spark saw a problem on /admin in r2: The banner says NaN s, not 60 s.' });
  });

  test('a page not looked at is not checked, with the reason; a check from an earlier verification of the run does not count', () => {
    const notChecked = [ev(3, 'visual.checked', { criterion: 1, ref, notChecked: 'no visual config: set visual.serve and visual.url in .stint/config.json' }), ev(4, 'verification.ran', { status: 'green', failing: [] })];
    expect(judge(notChecked, [record('r2', 4, 'green')])).toEqual({ index: 0, text: task.acceptance[0] as string, proof: { kind: 'visual', ref }, state: 'not_checked', evidence: 'Stint did not look at /admin in r2: no visual config: set visual.serve and visual.url in .stint/config.json' });

    const earlier = [ev(3, 'visual.checked', { criterion: 1, ref, holds: true, seen: 'It shows.', screenshot: 'verification/r2/visual-1.png', cost }), ev(4, 'verification.ran', { status: 'green', failing: [] }), ev(9, 'verification.ran', { status: 'red', failing: ['x'] })];
    expect(judge(earlier, [record('r2', 9, 'red')])).toMatchObject({ state: 'not_checked', evidence: 'The tests are red in r2, so Stint did not look at /admin.' });
  });

  test("a visual check's judge and mark count once each in the task's spend", () => {
    const e = ev(3, 'visual.checked', { criterion: 1, ref, holds: false, seen: 's', screenshot: 'x', cost: { ...cost, usd: 0.0068 }, judge: { host: 'meta-api', model: 'muse-spark-1.3', cost }, mark: { host: 'meta-api', model: 'sam-3.1', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0.0025 } } });
    expect(taskUsage([e], Date.parse(at(60))).usd).toBeCloseTo(0.0068, 6);
  });
});
