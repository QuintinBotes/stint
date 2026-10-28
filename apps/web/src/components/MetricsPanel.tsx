import type { MetricValue, Metrics } from '@stint-dev/core';
import { localDate } from '../format';
import { Button, EmptyState, cx } from './ui';

export const WINDOWS = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All'],
] as const;
export type WindowName = (typeof WINDOWS)[number][0];

/** The four groups the panel shows; efficiency feeds the figures row above it. */
const GROUPS: Array<[keyof Metrics['groups'], string]> = [
  ['verification', 'Verification'],
  ['outcome', 'Outcomes'],
  ['human', 'Human load'],
  ['learning', 'Learning'],
];

/** The definitions live in the repository's docs; the UI runs offline, so the link is to the published page. */
export const definitionUrl = (id: string) => `https://github.com/QuintinBotes/stint/blob/main/docs/metrics.md#${id}`;

/** A duration in the largest unit that keeps it readable. */
function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 172_800_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} days`;
}

/** A metric's value in its unit: ratios as percents, money in dollars, times as durations. */
export function metricValue(m: Pick<MetricValue, 'unit' | 'value'>): string {
  const v = m.value;
  if (v === null) return 'not enough data';
  if (m.unit === 'ratio') return `${Math.round(v * 100)}%`;
  if (m.unit === 'usd') return `$${v.toFixed(2)}`;
  if (m.unit === 'ms') return duration(v);
  if (m.unit === 'tokens') return `${Math.round(v).toLocaleString('en-US')} tokens`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function Label({ m }: { m: MetricValue }) {
  return (
    <a href={definitionUrl(m.id)} target="_blank" rel="noreferrer" title={m.definition} className="underline-offset-2 hover:underline" data-testid="metric-link">
      {m.label}
      <span className="sr-only">, opens its definition</span>
    </a>
  );
}

function Figure({ m }: { m: MetricValue }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 py-2 border-b border-rule" data-testid="metric" data-metric={m.id}>
      <dt className="text-[14px] min-w-0">
        <Label m={m} />
      </dt>
      <dd className="m-0 text-[12px] text-ink-2 tabular text-right">
        n {m.n}
        {m.p90 !== undefined && m.unit === 'ms' ? `, p90 ${duration(m.p90)}` : ''}
        {m.target ? (
          <span className={cx('ml-2 font-bold', m.target.met ? 'text-green' : 'text-yellow')} data-testid="metric-target">
            {m.target.met ? 'on target' : 'below target'}
          </span>
        ) : null}
      </dd>
      <dd className="m-0 min-w-16 text-[14px] font-bold tabular text-right">{metricValue(m)}</dd>
    </div>
  );
}

/**
 * R-061's panel: the four groups of `GET /api/metrics` for one window. Small samples are said once per group, and the
 * metrics with no value yet wait behind one disclosure, so the panel reads as figures, not as a wall of dashes.
 */
export function MetricsPanel({ data, error, window, onWindow }: { data: Metrics | null; error: string | null; window: WindowName; onWindow: (w: WindowName) => void }) {
  return (
    <section className="flex flex-col gap-3 min-w-0" data-testid="panel-metrics" aria-labelledby="metrics-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="metrics-title" className="text-[19px] leading-6 font-bold stretch-112 tracking-[-0.01em]">
          Verification and outcomes
        </h2>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Window">
          {WINDOWS.map(([id, name]) => (
            <Button key={id} className="h-7 px-2 text-[12px]" aria-pressed={window === id} onClick={() => onWindow(id)} data-testid={`metrics-window-${id}`}>
              {name}
            </Button>
          ))}
        </div>
      </div>
      {error ? <EmptyState testId="metrics-error">The metrics could not be read: {error}. Reload the page; if it stays, check the daemon log.</EmptyState> : null}
      {!data && !error ? <p className="text-[12px] text-ink-2">Reading the metrics.</p> : null}
      {data ? (
        <>
          <p className="text-[12px] text-ink-2" data-testid="metrics-window">
            {data.window.from ? `${localDate(data.window.from)} to ${localDate(data.window.to)}` : `Everything up to ${localDate(data.window.to)}`}, computed by the daemon from the event logs.
          </p>
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {GROUPS.map(([key, title]) => {
              const all = data.groups[key];
              const known = all.filter((m) => m.value !== null);
              const missing = all.filter((m) => m.value === null);
              return (
                <section key={key} className="min-w-0 flex flex-col gap-1" data-testid={`metrics-${key}`} aria-labelledby={`metrics-${key}-title`}>
                  <h3 id={`metrics-${key}-title`} className="text-[14px] font-bold">
                    {title}
                  </h3>
                  {known.some((m) => m.small) ? <p className="text-[12px] text-ink-2">Small sample: read these as a first look, not a trend.</p> : null}
                  <dl className="m-0 flex flex-col">
                    {known.map((m) => (
                      <Figure key={m.id} m={m} />
                    ))}
                  </dl>
                  {missing.length ? (
                    <details className="mt-1 text-[12px] text-ink-2">
                      <summary className="cursor-pointer hover:text-ink">Not enough data yet ({missing.length})</summary>
                      <ul className="mt-1 flex flex-col gap-1">
                        {missing.map((m) => (
                          <li key={m.id} data-testid="metric" data-metric={m.id}>
                            <Label m={m} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
