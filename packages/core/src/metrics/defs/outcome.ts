import type { MetricDef } from '../def';
import { median, p90, ratio, roundUsd, taskCost, type TaskView } from '../context';
import type { StintEvent } from '../../schemas/event';

const CI_FAILING = new Set(['failure', 'failed', 'error', 'timed_out', 'action_required']);

export const ciFailing = (e: StintEvent) => typeof e.payload.status === 'string' && CI_FAILING.has(e.payload.status.toLowerCase());

function escaped(ctx: Parameters<MetricDef['compute']>[0], v: TaskView): boolean {
  return v.events.some(
    (e) => ctx.outcomeInWindow(v, e) && (e.type === 'outcome.reverted' || e.type === 'outcome.incident' || (e.type === 'outcome.ci' && ciFailing(e))),
  );
}

function mature(ctx: Parameters<MetricDef['compute']>[0]) {
  return ctx.views.filter((v) => v.merge && ctx.inWindow(v.merge.ts) && ctx.isMature(v) && ctx.outcomeMatches(v));
}

function merged(ctx: Parameters<MetricDef['compute']>[0]) {
  return ctx.views.filter((v) => v.merge && ctx.inWindow(v.merge.ts) && ctx.outcomeMatches(v));
}

function matureRatio(id: MetricDef['id'], label: string, eventTypes: string[], hit: (ctx: Parameters<MetricDef['compute']>[0], v: TaskView) => boolean): MetricDef {
  return {
    id,
    group: 'outcome',
    label,
    unit: 'ratio',
    eventTypes,
    compute: (ctx) => {
      const m = mature(ctx);
      return { value: ratio(m.filter((v) => hit(ctx, v)).length, m.length), n: m.length };
    },
  };
}

export const outcomeDefs: MetricDef[] = [
  {
    id: 'outcome.merged',
    group: 'outcome',
    label: 'Merged',
    unit: 'count',
    eventTypes: ['merge.completed'],
    compute: (ctx) => {
      const m = merged(ctx);
      return { value: m.length, n: m.length };
    },
  },
  matureRatio('outcome.escaped_defect', 'Escaped defect', ['merge.completed', 'outcome.reverted', 'outcome.ci', 'outcome.incident'], escaped),
  matureRatio('outcome.revert', 'Revert', ['merge.completed', 'outcome.reverted'], (ctx, v) => v.events.some((e) => e.type === 'outcome.reverted' && ctx.outcomeInWindow(v, e))),
  matureRatio('outcome.ci_failure', 'CI failure', ['merge.completed', 'outcome.ci'], (ctx, v) => v.events.some((e) => e.type === 'outcome.ci' && ciFailing(e) && ctx.outcomeInWindow(v, e))),
  {
    id: 'outcome.incident',
    group: 'outcome',
    label: 'Incidents',
    unit: 'count',
    eventTypes: ['merge.completed', 'outcome.incident'],
    compute: (ctx) => {
      const m = merged(ctx);
      const count = m.reduce((s, v) => s + v.events.filter((e) => e.type === 'outcome.incident' && ctx.outcomeInWindow(v, e)).length, 0);
      return { value: count, n: m.length };
    },
  },
  matureRatio('outcome.followup', 'Follow-up', ['merge.completed', 'outcome.followup'], (ctx, v) => v.events.some((e) => e.type === 'outcome.followup' && ctx.outcomeInWindow(v, e))),
  {
    id: 'outcome.lead_time',
    group: 'outcome',
    label: 'Lead time',
    unit: 'ms',
    eventTypes: ['task.created', 'merge.completed'],
    compute: (ctx) => {
      const values = merged(ctx).map((v) => Date.parse((v.merge as StintEvent).ts) - Date.parse(v.createdAt)).filter((x) => Number.isFinite(x));
      const p50 = median(values);
      return { value: p50, n: values.length, ...(p50 !== null ? { p50, p90: p90(values) as number } : {}) };
    },
  },
  {
    id: 'outcome.cycle_time',
    group: 'outcome',
    label: 'Cycle time',
    unit: 'ms',
    eventTypes: ['run.started', 'merge.completed'],
    compute: (ctx) => {
      const values: number[] = [];
      for (const v of merged(ctx)) {
        const first = v.events.find((e) => e.type === 'run.started');
        if (first && v.merge) values.push(Date.parse(v.merge.ts) - Date.parse(first.ts));
      }
      const p50 = median(values);
      return { value: p50, n: values.length, ...(p50 !== null ? { p50, p90: p90(values) as number } : {}) };
    },
  },
  {
    id: 'outcome.cost_per_merge',
    group: 'outcome',
    label: 'Cost per merge',
    unit: 'usd',
    eventTypes: ['run.started', 'run.finished', 'merge.completed'],
    compute: (ctx) => {
      const m = merged(ctx);
      const byId = new Map(ctx.views.map((v) => [v.task.id, v]));
      let usd = 0;
      let unpriced = 0;
      const seen = new Set<string>();
      const add = (v: TaskView) => {
        if (seen.has(v.task.id)) return;
        seen.add(v.task.id);
        const c = taskCost(v);
        usd += c.usd;
        unpriced += c.unpriced;
        for (const r of v.runs) {
          const from = r.adoptedFrom?.split(/\s+/)[0];
          const child = from ? byId.get(from) : undefined;
          if (child) add(child);
        }
      };
      for (const v of m) add(v);
      return { value: m.length === 0 || unpriced > 0 ? null : roundUsd(usd / m.length), n: m.length, ...(unpriced > 0 ? { unpriced } : {}) };
    },
  },
  {
    id: 'outcome.cost_per_good_merge',
    group: 'outcome',
    label: 'Cost per good merge',
    unit: 'usd',
    eventTypes: ['run.started', 'run.finished', 'merge.completed', 'outcome.reverted', 'outcome.ci', 'outcome.incident'],
    compute: (ctx) => {
      const good = mature(ctx).filter((v) => !escaped(ctx, v));
      const terminal = ctx.views.filter((v) => {
        if (!ctx.outcomeMatches(v)) return false;
        if (v.merge && ctx.inWindow(v.merge.ts) && ctx.isMature(v)) return true;
        if (v.task.status === 'abandoned') {
          const last = v.events.at(-1)?.ts ?? v.task.updatedAt;
          return ctx.inWindow(last);
        }
        return false;
      });
      let usd = 0;
      let unpriced = 0;
      for (const v of terminal) {
        const c = taskCost(v);
        usd += c.usd;
        unpriced += c.unpriced;
      }
      return { value: good.length === 0 || unpriced > 0 ? null : roundUsd(usd / good.length), n: good.length, ...(unpriced > 0 ? { unpriced } : {}) };
    },
  },
];
