import type { StintEvent } from '../schemas/event';

/** A reviewed task, as its last review left it. */
export type LearningPoint = { task: string; findings: number; at: string };
/** A skill's first approval; `after` counts the points reviewed before it, so the mark stands between points. */
export type LearningApproval = { skill: string; at: string; after: number };
export type LearningCurve = { points: LearningPoint[]; approvals: LearningApproval[] };

const ms = (ts: string) => Date.parse(ts);

/**
 * Review findings over time (R-070): one point per reviewed task with the findings of its last review, in the order those
 * reviews ran, and a mark where each skill was approved. It reads events only, so the replay and a live workspace draw it
 * alike. Pass every task log in its own order, and the workspace log, where a skill with no task to carry it is approved.
 */
export function learningCurve(events: StintEvent[]): LearningCurve {
  const last = new Map<string, LearningPoint>();
  const approved = new Map<string, string>();
  for (const e of events) {
    // a later review replaces an earlier one; with lenses, the combined review is the last one written
    if (e.type === 'review.recorded' && typeof e.payload.findings === 'number') last.set(e.task, { task: e.task, findings: e.payload.findings, at: e.ts });
    if (e.type === 'skill.approved' && typeof e.payload.id === 'string') {
      const first = approved.get(e.payload.id);
      if (first === undefined || ms(e.ts) < ms(first)) approved.set(e.payload.id, e.ts);
    }
  }
  const points = [...last.values()].sort((a, b) => ms(a.at) - ms(b.at) || a.task.localeCompare(b.task));
  const approvals = [...approved.entries()]
    .map(([skill, at]) => ({ skill, at, after: points.filter((p) => ms(p.at) < ms(at)).length }))
    .sort((a, b) => ms(a.at) - ms(b.at) || a.skill.localeCompare(b.skill));
  return { points, approvals };
}

/** The chart in words, one sentence per approval: "Findings fell from 2 on T-0042 to 0 on T-0043 after limiter-config-via-env was approved." */
export function learningWords({ points, approvals }: LearningCurve): string {
  if (approvals.length === 0) return 'No skill has been approved yet.';
  return approvals
    .map(({ skill, after }) => {
      const before = points[after - 1];
      const next = points[after];
      if (!next) return `No task has been reviewed since ${skill} was approved.`;
      if (!before) return `Every task here was reviewed after ${skill} was approved.`;
      if (before.findings === next.findings) return `Findings stayed at ${before.findings} from ${before.task} to ${next.task} after ${skill} was approved.`;
      return `Findings ${next.findings < before.findings ? 'fell' : 'rose'} from ${before.findings} on ${before.task} to ${next.findings} on ${next.task} after ${skill} was approved.`;
    })
    .join(' ');
}
