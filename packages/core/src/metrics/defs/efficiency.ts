import type { MetricDef } from '../def';
import { median, ratio } from '../context';

export const efficiencyDefs: MetricDef[] = [
  {
    id: 'efficiency.hops',
    group: 'efficiency',
    label: 'Hops per merge',
    unit: 'count',
    eventTypes: ['run.started', 'merge.completed'],
    compute: (ctx) => {
      const m = ctx.views.filter((v) => v.merge && ctx.inWindow(v.merge.ts) && ctx.outcomeMatches(v));
      const total = m.reduce((s, v) => s + v.runs.filter((r) => r.role === 'implementer').length, 0);
      return { value: ratio(total, m.length), n: m.length };
    },
  },
  {
    id: 'efficiency.packet_tokens',
    group: 'efficiency',
    label: 'Packet tokens',
    unit: 'tokens',
    eventTypes: ['handoff.created'],
    compute: (ctx) => {
      const tokens: number[] = [];
      for (const v of ctx.views) {
        if (ctx.breakdown?.kind === 'tag' && !ctx.outcomeMatches(v)) continue;
        for (const e of v.events) {
          if (e.type !== 'handoff.created' || !ctx.inWindow(e.ts) || typeof e.payload.tokens !== 'number') continue;
          tokens.push(e.payload.tokens);
        }
      }
      return { value: median(tokens), n: tokens.length };
    },
  },
  {
    id: 'efficiency.cache_share',
    group: 'efficiency',
    label: 'Cache share',
    unit: 'ratio',
    eventTypes: ['run.finished'],
    compute: (ctx) => {
      let input = 0;
      let cached = 0;
      let n = 0;
      for (const v of ctx.views) {
        for (const r of v.runs) {
          if (!r.endedAt || !r.cost || r.cost.usd === null || !ctx.inWindow(r.endedAt)) continue;
          if (ctx.breakdown && !ctx.runMatches(v, r)) continue;
          n += 1;
          input += r.cost.inputTokens;
          cached += r.cost.cachedTokens;
        }
      }
      return { value: input === 0 ? null : cached / input, n };
    },
  },
  {
    id: 'efficiency.transcript_share',
    group: 'efficiency',
    label: 'Transcript share',
    unit: 'ratio',
    eventTypes: ['handoff.created'],
    compute: (ctx) => {
      let handoffs = 0;
      for (const v of ctx.views) {
        for (const e of v.events) if (e.type === 'handoff.created' && ctx.inWindow(e.ts)) handoffs += 1;
      }
      // Packets, never transcripts: nothing is fed forward as a transcript, as the Factory figure says.
      return { value: handoffs === 0 ? null : 0, n: handoffs };
    },
  },
];
