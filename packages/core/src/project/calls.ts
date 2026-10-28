// Browser-safe: the model calls a log records that are not runs, read by `costs()` and by a task's limits (R-062).
import type { StintEvent } from '../schemas/event';
import type { Cost } from '../schemas/handoff';

export type Spend = { at: string; key: string; host: string | null; adapter: string | null; model: string | null; role: string | null; cost: Cost | null; run: boolean };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Model calls that are not runs and record their cost on one event each: the learn step, both sides of a packet quiz,
 * the autopilot's pick among candidates, and `cost.recorded` for the rest (a packet digest in a task's log; a board
 * summary or an intake triage in the workspace log, which `task` names as `workspace`).
 */
export function callsFromEvents(task: string, events: StintEvent[]): Spend[] {
  const out: Spend[] = [];
  const call = (e: StintEvent, role: string, side: Record<string, unknown> | undefined, key: string) => {
    if (side && typeof side.cost === 'object' && side.cost !== null) out.push({ at: e.ts, key, host: str(side.host), adapter: null, model: str(side.model), role, cost: side.cost as Cost, run: false });
  };
  for (const e of events) {
    if (e.type === 'skill.proposed') call(e, 'learn', e.payload, `${task}/learn`);
    if (e.type === 'handoff.quizzed') for (const side of ['writer', 'answerer']) call(e, 'quiz', e.payload[side] as Record<string, unknown> | undefined, `${task}/quiz`);
    if (e.type === 'bestofn.picked') call(e, 'pick', e.payload, `${task}/pick`);
    if (e.type === 'sharpen.asked') call(e, 'sharpen', e.payload, `${task}/sharpen`);
    if (e.type === 'cost.recorded') call(e, String(e.payload.for), e.payload, `${task}/${String(e.payload.for)}`);
  }
  return out;
}
