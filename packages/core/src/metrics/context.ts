import type { StintEvent } from '../schemas/event';
import type { Task } from '../schemas/task';
import type { Cost } from '../schemas/handoff';

/** One skill's standing, as the daemon's track book computes it. */
export type MetricsSkill = { id: string; status: string; applied: number; helped: number; hurt: number };

/** The golden set's headline numbers, from bench/golden-results.json. */
export type MetricsGolden = { k: number; passAt1: number; passPowK: number; tasks: number; createdAt?: string; commit?: string };

export type MetricsInput = {
  tasks: Array<{ task: Task; events: StintEvent[] }>;
  workspaceEvents?: StintEvent[];
  skills?: { skills: MetricsSkill[] };
  golden?: MetricsGolden | null;
  config: { metrics?: { outcomeWindowDays: number; targets?: Record<string, { min?: number; max?: number }> } };
  now: string;
  window: { from: string | null; to: string };
  by?: 'agent' | 'model' | 'tag';
};

export type Breakdown = { kind: 'agent' | 'model' | 'tag'; key: string };

export type RunView = {
  run: string;
  adapter: string | null;
  model: string | null;
  role: string | null;
  startedAt: string;
  startedIndex: number;
  endedBy: string | null;
  endedAt: string | null;
  cost: Cost | null;
  adopted: boolean;
  adoptedFrom: string | null;
  verification: { ts: string; status: string } | null;
  green: boolean;
};

export type TaskView = {
  task: Task;
  events: StintEvent[];
  runs: RunView[];
  createdAt: string;
  merge: StintEvent | null;
  mergeIndex: number;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const DAY_MS = 86_400_000;

function runViews(events: StintEvent[]): RunView[] {
  const runs = new Map<string, RunView>();
  events.forEach((e, i) => {
    if (!e.run) return;
    if (e.type === 'run.started') {
      runs.set(e.run, {
        run: e.run,
        adapter: e.adapter ?? str(e.payload.adapter),
        model: str(e.payload.model),
        role: str(e.payload.role),
        startedAt: e.ts,
        startedIndex: i,
        endedBy: null,
        endedAt: null,
        cost: null,
        adopted: Boolean(str(e.payload.adoptedFrom)),
        adoptedFrom: str(e.payload.adoptedFrom),
        verification: null,
        green: false,
      });
    } else if (e.type === 'run.finished') {
      const r = runs.get(e.run);
      if (!r) return;
      r.endedAt = e.ts;
      r.endedBy = str(e.payload.endedBy);
      r.cost = (e.payload.cost as Cost | undefined) ?? null;
      if (!r.model) r.model = str(e.payload.model);
    }
  });
  for (const e of events) {
    if (e.type !== 'verification.ran' || !e.run) continue;
    const r = runs.get(e.run);
    if (r) r.verification = { ts: e.ts, status: str(e.payload.status) ?? '' };
  }
  const out = [...runs.values()].sort((a, b) => Number(a.run.slice(1)) - Number(b.run.slice(1)));
  for (const r of out) r.green = r.endedBy === 'completed' && r.verification?.status === 'green';
  return out;
}

export type MetricsContext = {
  input: MetricsInput;
  views: TaskView[];
  outcomeWindowDays: number;
  nowMs: number;
  breakdown: Breakdown | null;
  inWindow: (ts: string) => boolean;
  verifiedRuns: (v: TaskView) => RunView[];
  runMatches: (v: TaskView, r: RunView) => boolean;
  outcomeMatches: (v: TaskView) => boolean;
  isMature: (v: TaskView) => boolean;
  outcomeInWindow: (v: TaskView, e: StintEvent) => boolean;
  resolvingRun: (v: TaskView) => RunView | null;
};

export function makeContext(input: MetricsInput, breakdown: Breakdown | null): MetricsContext {
  const views: TaskView[] = input.tasks.map(({ task, events }) => {
    const mergeIndex = events.findIndex((e) => e.type === 'merge.completed');
    const created = events.find((e) => e.type === 'task.created');
    return { task, events, runs: runViews(events), createdAt: created?.ts ?? task.createdAt, merge: mergeIndex >= 0 ? (events[mergeIndex] as StintEvent) : null, mergeIndex };
  });
  const fromMs = input.window.from === null ? Number.NEGATIVE_INFINITY : Date.parse(input.window.from);
  const toMs = Date.parse(input.window.to);
  const nowMs = Date.parse(input.now);
  const outcomeWindowDays = input.config.metrics?.outcomeWindowDays ?? 7;
  const inWindow = (ts: string) => {
    const t = Date.parse(ts);
    return t >= fromMs && t < toMs;
  };
  const verifiedRuns = (v: TaskView) => v.runs.filter((r) => r.role === 'implementer' && r.adapter && !r.adopted && r.verification);
  const resolvingRun = (v: TaskView): RunView | null => {
    if (!v.merge) return null;
    return v.runs.filter((r) => r.role === 'implementer' && r.adapter && r.startedAt <= (v.merge as StintEvent).ts).at(-1) ?? null;
  };
  const runMatches = (v: TaskView, r: RunView): boolean => {
    if (!breakdown) return true;
    if (breakdown.kind === 'agent') return r.adapter === breakdown.key;
    if (breakdown.kind === 'model') return (r.model ?? 'unknown') === breakdown.key;
    return breakdown.key === '*' || (v.task.tags ?? []).includes(breakdown.key);
  };
  const outcomeMatches = (v: TaskView): boolean => {
    if (!breakdown) return true;
    if (breakdown.kind === 'tag') return breakdown.key === '*' || (v.task.tags ?? []).includes(breakdown.key);
    const r = resolvingRun(v);
    if (!r) return false;
    return breakdown.kind === 'agent' ? r.adapter === breakdown.key : (r.model ?? 'unknown') === breakdown.key;
  };
  const isMature = (v: TaskView) => Boolean(v.merge && Date.parse(v.merge.ts) <= nowMs - outcomeWindowDays * DAY_MS);
  const outcomeInWindow = (v: TaskView, e: StintEvent) => {
    if (!v.merge) return false;
    const d = Date.parse(e.ts) - Date.parse(v.merge.ts);
    return d >= 0 && d <= outcomeWindowDays * DAY_MS;
  };
  return { input, views, outcomeWindowDays, nowMs, breakdown, inWindow, verifiedRuns, runMatches, outcomeMatches, isMature, outcomeInWindow, resolvingRun };
}

export const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank p90. */
export function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] as number;
}

export const roundUsd = (v: number) => Math.round(v * 10_000) / 10_000;

/** Total cost of every run on a task, with how many runs carry no price. */
export function taskCost(v: TaskView): { usd: number; unpriced: number } {
  let usd = 0;
  let unpriced = 0;
  for (const r of v.runs) {
    if (r.cost?.usd === null || r.cost?.usd === undefined) unpriced += 1;
    else usd += r.cost.usd;
  }
  return { usd, unpriced };
}
