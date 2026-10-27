import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, METRIC_IDS, MetricsSchema, metrics, type MetricsInput } from '../src/index';

const FIXTURES = join(import.meta.dir, 'fixtures', 'metrics');
const readJson = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const NOW = '2026-11-10T00:00:00.000Z';
const HOUR = 3_600_000;

function input(exclude: string[] = []): MetricsInput {
  return {
    tasks: ['T-0001', 'T-0002', 'T-0003', 'T-0004', 'T-0005', 'T-0006', 'T-0007', 'T-0008']
      .filter((id) => !exclude.includes(id))
      .map((id) => readJson(`${id}.json`)),
    skills: readJson('skills.json'),
    golden: readJson('golden.json'),
    config: DEFAULT_CONFIG,
    now: NOW,
    window: { from: null, to: NOW },
  };
}

const byId = (m: ReturnType<typeof metrics>, id: string) => {
  const v = Object.values(m.groups).flat().find((x) => x.id === id);
  if (!v) throw new Error(`no metric ${id}`);
  return v;
};

describe('R-061 Acceptance 1: a synthetic fixture of eight tasks covers first-time green, red then green after a handoff, unexplained tamper that merged, explained tamper, scenario-caught, reverted within the window, followed up, merged yesterday (not mature), policy-approved and unpriced', () => {
  const m = metrics(input());

  test('every id in the Definitions table is present and the output validates', () => {
    expect(MetricsSchema.safeParse(m).success).toBe(true);
    const ids = Object.values(m.groups).flat().map((v) => v.id).sort();
    expect(ids).toEqual([...METRIC_IDS].sort());
    for (const v of Object.values(m.groups).flat()) expect(v.definition).toBe(`docs/metrics.md#${v.id}`);
  });

  test('verification values match the hand arithmetic', () => {
    // First verified run green: T-0001, T-0003, T-0006, T-0007 green of 8 tasks = 4/8.
    expect(byId(m, 'verify.first_pass')).toMatchObject({ value: 0.5, n: 8, small: false });
    // Green verified runs: T-0001 r1, T-0002 r2, T-0003 r1, T-0005 r2, T-0006 r1, T-0007 r1 = 6 of 10 attempts.
    expect(byId(m, 'verify.attempt_pass')).toMatchObject({ value: 0.6, n: 10 });
    // Continued runs (after a handoff): T-0002 r2 and T-0005 r2, both green = 2/2.
    expect(byId(m, 'verify.handoff_success')).toMatchObject({ value: 1, n: 2, small: true });
    // Unexplained tamper on T-0003 r1 = 1 of 10 verified runs.
    expect(byId(m, 'verify.tamper_rate')).toMatchObject({ value: 0.1, n: 10 });
    // Explained tamper events: T-0004 only = 1, of 2 tamper events in all.
    expect(byId(m, 'verify.tamper_explained')).toMatchObject({ value: 1, n: 2 });
    // Tasks with unexplained tamper that merged: T-0003 = 1, of 6 merges.
    expect(byId(m, 'verify.tamper_escapes')).toMatchObject({ value: 1, n: 6 });
    // Verifications with a scenario: T-0001 (passed) and T-0005 r1 (tests green, scenario failed) = 1/2.
    expect(byId(m, 'verify.scenario_catch')).toMatchObject({ value: 0.5, n: 2 });
    // First review after green: T-0001 approve, T-0005 request_changes = 1/2.
    expect(byId(m, 'verify.review_catch')).toMatchObject({ value: 0.5, n: 2 });
    // Golden fixture: passAt1 0.9 and passPowK 0.8 over 10 tasks.
    expect(byId(m, 'verify.golden_pass1')).toMatchObject({ value: 0.9, n: 10 });
    expect(byId(m, 'verify.golden_passk')).toMatchObject({ value: 0.8, n: 10 });
  });

  test('outcome values match the hand arithmetic', () => {
    // Merges: T-0001, T-0002, T-0003, T-0005, T-0006, T-0007 = 6.
    expect(byId(m, 'outcome.merged')).toMatchObject({ value: 6, n: 6 });
    // Mature merges (merged on or before 2026-11-03): all but T-0006 = 5. Escaped: T-0002 reverted, T-0007 CI and incident = 2/5.
    expect(byId(m, 'outcome.escaped_defect')).toMatchObject({ value: 0.4, n: 5 });
    // Reverted: T-0002 only = 1/5. CI failure: T-0007 only = 1/5. Followed up: T-0005 only = 1/5.
    expect(byId(m, 'outcome.revert')).toMatchObject({ value: 0.2, n: 5 });
    expect(byId(m, 'outcome.ci_failure')).toMatchObject({ value: 0.2, n: 5 });
    expect(byId(m, 'outcome.followup')).toMatchObject({ value: 0.2, n: 5 });
    // Incident events on merges in the window: one on T-0007.
    expect(byId(m, 'outcome.incident')).toMatchObject({ value: 1, n: 6 });
    // Lead times in hours: 7.5, 24, 48, 96, 24, 120 sorted 7.5, 24, 24, 48, 96, 120; median (24+48)/2 = 36h, p90 = 120h.
    expect(byId(m, 'outcome.lead_time')).toMatchObject({ value: 36 * HOUR, p50: 36 * HOUR, p90: 120 * HOUR, n: 6 });
    // Cycle times are lead minus the first hour before the first run: median (23+47)/2 = 35h, p90 = 119h.
    expect(byId(m, 'outcome.cycle_time')).toMatchObject({ value: 35 * HOUR, p50: 35 * HOUR, p90: 119 * HOUR, n: 6 });
    // T-0007 is unpriced, so both unit costs are null with one unpriced run named.
    expect(byId(m, 'outcome.cost_per_merge')).toMatchObject({ value: null, n: 6, unpriced: 1 });
    expect(byId(m, 'outcome.cost_per_good_merge')).toMatchObject({ value: null, n: 3, unpriced: 1 });
  });

  test('without the unpriced task, unit costs are numbers', () => {
    const priced = metrics(input(['T-0007']));
    // (0.10 + 0.20+0.30 + 0.40 + 0.10+0.10 + 0.50) / 5 merges = 1.70 / 5 = 0.34.
    expect(byId(priced, 'outcome.cost_per_merge')).toMatchObject({ value: 0.34, n: 5 });
    // Terminal tasks: mature merges T-0001, T-0002, T-0003, T-0005 (1.20) plus abandoned T-0004 (0.10) = 1.30, over 3 good merges.
    expect(byId(priced, 'outcome.cost_per_good_merge')).toMatchObject({ value: 0.4333, n: 3 });
  });

  test('human values match the hand arithmetic', () => {
    // Interventions before the first grant: T-0001 0, T-0002 1, T-0003 0, T-0005 2, T-0006 0, T-0007 1; mean 4/6.
    expect(byId(m, 'human.interventions').value).toBeCloseTo(4 / 6, 10);
    expect(byId(m, 'human.interventions').n).toBe(6);
    // Zero interventions: T-0001, T-0003, T-0006 = 3/6.
    expect(byId(m, 'human.autonomy')).toMatchObject({ value: 0.5, n: 6 });
    // No rejection before merge: all but T-0005 = 5/6.
    expect(byId(m, 'human.first_time_approval').value).toBeCloseTo(5 / 6, 10);
    // Waits in hours: 4 (T-0001), 2 (T-0002), 1 and 3 (T-0005); median (2+3)/2 = 2.5h, p90 = 4h.
    expect(byId(m, 'human.approval_wait')).toMatchObject({ value: 2.5 * HOUR, p50: 2.5 * HOUR, p90: 4 * HOUR, n: 4, small: true });
    // Shadow records: T-0006 agreed, T-0008 disagreed = 1/2.
    expect(byId(m, 'human.policy_agreement')).toMatchObject({ value: 0.5, n: 2 });
  });

  test('learning and efficiency values match the hand arithmetic', () => {
    // Three skills in the fixture book.
    expect(byId(m, 'learn.skills')).toMatchObject({ value: 3, n: 3, small: true });
    // Applied in 3 or more: two skills; helped over hurt: one of them = 1/2.
    expect(byId(m, 'learn.skill_net')).toMatchObject({ value: 0.5, n: 2 });
    // Proposal decisions: one approved (T-0008), one rejected (T-0002) = 1/2.
    expect(byId(m, 'learn.proposal_yield')).toMatchObject({ value: 0.5, n: 2 });
    // One eval: findings 4-1 = 3 and passed 10-7 = 3, combined (3+3)/2 = 3.
    expect(byId(m, 'learn.eval_delta')).toMatchObject({ value: 3, n: 1 });
    // Implementer runs per merged task: 1+2+1+2+1+1 = 8 over 6 merges.
    expect(byId(m, 'efficiency.hops').value).toBeCloseTo(8 / 6, 10);
    // Packet tokens 300, 400, 500, 600; median (400+500)/2 = 450.
    expect(byId(m, 'efficiency.packet_tokens')).toMatchObject({ value: 450, n: 4 });
    // Priced runs: 9 runs of 1000 input tokens, cached 4500 in all = 4500/9000.
    expect(byId(m, 'efficiency.cache_share')).toMatchObject({ value: 0.5, n: 9 });
    // Nothing is fed forward as a transcript; 4 handoffs carry packets.
    expect(byId(m, 'efficiency.transcript_share')).toMatchObject({ value: 0, n: 4 });
  });

  test('values are null when n is 0 and small is true when n < 5', () => {
    const empty = metrics({ ...input(), tasks: [], skills: { skills: [] }, golden: null });
    for (const v of Object.values(empty.groups).flat()) {
      expect(v.value).toBeNull();
      expect(v.n).toBe(0);
      expect(v.small).toBe(true);
    }
  });

  test('breakdown by agent attributes attempts to the run agent', () => {
    const withBy = metrics({ ...input(), by: 'agent' });
    const row = (key: string) => withBy.breakdown?.find((b) => b.key === key)?.metrics.find((v) => v.id === 'verify.attempt_pass');
    // muse-code attempts: T-0001 green, T-0002 r1 red, T-0004 red, T-0005 r1 red and r2 green, T-0007 green = 3/6.
    expect(row('muse-code')).toMatchObject({ value: 0.5, n: 6 });
    // stint-agent attempts: T-0002 r2, T-0003, T-0006 green, T-0008 red = 3/4.
    expect(row('stint-agent')).toMatchObject({ value: 0.75, n: 4 });
  });
});
