import type { Goal } from '../schemas/goal';
import type { CriterionState, Outcome, OutcomeResult } from '../schemas/outcome';

/**
 * How a goal is going (R-064): a pure rollup of its tasks' outcome records (R-063). Each goal criterion takes the
 * weakest state among the criteria of the tasks that cover it; the goal is done when every task is merged and every
 * criterion is proven or checked by you.
 */
export type GoalOutcome = {
  goal: string;
  result: 'done' | 'in_progress';
  criteria: Array<{ index: number; text: string; state: CriterionState; met: boolean; tasks: string[]; evidence: string }>;
  /** How many criteria are met: proven, or checked by you. */
  met: number;
  tasks: Array<{ id: string; result: OutcomeResult; resultLabel: string; covers: number[] }>;
  byResult: Partial<Record<OutcomeResult, number>>;
  spend: { usd: number; unpriced: number; limit: number | null };
  builds: { used: number; limit: number | null };
  merged: number;
};

// weakest first: a failing criterion holds a goal back most, then one nobody checked, then one waiting on a person
const WEAKEST: CriterionState[] = ['failing', 'not_checked', 'you_check', 'passing', 'checked_by_you', 'proven'];
const MET = new Set<CriterionState>(['proven', 'checked_by_you']);
/** A merge counts until it is reverted: its change is in. */
export const isMerged = (r: OutcomeResult) => r.startsWith('merged') && r !== 'merged_reverted';

/**
 * `covers` names the goal criteria (from 1) each task covers, from its `goalCriteria`. A covering task that carries the
 * goal criterion as an acceptance line of its own is judged on that line; one that does not, on all of its criteria.
 */
export function goalOutcome(goal: Pick<Goal, 'id' | 'criteria' | 'limits'>, outcomes: Outcome[], covers: Record<string, number[]>): GoalOutcome {
  const criteria = goal.criteria.map(({ text }, index) => {
    const by = outcomes.filter((o) => covers[o.task]?.includes(index + 1));
    const weakest = by
      .flatMap((o) => {
        const own = o.criteria.filter((c) => c.text === text);
        return (own.length ? own : o.criteria).map((c) => ({ task: o.task, c }));
      })
      .sort((a, b) => WEAKEST.indexOf(a.c.state) - WEAKEST.indexOf(b.c.state))[0];
    const state: CriterionState = weakest?.c.state ?? 'not_checked';
    return { index, text, state, met: MET.has(state), tasks: by.map((o) => o.task), evidence: weakest ? `${weakest.task}: ${weakest.c.evidence}` : 'No task covers it yet.' };
  });
  const byResult: GoalOutcome['byResult'] = {};
  for (const o of outcomes) byResult[o.result] = (byResult[o.result] ?? 0) + 1;
  const merged = outcomes.filter((o) => isMerged(o.result)).length;
  const met = criteria.filter((c) => c.met).length;
  return {
    goal: goal.id,
    result: outcomes.length > 0 && merged === outcomes.length && met === criteria.length ? 'done' : 'in_progress',
    criteria,
    met,
    tasks: outcomes.map((o) => ({ id: o.task, result: o.result, resultLabel: o.resultLabel, covers: covers[o.task] ?? [] })),
    byResult,
    spend: { usd: Math.round(outcomes.reduce((s, o) => s + o.spend.usd, 0) * 10_000) / 10_000, unpriced: outcomes.reduce((s, o) => s + o.spend.unpriced, 0), limit: goal.limits?.usd ?? null },
    builds: { used: outcomes.reduce((s, o) => s + o.loops.builds, 0), limit: goal.limits?.builds ?? null },
    merged,
  };
}
