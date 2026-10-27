import type { MetricDef } from '../def';
import { ratio } from '../context';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const learningDefs: MetricDef[] = [
  {
    id: 'learn.skills',
    group: 'learning',
    label: 'Skills',
    unit: 'count',
    eventTypes: ['skill.status'],
    compute: (ctx) => {
      const skills = ctx.input.skills?.skills ?? [];
      return { value: skills.length, n: skills.length };
    },
  },
  {
    id: 'learn.skill_net',
    group: 'learning',
    label: 'Skill net',
    unit: 'ratio',
    eventTypes: ['skill.applied'],
    compute: (ctx) => {
      const tried = (ctx.input.skills?.skills ?? []).filter((s) => s.applied >= 3);
      return { value: ratio(tried.filter((s) => s.helped > s.hurt).length, tried.length), n: tried.length };
    },
  },
  {
    id: 'learn.proposal_yield',
    group: 'learning',
    label: 'Proposal yield',
    unit: 'ratio',
    eventTypes: ['skill.approved', 'skill.rejected'],
    compute: (ctx) => {
      let approved = 0;
      let decided = 0;
      const scan = (events: Array<{ type: string; ts: string }>) => {
        for (const e of events) {
          if ((e.type !== 'skill.approved' && e.type !== 'skill.rejected') || !ctx.inWindow(e.ts)) continue;
          decided += 1;
          if (e.type === 'skill.approved') approved += 1;
        }
      };
      for (const v of ctx.views) scan(v.events);
      scan(ctx.input.workspaceEvents ?? []);
      return { value: ratio(approved, decided), n: decided };
    },
  },
  {
    id: 'learn.eval_delta',
    group: 'learning',
    label: 'Eval delta',
    unit: 'count',
    eventTypes: ['skill.evaluated'],
    compute: (ctx) => {
      const deltas: number[] = [];
      const scan = (events: Array<{ type: string; ts: string; payload: Record<string, unknown> }>) => {
        for (const e of events) {
          if (e.type !== 'skill.evaluated' || !ctx.inWindow(e.ts)) continue;
          const withSide = e.payload.with as { findings?: unknown; passed?: unknown } | undefined;
          const without = e.payload.without as { findings?: unknown; passed?: unknown } | undefined;
          const fWith = num(withSide?.findings);
          const fWithout = num(without?.findings);
          const pWith = num(withSide?.passed);
          const pWithout = num(without?.passed);
          if (fWith === null || fWithout === null || pWith === null || pWithout === null) continue;
          deltas.push((fWithout - fWith + (pWith - pWithout)) / 2);
        }
      };
      for (const v of ctx.views) scan(v.events);
      scan(ctx.input.workspaceEvents ?? []);
      return { value: deltas.length ? deltas.reduce((s, x) => s + x, 0) / deltas.length : null, n: deltas.length };
    },
  },
];
