import { expect, test } from 'bun:test';
import { type Cost, DEFAULT_CONFIG, LIMIT_DEFAULTS, type StintEvent, TaskSchema, effectiveLimits, taskUsage } from '../src/index';
import { example } from './ajv';

const cost = (usd: number | null): Cost => ({ inputTokens: 100, cachedTokens: 0, outputTokens: 10, usd });

/** A log from short lines: each gets the next seq and, unless it says, the next minute from 10:00. */
function log(lines: Array<Partial<StintEvent> & { type: string; min?: number }>): StintEvent[] {
  return lines.map(({ min, ...l }, i) => ({ id: `01M5WBKEC0GGGGGGGGGGGG${String(i + 1).padStart(4, '0')}`, seq: i + 1, ts: new Date(Date.UTC(2026, 9, 28, 10, min ?? i)).toISOString(), task: 'T-0001', payload: {}, ...l }) as StintEvent);
}

test('A task.json written before limits still parses, and its limits are the defaults', () => {
  const old = TaskSchema.parse(example('task'));
  expect(old.limits).toBeUndefined();
  expect(effectiveLimits(old, DEFAULT_CONFIG)).toEqual({ ...LIMIT_DEFAULTS, handoffs: DEFAULT_CONFIG.autopilot?.maxHops ?? 3 });
  expect(TaskSchema.safeParse({ ...old, limits: { builds: 0 } }).success).toBe(false);
  expect(TaskSchema.safeParse({ ...old, limits: { usd: 0 } }).success).toBe(false);
  expect(TaskSchema.safeParse({ ...old, limits: { builds: 50, handoffs: 0, reviewRounds: 10, usd: 1000, minutes: 1440 } }).success).toBe(true);
});

test('effectiveLimits takes the task, then budgets.usdCap, then config.limits, then autopilot.maxHops, then the defaults; null is no limit', () => {
  const task = TaskSchema.parse(example('task'));
  expect(effectiveLimits(task, {})).toEqual(LIMIT_DEFAULTS);
  expect(effectiveLimits(task, { autopilot: { implementers: ['muse-code'], maxHops: 5, parallel: 1 } }).handoffs).toBe(5);
  expect(effectiveLimits(task, { autopilot: { implementers: ['muse-code'], maxHops: 5, parallel: 1 }, limits: { handoffs: 1, builds: null } })).toMatchObject({ handoffs: 1, builds: null, reviewRounds: 1 });
  expect(effectiveLimits({ ...task, budgets: { ...task.budgets, usdCap: 2 } }, {}).usd).toBe(2);
  // a usdCap of 0 is not a spend limit
  expect(effectiveLimits({ ...task, budgets: { ...task.budgets, usdCap: 0 } }, {}).usd).toBeNull();
  expect(effectiveLimits({ ...task, budgets: { ...task.budgets, usdCap: 2 }, limits: { usd: 4, builds: null, minutes: 30 } }, { limits: { builds: 2 } })).toEqual({ builds: null, handoffs: 3, reviewRounds: 1, usd: 4, minutes: 30 });
});

test('taskUsage counts over the whole log: adopted runs are not builds, escalations are hand-offs, a live run counts its time so far, and an unpriced call is counted', () => {
  const events = log([
    { type: 'autopilot.started' },
    { type: 'run.started', run: 'r1', payload: { role: 'planner' }, min: 0 },
    { type: 'run.finished', run: 'r1', payload: { endedBy: 'completed', cost: cost(0.1) }, min: 2 },
    { type: 'autopilot.step', payload: { step: 'build' } },
    { type: 'run.started', run: 'r2', payload: { role: 'implementer' }, min: 2 },
    { type: 'run.finished', run: 'r2', payload: { endedBy: 'failed', cost: cost(0.4) }, min: 10 },
    { type: 'autopilot.stopped', payload: { reason: 'Turned off by you.' } },
    // switched on again: nothing resets
    { type: 'autopilot.started' },
    { type: 'autopilot.step', payload: { step: 'hand', escalate: true } },
    { type: 'escalation.triggered', payload: { from: 'muse-code', to: 'codex' } },
    { type: 'run.started', run: 'r3', payload: { role: 'implementer' }, min: 10 },
    { type: 'run.finished', run: 'r3', payload: { endedBy: 'completed', cost: cost(0.5) }, min: 20 },
    { type: 'autopilot.step', payload: { step: 'escalate' } },
    // a candidate's work moved onto the task: no build of its own, and its cost is on the candidate
    { type: 'run.started', run: 'r4', payload: { role: 'implementer', adoptedFrom: 'T-0002 r1' }, min: 20 },
    { type: 'run.finished', run: 'r4', payload: { endedBy: 'completed', cost: cost(0), adoptedFrom: 'T-0002 r1' }, min: 20 },
    { type: 'autopilot.step', payload: { step: 'build', changes: true } },
    { type: 'cost.recorded', payload: { for: 'digest', host: 'ollama', model: 'fake', cost: cost(null) } },
    { type: 'handoff.quizzed', payload: { writer: { host: 'meta-api', model: 'w', cost: cost(0.05) }, answerer: { host: 'meta-api', model: 'a', cost: cost(0.05) } } },
    { type: 'run.started', run: 'r5', payload: { role: 'implementer' }, min: 30 },
  ]);
  const now = Date.UTC(2026, 9, 28, 10, 34);
  expect(taskUsage(events, now)).toEqual({ builds: 2, handoffs: 2, reviewRounds: 1, usd: 1.1, unpriced: 1, minutes: 24 });
  // the live run is not a build until it ends, and its spend lands when it does
  expect(taskUsage(events.slice(0, -1), now)).toEqual({ builds: 2, handoffs: 2, reviewRounds: 1, usd: 1.1, unpriced: 1, minutes: 20 });
  expect(taskUsage([])).toEqual({ builds: 0, handoffs: 0, reviewRounds: 0, usd: 0, unpriced: 0, minutes: 0 });
});
