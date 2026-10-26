import type { StintEvent } from '../schemas/event';
import type { Task } from '../schemas/task';
import { runsFromEvents } from './index';

/**
 * The scoreboard (R-045): how each agent and model has done, per tag. An attempt is an implementer run the
 * daemon verified; it passed when the run completed and its verification was green. A task is resolved by
 * the agent whose implementer run came last before its merge.
 */
export type ScoreRow = {
  tag: string;
  agent: string;
  model: string | null;
  runs: number;
  attempts: number;
  passed: number;
  /** passed / attempts, null before the first attempt. */
  passRate: number | null;
  /** All three of the last three attempts passed; null with fewer than three. */
  pass3: boolean | null;
  resolved: number;
  /** Spend on the tasks this agent resolved, divided by how many; null when none or none priced. */
  costPerResolved: number | null;
  reverts: number;
};

/** Every row is also counted under this tag, so an agent's overall record is one row. */
export const ALL_TAGS = '*';

type Attempt = { at: string; passed: boolean };
type Acc = { runs: number; attempts: Attempt[]; resolved: number; resolvedUsd: number; priced: boolean; reverts: number };

export function scoreboard(tasks: Array<{ task: Task; events: StintEvent[] }>): ScoreRow[] {
  const acc = new Map<string, Acc & { tag: string; agent: string; model: string | null }>();
  const get = (tag: string, agent: string, model: string | null) => {
    const key = `${tag}\u0000${agent}\u0000${model ?? ''}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { tag, agent, model, runs: 0, attempts: [], resolved: 0, resolvedUsd: 0, priced: true, reverts: 0 }));
    return a;
  };

  for (const { task, events } of tasks) {
    const tags = [ALL_TAGS, ...new Set(task.tags ?? [])];
    const impl = runsFromEvents(events).filter((r) => r.role === 'implementer' && r.adapter);
    // an adopted run (best of n) only moves a candidate's work; the candidate's own runs are counted on it
    const counted = impl.filter((r) => !events.some((e) => e.type === 'run.started' && e.run === r.run && e.payload.adoptedFrom));
    for (const r of counted) {
      const verification = events.filter((e) => e.type === 'verification.ran' && e.run === r.run).at(-1);
      for (const tag of tags) {
        const a = get(tag, r.adapter as string, r.model);
        a.runs += 1;
        if (verification) a.attempts.push({ at: verification.ts, passed: r.endedBy === 'completed' && verification.payload.status === 'green' });
      }
    }
    const merge = events.find((e) => e.type === 'merge.completed');
    if (!merge) continue;
    const by = impl.filter((r) => r.startedAt <= merge.ts).at(-1);
    if (!by?.adapter) continue;
    const spend = impl.filter((r) => r.adapter === by.adapter && r.model === by.model);
    const reverted = events.filter((e) => e.type === 'outcome.reverted').length;
    for (const tag of tags) {
      const a = get(tag, by.adapter, by.model);
      a.resolved += 1;
      a.reverts += reverted;
      for (const r of spend) {
        if (r.cost?.usd === null || r.cost?.usd === undefined) a.priced = false;
        else a.resolvedUsd += r.cost.usd;
      }
    }
  }

  return [...acc.values()]
    .map((a) => {
      const attempts = [...a.attempts].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
      const passed = attempts.filter((t) => t.passed).length;
      const last3 = attempts.slice(-3);
      return {
        tag: a.tag,
        agent: a.agent,
        model: a.model,
        runs: a.runs,
        attempts: attempts.length,
        passed,
        passRate: attempts.length ? passed / attempts.length : null,
        pass3: last3.length < 3 ? null : last3.every((t) => t.passed),
        resolved: a.resolved,
        costPerResolved: a.resolved && a.priced ? Math.round((a.resolvedUsd / a.resolved) * 10_000) / 10_000 : null,
        reverts: a.reverts,
      };
    })
    .sort((x, y) => (x.tag === y.tag ? (y.passRate ?? -1) - (x.passRate ?? -1) || y.attempts - x.attempts : x.tag < y.tag ? -1 : 1));
}
