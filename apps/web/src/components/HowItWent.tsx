import { CRITERION_STATE_LABELS, type CriterionState, type Outcome, outcomeLine } from '@stint-dev/core';
import { useEffect, useState } from 'react';
import { type TaskBundle, api } from '../api';
import { localDate } from '../format';
import { Explain, type Shape, StateMark, cx, rev } from './ui';

// green and a tick only for proven, amber and a triangle only for failing, ink for the rest; the words carry the meaning
const INK: Partial<Record<CriterionState, string>> = { proven: 'text-green', failing: 'text-amber' };
const MARK: Partial<Record<CriterionState, Shape>> = { proven: 'verified', failing: 'attention' };
// an ordinary table's caption: a heading above it, not the revision block's boxed one
const caption = 'caption-top pb-2 text-left font-semibold';
const label = (s: CriterionState) => (s === 'passing' ? 'Passes, but no test showed it failing first' : CRITERION_STATE_LABELS[s]);

/** "1 of 3 criteria proven, 1 failing, 1 for you to check" */
function tally(o: Outcome): string {
  const n = (s: CriterionState) => o.criteria.filter((c) => c.state === s).length;
  const parts = [`${n('proven')} of ${o.criteria.length} criteria proven`];
  if (n('failing')) parts.push(`${n('failing')} failing`);
  if (n('you_check')) parts.push(`${n('you_check')} for you to check`);
  return parts.join(', ');
}

/**
 * How it went (R-063): each acceptance criterion with its state in words, and one line of loops, spend and time to green.
 * At the gate the criteria fold under one line, so Approve stays in view; they open by themselves when one fails or
 * waits for you. With `after`, the task view of a merged, rejected or abandoned task: the result and what happened after merge.
 */
export function HowItWent({ bundle, after = false }: { bundle: TaskBundle; after?: boolean }) {
  const [o, setO] = useState<Outcome | null>(null);
  // the bundle refetches as the task's events arrive, so the outcome follows it
  useEffect(() => {
    let live = true;
    api
      .outcome(bundle.task.id)
      .then((x) => live && setO(x))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bundle]);
  if (!o) return null;
  const criteria = (
    <table className={cx(rev.table, 'table-fixed')} aria-label={after ? undefined : 'Criteria'}>
      {after ? <caption className={caption}>Criteria</caption> : null}
      <colgroup>
        <col />
        <col className="w-[42%]" />
      </colgroup>
      <tbody>
        {o.criteria.map((c) => (
          <tr key={c.index} data-testid="outcome-criterion" data-state={c.state}>
            <th scope="row" className={cx(rev.td, 'font-normal [overflow-wrap:anywhere]')}>
              {c.text}
              {/* the passing label already says what its evidence would */}
              {c.state === 'passing' ? null : <span className="block mt-0.5 text-ink-2">{c.evidence}</span>}
            </th>
            <td className={cx(rev.td, 'font-medium', INK[c.state] ?? 'text-ink')}>
              <span className="flex items-baseline gap-1.5">
                {MARK[c.state] ? <StateMark shape={MARK[c.state] as Shape} className="translate-y-px" /> : null}
                {label(c.state)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const proof = o.criteria.some((c) => c.state === 'passing') ? <Explain word="proof" className="mt-1" /> : null;
  const line = (
    <p className="mt-1.5 tabular" data-testid="outcome-line">
      {outcomeLine(o)}.
    </p>
  );
  if (!after) {
    return (
      <div data-testid="how-it-went">
        <details open={o.criteria.some((c) => c.state === 'failing' || c.state === 'you_check')}>
          <summary className="w-fit min-h-6 cursor-pointer font-semibold hover:underline underline-offset-4">How it went: {tally(o)}</summary>
          <div className="mt-1.5">
            {criteria}
            {proof}
          </div>
        </details>
        {line}
      </div>
    );
  }
  const m = o.afterMerge;
  // folded to one line under the title block, so the runs and the work keep their height on a laptop screen
  return (
    <details data-testid="how-it-went" aria-label="How it went" className="shrink-0 px-4 min-[760px]:px-6 py-2 border-b border-rule bg-ground">
      <summary className="w-fit min-h-6 cursor-pointer hover:underline underline-offset-4">
        <span className="font-semibold">
          How it went: <span data-testid="outcome-result">{o.resultLabel}</span>.
        </span>{' '}
        <span className="text-ink-2">{tally(o)}.</span>
        {m && !m.window.mature ? (
          <span className="text-ink-2" data-testid="outcome-watching">
            {' '}
            Watching for reverts and follow-ups until {localDate(m.window.endsAt)}.
          </span>
        ) : null}
      </summary>
      <div className="mt-2 mb-1 grid grid-cols-1 min-[1180px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-6 gap-y-3 max-w-[1200px]">
        <div className="min-w-0">
          {criteria}
          <div className="flex flex-wrap items-baseline gap-x-4">
            {line}
            {proof}
          </div>
        </div>
        {m ? (
          <div className="min-w-0" data-testid="outcome-after-merge">
            <table className={rev.table}>
              <caption className={caption}>
                After merge, within {m.window.days} day{m.window.days === 1 ? '' : 's'}
              </caption>
              <tbody>
                {[
                  ['Reverted', m.reverted ? 'Yes' : 'No'],
                  ['Follow-ups', m.followups.length ? m.followups.join(', ') : 'None'],
                  ['CI', m.ci ? `Failed (${m.ci.status}${m.ci.run ? `, run ${m.ci.run}` : ''})` : 'No failure recorded'],
                  ['Incidents', m.incidents.length ? m.incidents.join('; ') : 'None'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row" className={cx(rev.th, 'w-28')}>
                      {k}
                    </th>
                    <td className={rev.td}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </details>
  );
}
