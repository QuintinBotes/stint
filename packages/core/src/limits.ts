// Limits a person sets on a task (R-062): what applies, and what the task has used, both read from plain data.
import { callsFromEvents } from './project/calls';
import type { Config } from './schemas/config';
import type { StintEvent } from './schemas/event';
import type { Cost } from './schemas/handoff';
import type { Task } from './schemas/task';

export const LIMIT_NAMES = ['builds', 'handoffs', 'reviewRounds', 'usd', 'minutes'] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];
/** The caps that apply to a task; null is no limit. */
export type Limits = Record<LimitName, number | null>;
export type TaskUsage = Record<LimitName, number> & { unpriced: number };

export const LIMIT_DEFAULTS: Limits = { builds: 8, handoffs: 3, reviewRounds: 1, usd: null, minutes: null };

/**
 * The one place a task's limits meet the defaults: the task's own value, then `budgets.usdCap` for spend, then
 * `config.limits`, then `autopilot.maxHops` for hand-offs, so a config written before limits keeps its meaning.
 */
export function effectiveLimits(task: Pick<Task, 'limits' | 'budgets'>, config: Pick<Config, 'limits' | 'autopilot'>): Limits {
  const out = { ...LIMIT_DEFAULTS };
  for (const k of LIMIT_NAMES) {
    // a usdCap of 0 cannot be a spend limit (limits.usd is above 0), so it reads as unset
    const cap = k === 'usd' && task.budgets.usdCap ? task.budgets.usdCap : undefined;
    const v = [task.limits?.[k], cap, config.limits?.[k], k === 'handoffs' ? config.autopilot?.maxHops : undefined].find((x) => x !== undefined);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * What a task has used over its whole log, not since autopilot was last switched on, so a restart resets nothing.
 * A build is an implementer run that ended, not one adopted from a best-of-n candidate; spend is the task's runs and
 * its other model calls as `costs()` counts them; agent time counts a run still going up to `now`.
 */
export function taskUsage(events: StintEvent[], now = Date.now()): TaskUsage {
  const u: TaskUsage = { builds: 0, handoffs: 0, reviewRounds: 0, usd: 0, unpriced: 0, minutes: 0 };
  const spend = (c: Cost | null | undefined) => {
    if (typeof c?.usd === 'number') u.usd += c.usd;
    else u.unpriced += 1;
  };
  const open = new Map<string, StintEvent>();
  let ms = 0;
  for (const e of events) {
    if (e.type === 'run.started' && e.run) open.set(e.run, e);
    else if (e.type === 'run.finished' && e.run) {
      const s = open.get(e.run);
      if (!s) continue;
      open.delete(e.run);
      ms += Math.max(0, Date.parse(e.ts) - Date.parse(s.ts));
      spend(e.payload.cost as Cost | undefined);
      if (s.payload.role === 'implementer' && !s.payload.adoptedFrom) u.builds += 1;
    } else if (e.type === 'autopilot.step') {
      if (e.payload.step === 'hand' || e.payload.step === 'escalate') u.handoffs += 1;
      if (e.payload.step === 'build' && e.payload.changes) u.reviewRounds += 1;
    }
  }
  for (const s of open.values()) ms += Math.max(0, now - Date.parse(s.ts));
  for (const c of callsFromEvents(events[0]?.task ?? 'task', events)) spend(c.cost);
  u.usd = Math.round(u.usd * 10_000) / 10_000;
  u.minutes = Math.round(ms / 600) / 100;
  return u;
}
