import { type LimitName, type Limits as Caps, type StintEvent, taskUsage } from '@stint-dev/core';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api, daemonMessage } from '../api';
import { money } from '../format';
import { Button, Explain, cx } from './ui';

const METERS: Array<{ k: LimitName; word: string }> = [
  { k: 'builds', word: 'Builds' },
  { k: 'handoffs', word: 'Hand-offs' },
  { k: 'usd', word: 'Spend' },
  { k: 'minutes', word: 'Agent time' },
];
const NAME: Record<LimitName, string> = { builds: 'build', handoffs: 'hand-off', reviewRounds: 'review round', usd: 'spend', minutes: 'agent time' };
const MAX: Record<LimitName, number> = { builds: 50, handoffs: 20, reviewRounds: 10, usd: 1000, minutes: 1440 };
const show = (k: LimitName, v: number) => (k === 'usd' ? money({ usd: v }) : String(Math.round(v)));

/**
 * The task's limits in the title block (R-062): one row of meters, used of cap, and when autopilot stopped at a limit,
 * the stop with two ways on: raise the limit and carry on, or hand the task to another agent from its packet.
 */
export function Limits({ taskId, events, onHand }: { taskId: string; events: StintEvent[]; onHand: () => void }) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const last = events.findLast((e) => e.type.startsWith('autopilot.') || e.type === 'run.started');
    return last?.type === 'autopilot.stopped' && typeof last.payload.limit === 'string' ? { limit: last.payload.limit as LimitName, reason: String(last.payload.reason ?? '') } : null;
  }, [events]);
  if (!caps) return null;

  const reached = stop?.limit ?? null;
  const cap = reached ? caps[reached] : null;
  const isUsd = reached === 'usd';
  const floor = reached ? Math.max(used[reached], cap ?? 0) : 0;
  const min = isUsd ? Math.ceil(floor * 100 + 1) / 100 : Math.floor(floor) + 1;
  const suggest = reached ? Math.min(MAX[reached], Math.max(min, reached === 'minutes' ? (cap ?? 0) + 30 : isUsd ? Math.ceil(floor) + 1 : min)) : 0;
  const raise = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reached) return;
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
    <div data-testid="limits" className="min-[760px]:col-span-2 flex flex-col gap-3 min-w-0">
      {/* one meter per line on a phone; one row from 760 px */}
      <ul aria-label="Limits" className="grid grid-cols-1 gap-y-1.5 min-[760px]:flex min-[760px]:flex-wrap min-[760px]:items-center gap-x-3 text-small text-ink-2">
        {METERS.map(({ k, word }, i) => {
          const c = caps[k];
          const here = reached === k;
          return (
            <li key={k} data-testid={`meter-${k}`} className={cx('inline-flex items-center gap-2 whitespace-nowrap', here && 'text-amber')}>
              {i > 0 ? (
                <span aria-hidden="true" className="hidden min-[760px]:inline text-ink-3">
                  ·
                </span>
              ) : null}
              <span>
                {word}{' '}
                <span className={cx('tabular font-semibold', here ? 'text-amber' : 'text-ink')}>
                  {show(k, used[k])}
                  {c === null ? '' : ` of ${show(k, c)}`}
                  {k === 'minutes' ? ' min' : ''}
                </span>
                {k === 'usd' && used.unpriced ? `, ${used.unpriced} not priced` : ''}
                {here ? ', reached' : ''}
              </span>
              {c === null ? null : (
                <span aria-hidden="true" className="inline-block w-12 h-1 bg-rule">
                  <span className={cx('block h-full', here ? 'bg-amber' : 'bg-ink')} style={{ width: `${Math.min(100, (used[k] / c) * 100)}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {reached && stop ? (
        <section data-testid="limit-stop" aria-labelledby="limit-stop-title" className="flex flex-col gap-3 max-w-[80ch] p-3 rounded-[5px] border border-amber bg-amber-wash text-body text-ink">
          <p id="limit-stop-title">
            <b className="font-semibold text-amber">Needs you:</b> {stop.reason.replace(/^Needs you: /, '')} Autopilot stopped before it would go past it.
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
                  className="h-9 w-28 rounded-[5px] border border-field bg-ground px-2.5 text-body text-ink tabular"
                />
              </label>
              <Button tone="primary" type="submit" disabled={busy} data-testid="raise-limit">
                Raise the limit
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
