import { type LimitName, type Limits as Caps, type StintEvent, taskUsage } from '@stint-dev/core';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, daemonMessage } from '../api';
import { money, moneyOf } from '../format';
import { useHold } from './Scrubber';
import { Button, Explain, StateMark, cx } from './ui';

const METERS: Array<{ k: LimitName; word: string }> = [
  { k: 'builds', word: 'Builds' },
  { k: 'handoffs', word: 'Hand-offs' },
  { k: 'usd', word: 'Spend' },
  { k: 'minutes', word: 'Agent time' },
];
const NAME: Record<LimitName, string> = { builds: 'build', handoffs: 'hand-off', reviewRounds: 'review round', usd: 'spend', minutes: 'agent time' };
const MAX: Record<LimitName, number> = { builds: 50, handoffs: 20, reviewRounds: 10, usd: 1000, minutes: 1440 };
// agent time under 10 minutes keeps one decimal, so a 20 s run reads 0.3 min, not 0
const show = (k: LimitName, v: number) => (k === 'usd' ? money({ usd: v }) : k === 'minutes' && v > 0 && v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));

/** One meter: used of cap with a bar, amber once it is reached. The task's limits and a goal's both use it. */
export function Meter({ id, word, value, used, cap, reached = false, note = '', dot = false }: { id: string; word: string; value: string; used: number; cap: number | null; reached?: boolean; note?: string; dot?: boolean }) {
  return (
    <li data-testid={`meter-${id}`} className={cx('inline-flex items-center gap-2 whitespace-nowrap', reached && 'text-amber')}>
      {dot ? (
        <span aria-hidden="true" className="hidden min-[760px]:inline text-ink-3">
          ·
        </span>
      ) : null}
      {reached ? <StateMark shape="attention" /> : null}
      <span>
        {word} <span className={cx('tabular font-semibold', reached ? 'text-amber' : 'text-ink')}>{value}</span>
        {note}
        {reached ? ', reached' : ''}
      </span>
      {cap === null ? null : (
        // in Windows High Contrast the fill keeps the system's text colour and the track an outline, so the bar does not vanish
        <span aria-hidden="true" className="inline-block w-12 h-1 bg-rule forced-colors:outline">
          <span className={cx('block h-full forced-color-adjust-none forced-colors:bg-[CanvasText]', reached ? 'bg-amber' : 'bg-ink')} style={{ width: `${Math.min(100, cap > 0 ? (used / cap) * 100 : 100)}%` }} />
        </span>
      )}
    </li>
  );
}

/**
 * The task's limits in the title block (R-062): one row of meters, used of cap, and when autopilot stopped at a limit,
 * the stop with two ways on: raise the limit and carry on, or hand the task to another agent from its packet.
 */
export function Limits({ taskId, events, closed = false, onHand }: { taskId: string; events: StintEvent[]; closed?: boolean; onHand: () => void }) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hold = useHold();
  // the caps change only when a person changes them; what is used comes from the log as it arrives
  const changes = useMemo(() => events.filter((e) => e.type === 'limits.changed').length, [events]);
  useEffect(() => {
    let live = true;
    api
      .limits(taskId)
      .then((m) => live && setCaps(m.limits))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId, changes]);
  const used = useMemo(() => taskUsage(events), [events]);
  // the stop stands until autopilot is switched on again or a run starts some other way, such as a hand-off
  const stop = useMemo(() => {
    // nothing is left to raise or hand on once the task is closed
    if (closed) return null;
    const last = events.findLast((e) => e.type.startsWith('autopilot.') || e.type === 'run.started');
    if (last?.type !== 'autopilot.stopped' || typeof last.payload.limit !== 'string') return null;
    // a goal's limit (R-064) is raised on the goal's page, not here
    const at = events.findLast((e) => e.type === 'limit.reached');
    const goal = at?.payload.scope === 'goal' ? String(at.payload.goal ?? '') : null;
    return { limit: last.payload.limit as LimitName, reason: String(last.payload.reason ?? ''), ...(goal ? { scope: 'goal' as const, goal } : {}) };
  }, [events, closed]);
  if (!caps) return null;

  const reached = stop?.limit ?? null;
  const cap = reached ? caps[reached] : null;
  const isUsd = reached === 'usd';
  const floor = reached ? Math.max(used[reached], cap ?? 0) : 0;
  const min = isUsd ? Math.round(floor * 100 + 1) / 100 : Math.floor(floor) + 1;
  const suggest = reached ? Math.min(MAX[reached], Math.max(min, reached === 'minutes' ? (cap ?? 0) + 30 : isUsd ? Math.ceil(floor) + 1 : min)) : 0;
  const raise = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reached || busy || hold['aria-disabled']) return;
    const value = Number(new FormData(e.currentTarget).get('cap'));
    setBusy(true);
    setError(null);
    api
      .setLimits(taskId, { [reached]: value })
      .then((m) => {
        setCaps(m.limits);
        return api.autopilot(taskId, true);
      })
      .catch((err: unknown) => setError(daemonMessage(err)))
      .finally(() => setBusy(false));
  };
  const hand = () => {
    onHand();
    // the hand-to control is on the packet tab; bring it into view with the keyboard on it once it has drawn
    let tries = 0;
    const timer = setInterval(() => {
      const target = document.querySelector<HTMLElement>('[data-testid="hand-to"] input:not(:disabled), [data-testid="hand-to"] button');
      if (target || ++tries > 20) clearInterval(timer);
      target?.focus();
    }, 50);
  };

  return (
    <div data-testid="limits" className="flex flex-col gap-3 min-w-0 basis-full min-[760px]:basis-auto">
      {/* two meters a line on a phone; one row from 760 px */}
      <ul aria-label="Limits" className="grid grid-cols-2 gap-y-1.5 min-[760px]:flex min-[760px]:flex-wrap min-[760px]:items-center gap-x-3 text-small text-ink-2">
        {/* spend with no cap and nothing unpriced is the title block's Spent already */}
        {METERS.filter(({ k }) => k !== 'usd' || caps.usd !== null || used.unpriced > 0).map(({ k, word }, i) => {
          const c = caps[k];
          return (
            <Meter
              key={k}
              id={k}
              word={word}
              dot={i > 0}
              used={used[k]}
              cap={c}
              reached={reached === k && stop?.scope !== 'goal'}
              value={k === 'usd' ? moneyOf(used.usd, c) : `${show(k, used[k])}${c === null ? '' : ` of ${show(k, c)}`}${k === 'minutes' ? ' min' : ''}`}
              note={k === 'usd' && used.unpriced ? `, ${used.unpriced} not priced` : ''}
            />
          );
        })}
      </ul>
      {stop?.scope === 'goal' ? (
        <section data-testid="limit-stop" aria-labelledby="limit-stop-title" className="stint-notice stint-notice--attention flex-col items-start mb-0 max-w-[80ch] text-body">
          <p id="limit-stop-title">
            <b className="inline-flex items-center gap-1.5 font-semibold text-amber">
              <StateMark shape="attention" />
              Needs you:
            </b>{' '}
            {stop.reason.replace(/^Needs you: /, '')} Autopilot stopped before it would go past it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/goals/${stop.goal}`} className="stint-button stint-button--primary" data-testid="limit-goal">
              Raise the goal's limits on {stop.goal}
            </Link>
            <Button onClick={hand} data-testid="limit-hand">
              Hand to another agent
            </Button>
          </div>
          <Explain word="goal" />
        </section>
      ) : reached && stop ? (
        <section data-testid="limit-stop" aria-labelledby="limit-stop-title" className="stint-notice stint-notice--attention flex-col items-start mb-0 max-w-[80ch] text-body">
          <p id="limit-stop-title">
            <b className="inline-flex items-center gap-1.5 font-semibold text-amber">
              <StateMark shape="attention" />
              Needs you:
            </b>{' '}
            {stop.reason.replace(/^Needs you: /, '')} Autopilot stopped before it would go past it.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <form className="flex flex-wrap items-end gap-2" onSubmit={raise}>
              <label className="flex flex-col gap-1 text-small text-ink-2">
                New {NAME[reached]} limit{isUsd ? ' in dollars' : reached === 'minutes' ? ' in minutes' : ''}
                <input
                  name="cap"
                  type="number"
                  required
                  min={min}
                  max={MAX[reached]}
                  step={isUsd ? 0.01 : 1}
                  defaultValue={suggest}
                  className="stint-input min-h-9 h-9 w-28 py-0 px-2.5 tabular"
                />
              </label>
              <Button tone="primary" type="submit" disabled={busy} aria-busy={busy} data-testid="raise-limit" {...hold}>
                {busy ? 'Raising the limit' : 'Raise the limit'}
              </Button>
            </form>
            <Button onClick={hand} data-testid="limit-hand">
              Hand to another agent
            </Button>
          </div>
          <p className="text-small text-ink-2">Raising it puts the task back on autopilot. Handing it on starts another agent from the packet now.</p>
          {error ? (
            <p role="alert" className="text-red">
              The limit was not changed: {error}
            </p>
          ) : null}
          <Explain word="limit" />
        </section>
      ) : null}
    </div>
  );
}
