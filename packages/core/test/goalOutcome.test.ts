import { expect, test } from 'bun:test';
import { type CriterionState, type Goal, type Outcome, type OutcomeResult, goalOutcome } from '../src/index';
import { example } from './ajv';

const goal = (over: Partial<Goal> = {}): Goal => ({ ...(example('goal') as Goal), ...over });
/** A task's outcome with the given result, criterion states, spend and builds. */
const of = (task: string, result: OutcomeResult, states: CriterionState[], usd = 0.5, builds = 1): Outcome => ({
  ...(example('outcome') as Outcome),
  task,
  result,
  resultLabel: result,
  criteria: states.map((state, index) => ({ index, text: `criterion ${index + 1}`, state, evidence: `${state} in ${task}.` })),
  loops: { builds, handoffs: 0, reviewRounds: 0 },
  spend: { usd, unpriced: 0 },
});

test('Each goal criterion takes the weakest state of the criteria of the tasks that cover it; one no task covers is not checked', () => {
  const r = goalOutcome(goal(), [of('T-0042', 'merged', ['proven', 'passing']), of('T-0043', 'in_progress', ['failing'])], { 'T-0042': [1, 2], 'T-0043': [2] });
  expect(r.criteria.map((c) => [c.state, c.tasks, c.met])).toEqual([
    ['passing', ['T-0042'], false],
    ['failing', ['T-0042', 'T-0043'], false],
    ['not_checked', [], false],
  ]);
  expect(r.criteria[1]?.evidence).toBe('T-0043: failing in T-0043.');
  expect(r.criteria[2]?.evidence).toBe('No task covers it yet.');
  expect(r.met).toBe(0);
  expect(r.result).toBe('in_progress');
});

test('The weakest state ranks failing, not checked, you check it, passing, checked by you, then proven', () => {
  const states: CriterionState[] = ['proven', 'checked_by_you', 'passing', 'you_check', 'not_checked', 'failing'];
  for (let i = 0; i < states.length; i++) {
    const r = goalOutcome(goal({ criteria: [{ text: 'one' }] }), [of('T-0001', 'merged', states.slice(0, i + 1))], { 'T-0001': [1] });
    expect(r.criteria[0]?.state).toBe(states[i] as CriterionState);
  }
});

test('A goal is done when every task is merged and every criterion is proven or checked by you; a revert or an open task keeps it going', () => {
  const two = goal({ criteria: [{ text: 'one' }, { text: 'two' }], limits: { usd: 5, builds: 4 } });
  const covers = { 'T-0001': [1], 'T-0002': [2] };
  const done = goalOutcome(two, [of('T-0001', 'merged_held_up', ['proven'], 0.25, 2), of('T-0002', 'merged', ['checked_by_you'], 0.5, 1)], covers);
  expect(done).toMatchObject({ result: 'done', met: 2, merged: 2, spend: { usd: 0.75, unpriced: 0, limit: 5 }, builds: { used: 3, limit: 4 }, byResult: { merged_held_up: 1, merged: 1 } });
  expect(done.tasks).toEqual([
    { id: 'T-0001', result: 'merged_held_up', resultLabel: 'merged_held_up', covers: [1] },
    { id: 'T-0002', result: 'merged', resultLabel: 'merged', covers: [2] },
  ]);
  expect(goalOutcome(two, [of('T-0001', 'merged_reverted', ['proven']), of('T-0002', 'merged', ['proven'])], covers)).toMatchObject({ result: 'in_progress', merged: 1 });
  expect(goalOutcome(two, [of('T-0001', 'merged', ['proven']), of('T-0002', 'waiting_for_you', ['proven'])], covers).result).toBe('in_progress');
  // merged, but a criterion only passes: not proven, so not done
  expect(goalOutcome(two, [of('T-0001', 'merged', ['proven']), of('T-0002', 'merged', ['passing'])], covers)).toMatchObject({ result: 'in_progress', met: 1 });
  // no tasks yet: nothing is done, and no limit reads as null
  expect(goalOutcome(goal({ limits: undefined }), [], {})).toMatchObject({ result: 'in_progress', met: 0, merged: 0, spend: { usd: 0, limit: null }, builds: { used: 0, limit: null } });
});
