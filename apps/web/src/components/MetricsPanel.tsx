import type { MetricId, MetricValue, Metrics } from '@stint-dev/core';
import type { ReactNode } from 'react';
import { localDate } from '../format';
import { Button, EmptyState, cx } from './ui';

export const WINDOWS = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All'],
] as const;
export type WindowName = (typeof WINDOWS)[number][0];

/** Every group, by a plain name; the figures above the list read the same response. */
const GROUPS: Array<[keyof Metrics['groups'], string]> = [
  ['verification', 'Tests'],
  ['outcome', 'After merge'],
  ['human', 'Your time'],
  ['learning', 'Learning'],
  ['efficiency', 'Hand-offs and tokens'],
];

/** Each metric in plain words: its label, one sentence a newcomer can read, and what its sample counts. The id stays in the link. */
const PLAIN: Record<MetricId, { label: string; means: string; of: [string, string] }> = {
  'verify.first_pass': { label: 'Passed the tests first time', means: 'Tasks whose first run passed when Stint ran the tests.', of: ['task', 'tasks'] },
  'verify.attempt_pass': { label: 'Runs that passed the tests', means: 'Every tested run that passed, first try or not.', of: ['run', 'runs'] },
  'verify.handoff_success': { label: 'Hand-offs that passed', means: "Runs that started from another run's packet and then passed the tests.", of: ['hand-off', 'hand-offs'] },
  'verify.tamper_rate': { label: 'Runs that changed locked tests', means: 'Runs that edited the tests a task is judged by, with no decision allowing it.', of: ['run', 'runs'] },
  'verify.tamper_explained': { label: 'Locked test changes with a reason', means: 'Edits to locked tests that a recorded decision allowed.', of: ['test change', 'test changes'] },
  'verify.tamper_escapes': { label: 'Merged after changing locked tests', means: 'Tasks merged although a run edited locked tests with no reason. This should stay at 0.', of: ['merge', 'merges'] },
  'verify.scenario_catch': { label: 'Caught by held-back checks', means: 'Test runs where the visible tests passed but the checks kept from the agent failed.', of: ['test run', 'test runs'] },
  'verify.review_catch': { label: 'Caught by the review', means: 'Tasks whose tests passed but whose first review still asked for changes.', of: ['task', 'tasks'] },
  'verify.golden_pass1': { label: 'Sample task tries that passed', means: 'A fixed set of sample tasks, each tried several times: the share of tries that passed.', of: ['sample task', 'sample tasks'] },
  'verify.golden_passk': { label: 'Sample tasks that passed every try', means: 'From the same set: the share of tasks that passed on every one of their tries.', of: ['sample task', 'sample tasks'] },
  'outcome.merged': { label: 'Tasks merged', means: 'Changes merged into the main branch.', of: ['merge', 'merges'] },
  'outcome.escaped_defect': { label: 'Merges that caused a problem', means: 'Merges later reverted, followed by failed checks, or tied to an incident.', of: ['merge', 'merges'] },
  'outcome.revert': { label: 'Merges reverted', means: 'Merges that were later undone.', of: ['merge', 'merges'] },
  'outcome.ci_failure': { label: 'Merges that failed the checks', means: "Merges after which the project's automatic checks (CI) failed.", of: ['merge', 'merges'] },
  'outcome.incident': { label: 'Incidents', means: 'Problems in production traced back to a merge.', of: ['merge', 'merges'] },
  'outcome.followup': { label: 'Merges that needed a follow-up', means: 'Merges followed by another task on the same files. Not always a problem.', of: ['merge', 'merges'] },
  'outcome.lead_time': { label: 'Time from task to merge', means: 'Typical time from creating a task to merging it.', of: ['merge', 'merges'] },
  'outcome.cycle_time': { label: 'Working time to merge', means: 'Typical time from the first run starting to the merge.', of: ['merge', 'merges'] },
  'outcome.cost_per_merge': { label: 'Cost per merged task', means: 'What the runs on merged tasks cost, per merge.', of: ['merge', 'merges'] },
  'outcome.cost_per_good_merge': { label: 'Cost per good merge', means: 'All spend, wasted work included, divided by the merges that caused no problem.', of: ['good merge', 'good merges'] },
  'human.interventions': { label: 'Times you stepped in, per merge', means: 'How often a person stepped in on a task before approving it.', of: ['merge', 'merges'] },
  'human.autonomy': { label: 'Merged with no help from you', means: 'Merged tasks you only had to approve.', of: ['merge', 'merges'] },
  'human.first_time_approval': { label: 'Approved the first time', means: 'Merged tasks you never sent back for changes.', of: ['merge', 'merges'] },
  'human.approval_wait': { label: 'Time waiting for you', means: 'Typical time from a task asking for approval to your answer.', of: ['decision', 'decisions'] },
  'human.policy_agreement': { label: 'Auto-approve agreed with you', means: 'How often the auto-approve policy would have decided as you did.', of: ['decision', 'decisions'] },
  'learn.skills': { label: 'Skills on record', means: 'Skills Stint can give an agent now.', of: ['skill', 'skills'] },
  'learn.skill_net': { label: 'Skills that helped', means: 'Of skills used on 3 or more tasks, the share that helped more often than they hurt.', of: ['skill', 'skills'] },
  'learn.proposal_yield': { label: 'Proposed skills you kept', means: 'Proposed skills you approved, out of those you decided on.', of: ['proposal', 'proposals'] },
  'learn.eval_delta': { label: 'Gain in skill tests', means: 'Average gain when a skill is tested with and without it. Above 0 means it helped.', of: ['skill test', 'skill tests'] },
  'efficiency.hops': { label: 'Build runs per merged task', means: 'How many build runs a merged task took, retries and hand-offs included.', of: ['merge', 'merges'] },
  'efficiency.packet_tokens': { label: 'Packet size', means: 'Typical size of the note a run leaves for the next agent.', of: ['hand-off', 'hand-offs'] },
  'efficiency.cache_share': { label: 'Input read from cache', means: 'Share of what the models read that was reused from earlier calls, so it cost less.', of: ['run', 'runs'] },
  'efficiency.transcript_share': { label: 'Full logs passed on', means: "The next agent gets a packet, never the previous run's full session log, so this stays at 0%.", of: ['hand-off', 'hand-offs'] },
};

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
  if (v === null) return 'no data yet';
  if (m.unit === 'ratio') return `${Math.round(v * 100)}%`;
  if (m.unit === 'usd') return `$${v.toFixed(2)}`;
  if (m.unit === 'ms') return duration(v);
  if (m.unit === 'tokens') return `${Math.round(v).toLocaleString('en-US')} tokens`;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** What a metric's sample counts, in its own noun: "2 tasks", "1 hand-off". */
export const sample = (m: Pick<MetricValue, 'id' | 'n'>) => {
  const of = PLAIN[m.id as MetricId]?.of ?? ['case', 'cases'];
  return `${m.n} ${m.n === 1 ? of[0] : of[1]}`;
};

/** One measure: its plain label, linked to its definition, the sentence that says what it counts, and its value. */
function Measure({ m }: { m: MetricValue }) {
  const plain = PLAIN[m.id as MetricId];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-2 border-b border-rule" data-testid="metric" data-metric={m.id}>
      <dt className="min-w-0">
        <a href={definitionUrl(m.id)} target="_blank" rel="noreferrer" className="no-underline hover:underline" data-testid="metric-link">
          {plain?.label ?? m.label}
          <span className="sr-only">, opens its definition</span>
        </a>
      </dt>
      <dd className="m-0 row-span-2 flex flex-col items-end text-right tabular">
        <span className={m.value === null ? 'text-small text-ink-2' : 'font-semibold'}>{metricValue(m)}</span>
        {m.value === null ? null : (
          <span className="text-small text-ink-2">{sample(m)}</span>
        )}
        {m.value !== null && m.p90 !== undefined && m.unit === 'ms' ? <span className="text-small text-ink-2">9 in 10 within {duration(m.p90)}</span> : null}
        {m.target ? (
          // below target needs you, so amber; meeting one is not a verification, so it stays in ink
          <span className={cx('text-small font-semibold', m.target.met ? 'text-ink' : 'text-amber')} data-testid="metric-target">
            {m.target.met ? 'On target' : 'Below target'}
          </span>
        ) : null}
      </dd>
      {plain ? <dd className="m-0 text-small text-ink-2 max-w-[60ch]">{plain.means}</dd> : null}
    </div>
  );
}

/** Every measure for the window, by group, those with a value first. */
export function Measures({ data }: { data: Metrics }) {
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      {GROUPS.map(([key, title]) => (
        <section key={key} className="min-w-0 flex flex-col" data-testid={`metrics-${key}`} aria-labelledby={`metrics-${key}-title`}>
          <h4 id={`metrics-${key}-title`} className="font-semibold pb-1 border-b border-rule-strong">
            {title}
          </h4>
          <dl className="m-0 flex flex-col">
            {[...data.groups[key]]
              .sort((a, b) => Number(a.value === null) - Number(b.value === null))
              .map((m) => (
                <Measure key={m.id} m={m} />
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * R-061's panel: the window switch, the range it covers, and what the caller shows for that window (the figures row and
 * every measure). A small sample is said once, here, not beside each figure.
 */
export function MetricsPanel({ data, error, window, onWindow, children }: { data: Metrics | null; error: string | null; window: WindowName; onWindow: (w: WindowName) => void; children: ReactNode }) {
  const small = data !== null && Object.values(data.groups).some((g) => g.some((m) => m.value !== null && m.small));
  return (
    <section className="flex flex-col gap-3 min-w-0" data-testid="panel-metrics" aria-labelledby="metrics-title">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="metrics-title" className="text-section">
          What the agents did
        </h2>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
          {WINDOWS.map(([id, name]) => (
            <Button key={id} className="h-8 px-2.5 text-small" aria-pressed={window === id} onClick={() => onWindow(id)} data-testid={`metrics-window-${id}`}>
              {name}
            </Button>
          ))}
        </div>
      </div>
      {error ? <EmptyState testId="metrics-error">The figures could not be read: {error}. Reload the page; if it stays, check Stint's log.</EmptyState> : null}
      {!data && !error ? <p className="text-small text-ink-2">Reading the figures.</p> : null}
      {data ? (
        <p className="text-small text-ink-2" data-testid="metrics-window">
          {data.window.from ? `${localDate(data.window.from)} to ${localDate(data.window.to)}` : `Everything up to ${localDate(data.window.to)}`}.
          {small ? ' Few tasks so far, so read these as a first look.' : ''}
        </p>
      ) : null}
      {children}
    </section>
  );
}
