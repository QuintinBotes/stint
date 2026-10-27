import type { MetricDef } from '../def';
import { ratio } from '../context';

const TAMPER = ['verification.tampered', 'acceptance.tampered'];

function firstPass(def: Omit<MetricDef, 'compute'>): MetricDef {
  return {
    ...def,
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        const runs = ctx.verifiedRuns(v).filter((r) => ctx.runMatches(v, r));
        const first = runs[0];
        if (!first?.verification || !ctx.inWindow(first.verification.ts)) continue;
        den += 1;
        if (first.green) num += 1;
      }
      return { value: ratio(num, den), n: den };
    },
  };
}

export const verificationDefs: MetricDef[] = [
  firstPass({ id: 'verify.first_pass', group: 'verification', label: 'First pass', unit: 'ratio', eventTypes: ['run.started', 'run.finished', 'verification.ran'] }),
  {
    id: 'verify.attempt_pass',
    group: 'verification',
    label: 'Attempt pass',
    unit: 'ratio',
    eventTypes: ['run.started', 'run.finished', 'verification.ran'],
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        for (const r of ctx.verifiedRuns(v)) {
          if (!ctx.runMatches(v, r) || !r.verification || !ctx.inWindow(r.verification.ts)) continue;
          den += 1;
          if (r.green) num += 1;
        }
      }
      return { value: ratio(num, den), n: den };
    },
  },
  {
    id: 'verify.handoff_success',
    group: 'verification',
    label: 'Handoff success',
    unit: 'ratio',
    eventTypes: ['run.started', 'run.finished', 'verification.ran', 'handoff.created'],
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        const handoffs = v.events.map((e, i) => (e.type === 'handoff.created' ? i : -1)).filter((i) => i >= 0);
        for (const r of ctx.verifiedRuns(v)) {
          if (!ctx.runMatches(v, r) || !r.verification || !ctx.inWindow(r.verification.ts)) continue;
          if (!handoffs.some((i) => i < r.startedIndex)) continue;
          den += 1;
          if (r.green) num += 1;
        }
      }
      return { value: ratio(num, den), n: den };
    },
  },
  {
    id: 'verify.tamper_rate',
    group: 'verification',
    label: 'Tamper rate',
    unit: 'ratio',
    eventTypes: ['run.started', 'verification.ran', 'verification.tampered', 'acceptance.tampered'],
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        for (const r of ctx.verifiedRuns(v)) {
          if (!ctx.runMatches(v, r) || !r.verification || !ctx.inWindow(r.verification.ts)) continue;
          den += 1;
          if (v.events.some((e) => TAMPER.includes(e.type) && e.run === r.run && !e.payload.allowedBy)) num += 1;
        }
      }
      return { value: ratio(num, den), n: den };
    },
  },
  {
    id: 'verify.tamper_explained',
    group: 'verification',
    label: 'Tamper explained',
    unit: 'count',
    eventTypes: ['verification.tampered', 'acceptance.tampered'],
    compute: (ctx) => {
      let explained = 0;
      let all = 0;
      for (const v of ctx.views) {
        for (const e of v.events) {
          if (!TAMPER.includes(e.type) || !ctx.inWindow(e.ts)) continue;
          const run = v.runs.find((r) => r.run === e.run);
          if (ctx.breakdown && run && !ctx.runMatches(v, run)) continue;
          if (ctx.breakdown?.kind === 'tag' && !ctx.outcomeMatches(v)) continue;
          all += 1;
          if (e.payload.allowedBy) explained += 1;
        }
      }
      return { value: all === 0 ? null : explained, n: all };
    },
  },
  {
    id: 'verify.tamper_escapes',
    group: 'verification',
    label: 'Tamper escapes',
    unit: 'count',
    eventTypes: ['verification.tampered', 'acceptance.tampered', 'merge.completed'],
    compute: (ctx) => {
      let escapes = 0;
      let merges = 0;
      for (const v of ctx.views) {
        if (!v.merge || !ctx.inWindow(v.merge.ts) || !ctx.outcomeMatches(v)) continue;
        merges += 1;
        if (v.events.some((e, i) => TAMPER.includes(e.type) && !e.payload.allowedBy && i < v.mergeIndex)) escapes += 1;
      }
      return { value: merges === 0 ? null : escapes, n: merges };
    },
  },
  {
    id: 'verify.scenario_catch',
    group: 'verification',
    label: 'Scenario catch',
    unit: 'ratio',
    eventTypes: ['verification.ran', 'scenario.ran'],
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        for (const e of v.events) {
          if (e.type !== 'verification.ran' || !e.run || !ctx.inWindow(e.ts)) continue;
          const scenario = v.events.filter((s) => s.type === 'scenario.ran' && s.run === e.run).at(-1);
          if (!scenario) continue;
          const run = v.runs.find((r) => r.run === e.run);
          if (ctx.breakdown && (!run || !ctx.runMatches(v, run))) continue;
          den += 1;
          const checks = Array.isArray(e.payload.checks) ? (e.payload.checks as Array<{ name?: string; kind?: string; status?: string }>) : [];
          const tests = checks.find((c) => c.name === 'tests') ?? checks.find((c) => c.kind === 'test');
          const testsGreen = tests ? tests.status === 'green' : typeof e.payload.failed === 'number' && e.payload.failed === 0;
          const scenarioFailed = typeof scenario.payload.failed === 'number' && scenario.payload.failed > 0;
          if (testsGreen && scenarioFailed) num += 1;
        }
      }
      return { value: ratio(num, den), n: den };
    },
  },
  {
    id: 'verify.review_catch',
    group: 'verification',
    label: 'Review catch',
    unit: 'ratio',
    eventTypes: ['verification.ran', 'review.recorded'],
    compute: (ctx) => {
      let num = 0;
      let den = 0;
      for (const v of ctx.views) {
        const greenAt = v.events.findIndex((e) => e.type === 'verification.ran' && e.payload.status === 'green');
        if (greenAt < 0) continue;
        const review = v.events.slice(greenAt + 1).find((e) => e.type === 'review.recorded');
        if (!review || !ctx.inWindow(review.ts)) continue;
        if (ctx.breakdown) {
          const greenRun = v.runs.find((r) => r.run === v.events[greenAt]?.run);
          if (ctx.breakdown.kind === 'tag' ? !ctx.outcomeMatches(v) : !greenRun || !ctx.runMatches(v, greenRun)) continue;
        }
        den += 1;
        const verdict = typeof review.payload.verdict === 'string' ? review.payload.verdict : (review.payload.review as { verdict?: string } | undefined)?.verdict;
        if (verdict === 'request_changes' || verdict === 'block') num += 1;
      }
      return { value: ratio(num, den), n: den };
    },
  },
  {
    id: 'verify.golden_pass1',
    group: 'verification',
    label: 'Golden pass at 1',
    unit: 'ratio',
    eventTypes: [],
    compute: (ctx) => ({ value: ctx.input.golden ? ctx.input.golden.passAt1 : null, n: ctx.input.golden?.tasks ?? 0 }),
  },
  {
    id: 'verify.golden_passk',
    group: 'verification',
    label: 'Golden pass power k',
    unit: 'ratio',
    eventTypes: [],
    compute: (ctx) => ({ value: ctx.input.golden ? ctx.input.golden.passPowK : null, n: ctx.input.golden?.tasks ?? 0 }),
  },
];
