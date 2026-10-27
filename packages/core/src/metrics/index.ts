import type { MetricValue, Metrics } from '../schemas/metrics';
import { makeContext, type Breakdown, type MetricsInput } from './context';
import type { MetricDef } from './def';
import { efficiencyDefs } from './defs/efficiency';
import { humanDefs } from './defs/human';
import { learningDefs } from './defs/learning';
import { outcomeDefs } from './defs/outcome';
import { verificationDefs } from './defs/verification';
import { METRIC_GROUPS, type MetricGroup } from './ids';

export { METRIC_GROUPS, METRIC_GROUP, METRIC_IDS, type MetricGroup as MetricsGroup, type MetricId } from './ids';
export type { MetricsGolden, MetricsInput, MetricsSkill } from './context';
export type { MetricDef } from './def';

/** Every metric definition, one small function each. The docs test walks this list. */
export const METRIC_DEFS: MetricDef[] = [...verificationDefs, ...outcomeDefs, ...humanDefs, ...learningDefs, ...efficiencyDefs];

function valueOf(def: MetricDef, ctx: ReturnType<typeof makeContext>): MetricValue {
  const r = def.compute(ctx);
  const target = ctx.input.config.metrics?.targets?.[def.id];
  const value = r.n === 0 ? null : r.value;
  return {
    id: def.id,
    group: def.group,
    label: def.label,
    unit: def.unit,
    value,
    n: r.n,
    small: r.n < 5,
    ...(r.p50 !== undefined ? { p50: r.p50 } : {}),
    ...(r.p90 !== undefined ? { p90: r.p90 } : {}),
    ...(r.unpriced !== undefined ? { unpriced: r.unpriced } : {}),
    ...(target
      ? { target: { ...target, met: value !== null && (target.min === undefined || value >= target.min) && (target.max === undefined || value <= target.max) } }
      : {}),
    definition: `docs/metrics.md#${def.id}`,
  };
}

function allValues(input: MetricsInput, breakdown: Breakdown | null): MetricValue[] {
  const ctx = makeContext(input, breakdown);
  return METRIC_DEFS.map((d) => valueOf(d, ctx));
}

function breakdownKeys(input: MetricsInput, kind: NonNullable<MetricsInput['by']>): string[] {
  const keys = new Set<string>();
  const ctx = makeContext(input, null);
  for (const v of ctx.views) {
    if (kind === 'tag') {
      keys.add('*');
      for (const t of v.task.tags ?? []) keys.add(t);
    } else {
      for (const r of v.runs) {
        if (r.role !== 'implementer') continue;
        if (kind === 'agent' && r.adapter) keys.add(r.adapter);
        if (kind === 'model') keys.add(r.model ?? 'unknown');
      }
    }
  }
  return [...keys].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)));
}

/**
 * Verification and outcome metrics (R-061): one pure projection over the task
 * event logs. Definitions live in docs/metrics.md; each metric is one small
 * function in defs/. Values are null when n is 0; small is true when n < 5.
 */
export function metrics(input: MetricsInput): Metrics {
  const values = allValues(input, null);
  const groups = Object.fromEntries(METRIC_GROUPS.map((g) => [g, values.filter((v) => v.group === g)])) as Record<MetricGroup, MetricValue[]>;
  const out: Metrics = {
    version: 'stint.metrics/1',
    window: input.window,
    by: input.by ?? null,
    generatedAt: input.now,
    groups,
  };
  if (input.by) {
    out.breakdown = breakdownKeys(input, input.by).map((key) => ({ key, metrics: allValues(input, { kind: input.by as Breakdown['kind'], key }) }));
  }
  return out;
}

export const WINDOWS = ['7d', '30d', '90d', 'all'] as const;
export type WindowName = (typeof WINDOWS)[number];

/** The [from, to) span a window name means, ending at now. */
export function windowFor(name: WindowName, now: string): { from: string | null; to: string } {
  if (name === 'all') return { from: null, to: now };
  const days = Number(name.slice(0, -1));
  return { from: new Date(Date.parse(now) - days * 86_400_000).toISOString(), to: now };
}

/** One [from, to) span per ISO week (Monday, UTC) overlapping the window, oldest first. */
export function weekWindows(window: { from: string | null; to: string }, earliest: string | null): Array<{ from: string; to: string }> {
  const toMs = Date.parse(window.to);
  const startMs = window.from !== null ? Date.parse(window.from) : earliest !== null ? Date.parse(earliest) : toMs;
  const monday = (ms: number) => {
    const d = new Date(ms);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime();
  };
  const out: Array<{ from: string; to: string }> = [];
  for (let w = monday(startMs); w < toMs; w += 7 * 86_400_000) {
    out.push({ from: new Date(w).toISOString(), to: new Date(Math.min(w + 7 * 86_400_000, toMs)).toISOString() });
  }
  return out.length ? out : [{ from: new Date(monday(toMs)).toISOString(), to: window.to }];
}
