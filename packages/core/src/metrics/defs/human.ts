import type { MetricDef } from '../def';
import { median, p90, ratio, type TaskView } from '../context';

const HUMAN_TYPES = new Set(['human.command', 'decision.recorded', 'permission.decided', 'approval.rejected']);

function interventions(v: TaskView): number {
  const grantAt = v.events.findIndex((e) => e.type === 'approval.granted');
  const before = grantAt >= 0 ? v.events.slice(0, grantAt) : v.events;
  return before.filter((e) => e.vendor === 'human' && HUMAN_TYPES.has(e.type)).length;
}

function mergedViews(ctx: Parameters<MetricDef['compute']>[0]) {
  return ctx.views.filter((v) => v.merge && ctx.inWindow(v.merge.ts) && ctx.outcomeMatches(v));
}

export const humanDefs: MetricDef[] = [
  {
    id: 'human.interventions',
    group: 'human',
    label: 'Interventions per merge',
    unit: 'count',
    eventTypes: ['human.command', 'decision.recorded', 'permission.decided', 'approval.rejected', 'approval.granted', 'merge.completed'],
    compute: (ctx) => {
      const m = mergedViews(ctx);
      const total = m.reduce((s, v) => s + interventions(v), 0);
      return { value: ratio(total, m.length), n: m.length };
    },
  },
  {
    id: 'human.autonomy',
    group: 'human',
    label: 'Autonomy',
    unit: 'ratio',
    eventTypes: ['human.command', 'decision.recorded', 'permission.decided', 'approval.rejected', 'approval.granted', 'merge.completed'],
    compute: (ctx) => {
      const m = mergedViews(ctx);
      return { value: ratio(m.filter((v) => interventions(v) === 0).length, m.length), n: m.length };
    },
  },
  {
    id: 'human.first_time_approval',
    group: 'human',
    label: 'First-time approval',
    unit: 'ratio',
    eventTypes: ['approval.rejected', 'merge.completed'],
    compute: (ctx) => {
      const m = mergedViews(ctx);
      const ok = m.filter((v) => !v.events.some((e, i) => e.type === 'approval.rejected' && i < v.mergeIndex)).length;
      return { value: ratio(ok, m.length), n: m.length };
    },
  },
  {
    id: 'human.approval_wait',
    group: 'human',
    label: 'Approval wait',
    unit: 'ms',
    eventTypes: ['approval.requested', 'approval.granted', 'approval.rejected'],
    compute: (ctx) => {
      const waits: number[] = [];
      for (const v of ctx.views) {
        // By tag the task decides; by agent or model only a merged task has a resolving run to credit.
        if (ctx.breakdown && (ctx.breakdown.kind === 'tag' ? !ctx.outcomeMatches(v) : !v.merge || !ctx.outcomeMatches(v))) continue;
        let pending: string | null = null;
        for (const e of v.events) {
          if (e.type === 'approval.requested') pending = e.ts;
          else if (pending && (e.type === 'approval.rejected' || (e.type === 'approval.granted' && e.payload.by !== 'policy'))) {
            if (ctx.inWindow(e.ts)) waits.push(Date.parse(e.ts) - Date.parse(pending));
            pending = null;
          }
        }
      }
      const p50 = median(waits);
      return { value: p50, n: waits.length, ...(p50 !== null ? { p50, p90: p90(waits) as number } : {}) };
    },
  },
  {
    id: 'human.policy_agreement',
    group: 'human',
    label: 'Policy agreement',
    unit: 'ratio',
    eventTypes: ['autoapprove.shadow'],
    compute: (ctx) => {
      let agreed = 0;
      let all = 0;
      const scan = (events: TaskView['events'], v?: TaskView) => {
        for (const e of events) {
          if (e.type !== 'autoapprove.shadow' || !ctx.inWindow(e.ts)) continue;
          if (v && ctx.breakdown?.kind === 'tag' && !ctx.outcomeMatches(v)) continue;
          all += 1;
          if (Boolean(e.payload.wouldApprove) === (e.payload.humanDecision === 'approved')) agreed += 1;
        }
      };
      for (const v of ctx.views) scan(v.events, v);
      scan(ctx.input.workspaceEvents ?? []);
      return { value: ratio(agreed, all), n: all };
    },
  },
];
