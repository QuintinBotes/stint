// The scorecard's figures in words (R-070), one row each with the runs it rests on: the table in docs/proofs.md and
// the Factory's scorecard panel both read these rows, so the two never say a figure differently.
import type { Scorecard } from './schemas/scorecard';

/** One figure: what it measures, its result, and how many runs it rests on. */
export type ScorecardRow = [figure: string, result: string, restsOn: string];

const pct = (s: { value: number | null }) => (s.value === null ? 'none yet' : `${Math.round(s.value * 100)}%`);
const of = (s: { value: number | null; n: number }) => (s.value === null ? 'none yet' : `${Math.round(s.value * s.n)} of ${s.n} (${pct(s)})`);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Every figure of the scorecard, pass^1 and pass^k per task first, then overall, hand-off, bad patches, review, cost and time. */
export function scorecardRows(card: Scorecard): ScorecardRow[] {
  const rows: ScorecardRow[] = [];
  for (const t of card.tasks) {
    rows.push([`pass^1, ${t.id}`, of(t.pass1), plural(t.pass1.n, 'graded attempt')]);
    if (card.k > 1) rows.push([`pass^${card.k}, ${t.id}`, t.passK.value === null ? 'not yet' : t.passK.value === 1 ? `yes, all ${card.k} green` : `no, ${t.green} of ${t.pass1.n} green`, plural(t.passK.n, 'graded attempt')]);
  }
  rows.push(['pass^1, all tasks', of(card.overall.pass1), plural(card.overall.pass1.n, 'graded attempt')]);
  if (card.k > 1) rows.push([`pass^${card.k}, all tasks`, of(card.overall.passK), `${plural(card.overall.passK.n, 'task')} with ${card.k} graded attempts`]);
  rows.push(['Hand-off success: continued runs that went green', of(card.handoff), `${plural(card.handoff.n, 'continued run')} in ${plural(card.handoff.relays.length, 'relay')}`]);
  rows.push(['Bad patches stopped by the tests alone', of(card.badPatches.byTests), `${plural(card.badPatches.n, 'attempt')} the hidden tests failed`]);
  rows.push(['Bad patches stopped by the tests or the review', of(card.badPatches.byTestsAndReview), `${plural(card.badPatches.n, 'attempt')} the hidden tests failed`]);
  const r = card.review;
  rows.push(['Review caught: asked for changes, hidden tests red', String(r.caught), plural(r.n, 'reviewed attempt')]);
  rows.push(['Review missed: approved, hidden tests red', String(r.missed), plural(r.n, 'reviewed attempt')]);
  rows.push(['Review false alarm: asked for changes, hidden tests green', String(r.falseAlarm), plural(r.n, 'reviewed attempt')]);
  rows.push(['Review agreed: approved, hidden tests green', String(r.agreed), plural(r.n, 'reviewed attempt')]);
  const usd = card.perGreen.usd;
  rows.push(['Cost per green attempt', usd.value === null ? 'none yet' : `$${usd.value.toFixed(4)}`, `${plural(usd.n, 'green attempt')}${usd.unpriced ? `, ${usd.unpriced} unpriced left out` : ''}`]);
  const wall = card.perGreen.wallMs;
  rows.push(['Wall time per green attempt', wall.value === null ? 'none yet' : `${(wall.value / 60_000).toFixed(1)} min`, plural(wall.n, 'green attempt')]);
  return rows;
}
