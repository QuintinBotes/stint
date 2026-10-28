import type { Metrics } from '@stint-dev/core';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ADAPTER_NAMES, type Agent, type Mark, ROLE_NAMES, TEAM_NAMES, agentOf, hostMark, hostName, markColor, modelName } from '../agents';
import { type BenchData, type BenchMode, type CostRow, type Gardening, type Health, type PhaseGates, type RiskState, type ScoreRow, type TaskBundle, api, daemonMessage } from '../api';
import { Queue, WorkspaceMemory } from '../components/MemoryPanel';
import { Measures, MetricsPanel, type WindowName, metricValue, sample } from '../components/MetricsPanel';
import { Relay } from '../components/Relay';
import { Button, EmptyState, Explain, StatusChip, Who, cx, rev } from '../components/ui';
import { money, tokens } from '../format';
import { useHealth, useTasks } from '../hooks';

const isMeta = (model: string) => /(^|\/)(muse-|llama)/i.test(model);

/** A host's spend takes its vendor's ink: local for this machine, Meta's models wherever they are served. */
const hostColour = (host: string) => markColor[hostMark(host)];

const SMALL = 'h-8 px-2.5 text-small';
const NOTE = 'text-small text-ink-2';
/** A note's paragraph, kept to a readable measure. */
const PROSE = 'text-small text-ink-2 max-w-[60ch]';
const NUM = cx(rev.td, 'text-right');
const NUM_HEAD = cx(rev.th, 'text-right');
/** A row's own header cell, on the body's ground: the design sets the row labels of a comparison in ink-2. */
const ROW_HEAD = 'px-2.5 py-1.5 border border-rule-strong align-top font-medium text-ink-2 bg-ground';
/** A wide table scrolls inside its panel on a narrow screen; the padding keeps the block's outer line inside the scroller. */
const SCROLLER = 'overflow-x-auto p-px';

/** A wide table's frame: on a narrow screen it scrolls sideways, and a keyboard can focus it to scroll. */
function Scroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={SCROLLER} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
/** One bar row, as the design sets the loops and the spend: label, track, figure. */
const BAR_ROW = 'grid grid-cols-[96px_minmax(0,1fr)_64px] sm:grid-cols-[150px_minmax(0,1fr)_64px] items-center gap-3 min-h-[30px] text-small';
const TRACK = 'flex h-3.5 overflow-hidden bg-panel-2';

/** A vendor's ink square and its name, for a legend. */
function Key({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: colour }} />
      {children}
    </span>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((x) => live && setV(x))
      .catch(() => live && setV(null));
    return () => {
      live = false;
    };
  }, deps);
  return v;
}

/** Which model did the work, where it ran, what it did and what it cost. Meta's models first. */
function ModelsAtWork({ rows }: { rows: CostRow[] }) {
  const models = rows
    .map((r) => {
      const [host, ...rest] = r.key.split('/');
      return { ...r, host: host ?? '', model: rest.join('/'), total: r.inputTokens + r.outputTokens };
    })
    .filter((r) => r.runs > 0)
    .sort((a, b) => Number(isMeta(b.model)) - Number(isMeta(a.model)) || b.total - a.total);
  const all = models.reduce((s, m) => s + m.total, 0);
  if (models.length === 0) return <EmptyState>The models that do the work appear here once a run ends.</EmptyState>;
  return (
    <div data-testid="models-at-work" className="flex flex-col gap-4">
      <div className={cx(TRACK, 'gap-px')} role="img" aria-label={`Share of tokens by model: ${models.map((m) => `${modelName(m.model)} ${Math.round((m.total / Math.max(1, all)) * 100)}%`).join(', ')}`}>
        {models.map((m) => (
          <span key={m.key} style={{ width: `${(m.total / Math.max(1, all)) * 100}%`, background: markColor[agentOf('openai-compatible', m.host, m.model).mark] }} title={`${modelName(m.model)}: ${tokens(m.total)} tokens`} />
        ))}
      </div>
      <Scroller label="Models at work">
        <table className={cx(rev.table, 'min-w-[640px]')}>
          <thead>
            <tr>
              {['Model', 'Ran on', 'Role'].map((h) => (
                <th key={h} scope="col" className={rev.th}>
                  {h}
                </th>
              ))}
              {['Tokens read', 'From cache', 'Tokens written', 'Runs', 'Cost'].map((h) => (
                <th key={h} scope="col" className={NUM_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {models.map((m) => (
              <tr key={m.key} data-testid="model-row">
                <td className={rev.td}>
                  <Who agent={{ ...agentOf('openai-compatible', m.host, m.model), name: modelName(m.model) }} className="font-semibold" />
                </td>
                <td className={cx(rev.td, 'text-ink-2')}>{hostName(m.host)}</td>
                <td className={cx(rev.td, 'text-ink-2')}>{(m.roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(', ') || 'runs'}</td>
                <td className={NUM}>{tokens(m.inputTokens)}</td>
                <td className={cx(NUM, 'text-ink-2')}>{m.inputTokens ? `${Math.round((m.cachedTokens / m.inputTokens) * 100)}%` : 'none'}</td>
                <td className={NUM}>{tokens(m.outputTokens)}</td>
                <td className={NUM}>{m.runs}</td>
                <td className={cx(NUM, 'font-semibold')}>{m.host === 'ollama' ? 'free, local' : money(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </div>
  );
}

const BENCH_COLUMNS: Array<{ name: string; value: (m: BenchMode) => number | null; show: (n: number) => string }> = [
  { name: 'Note to the next agent', value: (m) => m.meanPromptTokens, show: (n) => `${Math.round(n).toLocaleString('en-US')} tokens` },
  { name: 'Tokens read by the next run', value: (m) => m.meanInputTokens, show: (n) => Math.round(n).toLocaleString('en-US') },
  { name: 'Cost per run', value: (m) => m.meanUsd, show: (n) => `$${n.toFixed(4)}` },
];

/** The packet benchmark: each measure is its own column with its own scale, so no two scales share an axis. The transcript is called the full session log on screen. */
function Benchmark({ data }: { data: BenchData }) {
  const lines = [
    { label: 'the full session log', m: data.byMode.transcript, base: true },
    { label: 'the packet', m: data.byMode.packet, base: false },
    { label: 'the packet, with a summary of the change', m: data.digest?.byMode.packet, base: false },
  ].filter((l): l is { label: string; m: BenchMode; base: boolean } => l.m !== undefined);
  const tasks = new Set(data.rows.map((r) => r.task)).size;
  const colour = (base: boolean) => (base ? 'var(--rule-strong)' : 'var(--ink)');
  return (
    <div data-testid="bench" className="flex flex-col gap-3">
      <Scroller label="Packet against full log">
        <table className={cx(rev.table, 'table-fixed min-w-[640px]')}>
          <thead>
            <tr>
              <th scope="col" className={cx(rev.th, 'w-[28%]')}>
                Continue from
              </th>
              {BENCH_COLUMNS.map((c) => (
                <th key={c.name} scope="col" className={NUM_HEAD}>
                  {c.name}
                </th>
              ))}
              <th scope="col" className={cx(NUM_HEAD, 'w-[13%]')}>
                Tests passed
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lines.map((l) => (
              <tr key={l.label} data-testid="bench-row">
                <td className={cx(rev.td, 'font-semibold')}>
                  <Key colour={colour(l.base)}>{l.label}</Key>
                </td>
                {BENCH_COLUMNS.map((c) => {
                  const v = c.value(l.m);
                  const max = Math.max(...lines.map((x) => c.value(x.m) ?? 0));
                  return (
                    <td key={c.name} className={NUM}>
                      {v === null ? <span className="text-ink-2">not priced</span> : c.show(v)}
                      <div className="mt-1 h-1.5 bg-panel-2">
                        <div className="h-full" style={{ width: `${v === null || max === 0 ? 0 : (v / max) * 100}%`, background: colour(l.base) }} />
                      </div>
                    </td>
                  );
                })}
                <td className={cx(NUM, 'font-semibold')}>
                  {Math.round(l.m.passRate * l.m.runs)} of {l.m.runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
      <p className={PROSE}>
        {data.synthetic ? 'Synthetic rows, ' : data.replay ? 'Rebuilt from recorded runs, ' : `Measured live on ${new Date(data.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, `}
        {tasks} tasks from commit <span className="font-mono">{data.commit.slice(0, 7)}</span>: {ADAPTER_NAMES[data.implementer] ?? data.implementer} is stopped at the same step each time, then the Stint agent on {modelName(data.models[data.continuer] ?? null)} continues and Stint runs the tests. Averages per run, one run per task.
      </p>
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 flex flex-col gap-0.5 px-3.5 py-3 bg-ground">
      <dt className={NOTE}>{label}</dt>
      <dd className="m-0 text-section tabular">{value}</dd>
      {detail ? <dd className={cx(NOTE, 'm-0')}>{detail}</dd> : null}
    </div>
  );
}

const STAGES: Array<[string, string]> = [
  ['planned', 'Planned'],
  ['building', 'Building'],
  ['verifying', 'Verifying'],
  ['reviewing', 'Reviewing'],
  ['in_review', 'In review'],
  ['awaiting_approval', 'Needs you'],
  ['done', 'Done'],
];

/** The stage funnel: every task that reached a stage, so one ink for all; amber would read as needing you now. */
function Loops({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <ul className="flex flex-col" data-testid="loops">
      {STAGES.map(([k, name]) => (
        <li key={k} className={BAR_ROW}>
          <span className="min-w-0 truncate">{name}</span>
          <span className={TRACK}>
            <span className="block h-full bg-ink-2" style={{ width: `${((counts[k] ?? 0) / max) * 100}%` }} />
          </span>
          <span className="tabular text-right">
            {counts[k] ?? 0} task{counts[k] === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CostByDay({ rows }: { rows: CostRow[] }) {
  const days = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const [day, host] = r.key.split('|') as [string, string];
    const m = days.get(day) ?? new Map<string, number>();
    m.set(host, (m.get(host) ?? 0) + (r.usd ?? 0));
    days.set(day, m);
  }
  const list = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const max = Math.max(0.01, ...list.map(([, m]) => [...m.values()].reduce((s, v) => s + v, 0)));
  const hosts = [...new Set(rows.map((r) => r.key.split('|')[1] as string))];
  if (list.length === 0) return <EmptyState>Cost per day appears once a run ends.</EmptyState>;
  return (
    <div data-testid="cost-by-day" className="flex flex-col gap-3">
      <div className="flex items-end gap-3 h-32">
        {list.map(([day, m]) => {
          const total = [...m.values()].reduce((s, v) => s + v, 0);
          return (
            <div key={day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-small tabular text-ink-2">${total.toFixed(2)}</span>
              <div className="w-full max-w-10 flex flex-col-reverse gap-px overflow-hidden" style={{ height: `${(total / max) * 88}px` }}>
                {[...m.entries()].map(([h, v]) => (
                  <span key={h} style={{ height: `${(v / Math.max(total, 0.0001)) * 100}%`, background: hostColour(h) }} title={`${hostName(h)}: $${v.toFixed(2)}`} />
                ))}
              </div>
              <span className="text-small text-ink-2 tabular">{new Date(`${day}T00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            </div>
          );
        })}
      </div>
      <div className={cx(NOTE, 'flex flex-wrap gap-x-4 gap-y-1')} data-testid="cost-legend">
        {hosts.map((h) => (
          <Key key={h} colour={hostColour(h)}>
            {hostName(h)}
          </Key>
        ))}
      </div>
    </div>
  );
}

/** Credits left per host (R-054): the balance a person entered minus metered spend, so the figure carries ≈. */
function CreditsLeft({ rows }: { rows: CostRow[] }) {
  const left = rows.filter((r) => typeof r.creditsLeft === 'number');
  if (left.length === 0) return <EmptyState>Credits left appear here once a host balance is entered in the config.</EmptyState>;
  return (
    <div data-testid="credits-left" className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {left.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-2 py-2 border-b border-rule" data-testid="credits-row" data-host={r.key}>
            <span className="text-ink-2">{hostName(r.key)}</span>
            <span className="tabular font-semibold">≈ ${(r.creditsLeft as number).toFixed(2)} left</span>
          </li>
        ))}
      </ul>
      <p className={PROSE}>Derived from metered spend, not read from the provider.</p>
    </div>
  );
}

type Helped = { skill: string; appliedIn: string[]; approvedAfter: number };
type Pair = { skill: string; before: TaskBundle; after: TaskBundle };

/** A task's runs in words: how many, and how many were killed. */
const runsLine = (b: TaskBundle) => {
  const killed = b.runs.filter((r) => r.endedBy === 'killed').length;
  return `${b.runs.length}, ${killed === 0 ? 'none' : killed === 1 ? 'one' : killed} killed`;
};
/** Every agent that ran on a task, once each, in the order they first ran. */
const agentsOf = (b: TaskBundle): Agent[] => [...new Map(b.runs.map((r) => agentOf(r.adapter, r.host, r.model)).map((a) => [a.name, a])).values()];

/** The learn loop's proof: the task a skill was learned from, next to the first task it was applied to, as one revision block. */
function ItLearned({ helped, costByTask }: { helped: Helped[]; costByTask: Map<string, CostRow> }) {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const { data: cards } = useTasks();
  useEffect(() => {
    if (!cards) return;
    let live = true;
    (async () => {
      const out: Pair[] = [];
      for (const h of helped) {
        const after = h.appliedIn[0]?.split('/')[0];
        if (!after) continue;
        let before: string | null = null;
        for (const c of cards) {
          if (c.task.id === after) continue;
          const events = await api.events(c.task.id);
          if (events.some((e) => (e.type === 'skill.proposed' || e.type === 'skill.approved') && (e.payload.id === h.skill || e.payload.skill === h.skill))) before = c.task.id;
        }
        if (!before) continue;
        const [b, a] = await Promise.all([api.task(before), api.task(after)]);
        out.push({ skill: h.skill, before: b, after: a });
      }
      if (live) setPairs(out);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [helped, cards]);
  if (pairs.length === 0) return <EmptyState>When a skill learned from one task is applied to the next, the two appear here side by side.</EmptyState>;
  return (
    <div className="flex flex-col gap-5" data-testid="it-learned">
      {pairs.map((p) => {
        const sides = [p.before, p.after];
        const findings = (b: TaskBundle) => b.review?.findings.length ?? 0;
        const rows: Array<[string, (b: TaskBundle) => ReactNode]> = [
          [
            'Task',
            (b) => (
              <Link to={`/t/${b.task.id}`} className="underline decoration-rule-strong hover:decoration-ink">
                {b.task.title}
              </Link>
            ),
          ],
          ['Runs', runsLine],
          [
            'Agents',
            (b) => (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {agentsOf(b).map((a) => (
                  <Who key={a.name} agent={a} className="font-medium" />
                ))}
              </span>
            ),
          ],
          [
            'Review findings',
            (b) => (
              <span className="tabular font-semibold">
                {findings(b)}
                <span className="sr-only"> review finding{findings(b) === 1 ? '' : 's'}</span>
              </span>
            ),
          ],
          // a verdict is a recommendation, not a state, so it takes the outline chip
          ['Review', (b) => (b.review ? <StatusChip label={b.review.verdict.replace('_', ' ')} tone="recommend" /> : 'Not reviewed')],
          ['Cost', (b) => <span className="tabular">{money(costByTask.get(b.task.id) ?? null)}</span>],
        ];
        return (
          <div key={p.skill} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={NOTE}>Skill</span>
              <Link to={`/skills?skill=${p.skill}`} className="inline-flex items-center min-h-6 px-2 rounded-[3px] bg-violet-wash font-mono text-small text-violet no-underline hover:underline">
                {p.skill}
              </Link>
            </div>
            <Scroller label={`${p.skill}, before and after`}>
              <table className={cx(rev.table, 'table-fixed')}>
                <colgroup>
                  <col className="w-[112px] sm:w-[132px]" />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <td className={rev.th} />
                    <th scope="col" className={rev.th}>
                      <span className="font-mono">{p.before.task.id}</span>, before the skill
                    </th>
                    <th scope="col" className={rev.th}>
                      <span className="font-mono">{p.after.task.id}</span>, with the skill
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, cell]) => (
                    <tr key={label}>
                      <th scope="row" className={ROW_HEAD}>
                        {label}
                      </th>
                      {sides.map((b) => (
                        <td key={b.task.id} className={rev.td}>
                          {cell(b)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroller>
            <p className={PROSE}>The first task's review found the problem, you approved the skill, and the next task ran with it.</p>
          </div>
        );
      })}
    </div>
  );
}

type OutcomeRow = { adapter: string; merged: number; reverted: number; followup: number; ci: number; incident: number };

/** What happened after merge, per agent that built the task: merged, reverted, followed up. */
function Outcomes({ rows }: { rows: OutcomeRow[] | null }) {
  if (rows === null) return <EmptyState>Reading what happened after merge.</EmptyState>;
  if (rows.length === 0) return <EmptyState>What happened to each merged change appears here once one has merged.</EmptyState>;
  return (
    <div data-testid="outcomes" className="flex flex-col gap-3">
      <Scroller label="What happened after merge">
        <table className={cx(rev.table, 'min-w-[480px]')}>
          <thead>
            <tr>
              <th scope="col" className={rev.th}>
                Agent
              </th>
              {['Merged', 'Reverted', 'Followed up', 'Checks failed', 'Incidents'].map((h) => (
                <th key={h} scope="col" className={NUM_HEAD}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.adapter} data-testid="outcome-row" data-agent={r.adapter}>
                <td className={rev.td}>
                  <Who agent={agentOf(r.adapter)} className="font-semibold" />
                </td>
                <td className={cx(NUM, 'font-semibold')}>{r.merged}</td>
                <td className={cx(NUM, r.reverted > 0 && 'text-red font-semibold')}>{r.reverted}</td>
                <td className={NUM}>{r.followup}</td>
                <td className={NUM}>{r.ci}</td>
                <td className={NUM}>{r.incident}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
      <p className={PROSE}>A task built by two agents counts for both. A follow-up is another task on the same files within 7 days.</p>
    </div>
  );
}

/** Each agent and model by the attempts Stint tested, per tag, and how autopilot picks from them. */
function Scoreboard({ data }: { data: { rows: ScoreRow[]; routing: { mode: string; explore: number } } | null }) {
  const [tag, setTag] = useState('*');
  if (data === null) return <EmptyState>Reading how each agent has done.</EmptyState>;
  const tags = [...new Set(data.rows.map((r) => r.tag))].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)));
  const rows = data.rows.filter((r) => r.tag === tag);
  const pct = (v: number | null) => (v === null ? 'none yet' : `${Math.round(v * 100)}%`);
  return (
    <div data-testid="scoreboard" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tags.length > 1 ? (
          <div role="group" aria-label="Tasks tagged" className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <Button key={t} aria-pressed={t === tag} onClick={() => setTag(t)} className={SMALL}>
                {t === '*' ? 'All tasks' : t}
              </Button>
            ))}
          </div>
        ) : null}
        <span className={cx(NOTE, 'ml-auto')} data-testid="routing-mode">
          {data.routing.mode === 'learned' ? (
            `Autopilot picks the agent with the best record here, and tries another one ${Math.round(data.routing.explore * 100)}% of the time.`
          ) : (
            <>
              Autopilot tries agents in the order set in the config, <span className="font-mono">autopilot.implementers</span>.
            </>
          )}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState>Each agent's record appears here once Stint has tested one of its runs.</EmptyState>
      ) : (
        <Scroller label="Agents, scrolls sideways on a narrow screen">
          <table className={cx(rev.table, 'min-w-[640px]')}>
            <thead>
              <tr>
                <th scope="col" className={rev.th}>
                  Agent
                </th>
                <th scope="col" className={NUM_HEAD}>
                  Runs tested
                </th>
                <th scope="col" className={NUM_HEAD}>
                  Passed
                </th>
                <th scope="col" className={NUM_HEAD}>
                  Passed the last 3
                </th>
                <th scope="col" className={NUM_HEAD}>
                  Cost per merged task
                </th>
                <th scope="col" className={NUM_HEAD}>
                  Reverted
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={`${r.agent}/${r.model ?? ''}`} data-testid="score-row" data-agent={r.agent}>
                  <td className={rev.td}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <Who agent={agentOf(r.agent)} className="font-semibold" />
                      {r.model ? <span className="text-ink-2">{modelName(r.model)}</span> : null}
                    </span>
                  </td>
                  <td className={NUM}>{r.attempts}</td>
                  <td className={cx(NUM, 'font-semibold')}>{pct(r.passRate)}</td>
                  <td className={NUM}>{r.pass3 === null ? 'fewer than 3' : r.pass3 ? 'yes' : 'no'}</td>
                  <td className={NUM}>{r.costPerResolved === null ? (r.resolved ? 'not priced' : 'none merged') : `$${r.costPerResolved.toFixed(2)}`}</td>
                  <td className={cx(NUM, r.reverts > 0 && 'text-red font-semibold')}>{r.reverts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
    </div>
  );
}

const gatePct = (n: number) => `${Math.round(n * 100)}%`;

/** The phase gates: the sample task pass rates first, then whether each phase has opened and why, in the words the daemon gives. */
function PhaseGatePanel({ gates }: { gates: PhaseGates | null }) {
  if (!gates) return <EmptyState>The phase gates appear once Stint can read the sample task results.</EmptyState>;
  const rows: Array<[string, boolean, string]> = [
    ['Phase 2', gates.phase2.met, gates.phase2.detail],
    ['Phase 3', gates.phase3.met, gates.phase3.detail],
  ];
  return (
    <div data-testid="phase-gates" className="flex flex-col gap-3">
      {gates.golden ? (
        <p className="tabular font-semibold" data-testid="golden-line">
          {gates.golden.tasks} sample tasks, {gates.golden.k} tries each: {gatePct(gates.golden.passAt1)} of tries passed, {gatePct(gates.golden.passPowK)} of tasks passed every try
          {gates.golden.usd !== null ? `, $${gates.golden.usd.toFixed(2)} in all` : ''}.
        </p>
      ) : (
        <p className={PROSE}>
          No sample task results yet. Run <span className="font-mono">stint eval --golden --k 3</span>.
        </p>
      )}
      <ul className="flex flex-col">
        {rows.map(([name, met, detail]) => (
          <li key={name} className="flex items-start justify-between gap-3 border-t border-rule py-2.5">
            <div className="min-w-0">
              <p className="font-semibold">{name}</p>
              <p className={PROSE}>{detail}</p>
            </div>
            <StatusChip label={met ? 'open' : 'not yet'} tone={met ? 'active' : 'neutral'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AutoApprove({ state, onChanged }: { state: RiskState | null; onChanged: () => void }) {
  if (state === null) return <EmptyState>Reading what the policy would have done.</EmptyState>;
  const { lane } = state;
  return (
    <div data-testid="auto-approve" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={lane.enabled ? 'lane on' : 'lane off'} tone={lane.enabled ? 'active' : 'neutral'} />
        <span className="text-ink-2">
          {lane.enabled
            ? `The policy may approve ${lane.tiers.join(' and ')} risk changes itself once its choices have matched yours for ${lane.shadowDays} days.`
            : 'Every change waits for you. Below is what the policy would have chosen.'}
        </span>
        {lane.enabled ? (
          <Button className={cx(SMALL, 'ml-auto')} tone="danger" data-testid="lane-off" onClick={() => void api.laneOff().then(onChanged)}>
            Turn the lane off
          </Button>
        ) : null}
      </div>
      {state.records.length === 0 ? (
        <EmptyState>Each approve or reject you make is recorded beside what the policy would have done.</EmptyState>
      ) : (
        <Scroller label="Your decisions and the policy's">
          <table className={cx(rev.table, 'min-w-[520px]')}>
            <thead>
              <tr>
                <th scope="col" className={rev.th}>
                  Risk
                </th>
                {['Your decisions', 'Policy agreed', 'Policy disagreed', 'Would approve, then reverted', 'Days on record'].map((h) => (
                  <th key={h} scope="col" className={NUM_HEAD}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {state.records.map((r) => (
                <tr key={r.tier} data-testid="shadow-row" data-tier={r.tier}>
                  <td className={rev.td}>{r.tier}</td>
                  <td className={NUM}>{r.decisions}</td>
                  <td className={NUM}>{r.agreements}</td>
                  <td className={NUM}>{r.disagreements}</td>
                  <td className={NUM}>{r.revertsAfterWouldApprove}</td>
                  <td className={NUM}>{r.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
      <ul className={cx(NOTE, 'flex flex-col gap-1')}>
        {state.lanes.map((l) => (
          <li key={l.tier} data-testid="lane-tier" data-tier={l.tier}>
            {l.tier}: {l.open ? 'may be approved by policy' : 'waits for you'}, {l.why}.
          </li>
        ))}
      </ul>
    </div>
  );
}

function Upkeep({ data }: { data: Gardening | null }) {
  if (data === null) return <EmptyState>Reading the upkeep schedule.</EmptyState>;
  if (data.schedule === 'off') {
    return (
      <EmptyState testId="upkeep-off">
        Upkeep is off. Add <span className="font-mono">"gardening": {'{'} "schedule": "weekly" {'}'}</span> to the config, and each week Stint opens a task to tidy the docs and one to find dead code and drift, each waiting for your approval.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col" data-testid="upkeep">
      {data.templates.map((t) => (
        <li key={t.id} className="flex flex-wrap items-baseline gap-2 border-t border-rule py-2.5" data-testid="upkeep-row" data-template={t.id}>
          <span className="font-semibold min-w-0">{t.title}</span>
          <span className={cx(NOTE, 'ml-auto tabular')}>
            {t.openTask ? (
              <>
                open as{' '}
                <Link to={`/t/${t.openTask}`} className="font-mono underline underline-offset-2">
                  {t.openTask}
                </Link>
              </>
            ) : t.nextAt ? (
              `next ${new Date(t.nextAt).toLocaleString()}`
            ) : (
              'not scheduled'
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The close of the demo: every harness and host this workspace knows, on and off, all fed the same packet (R-049). */
function AnyHarness({ health }: { health: Health | null }) {
  if (!health) return null;
  const agents = health.adapters.filter((a) => a.id !== 'replay');
  const hosts = [...new Set((health.models ?? []).map((m) => m.host))];
  const row = 'grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[80px_minmax(0,1fr)] items-start gap-x-4 gap-y-2';
  return (
    <div data-testid="any-harness" className="flex flex-col gap-3">
      <div className={row}>
        <span className="text-ink-2 sm:leading-6">Agents</span>
        <div className="flex flex-wrap gap-2" data-testid="harness-chips">
          {agents.map((a) => {
            const ready = a.capability.level === 'supported';
            return <StatusChip key={a.id} label={`${ADAPTER_NAMES[a.id] ?? a.id}${a.harness && a.harness !== 'cli' && a.harness !== a.id ? `, ${a.harness}` : ''}${ready ? '' : ', off'}`} tone={ready ? 'active' : 'neutral'} />;
          })}
        </div>
      </div>
      <div className={row}>
        <span className="text-ink-2 sm:leading-6">Model hosts</span>
        <div className="flex flex-wrap gap-2" data-testid="host-chips">
          {hosts.map((h) => {
            const ready = (health.models ?? []).some((m) => m.host === h && m.ready);
            return <StatusChip key={h} label={`${hostName(h)}${ready ? '' : ', off'}`} tone={ready ? 'active' : 'neutral'} />;
          })}
        </div>
      </div>
      <p className={PROSE}>Each one starts from the same packet, so a task can move to any of them. Those marked off are set up but not ready on this machine.</p>
    </div>
  );
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0 text-ink-2 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none">
      <path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A section of the Factory: a heading over its figures, no box around it. A `collapsed` one is a disclosure that opens
 * on its heading, so the page leads with what the agents did and keeps the rest one click away.
 */
function Panel({ title, aside, children, className, testId, id: anchor, collapsed = false }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string; id?: string; collapsed?: boolean }) {
  const id = useId();
  if (collapsed)
    return (
      <details id={anchor} className={cx('group min-w-0 scroll-mt-4 border-t border-rule', className)} data-testid={testId}>
        <summary className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-12 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-panel">
          <Chevron />
          <h3 className="font-semibold">{title}</h3>
          {aside ? <span className={cx(NOTE, 'basis-full pl-5 sm:basis-auto sm:pl-0')}>{aside}</span> : null}
        </summary>
        <div className="flex flex-col gap-3 pt-1 pb-6">{children}</div>
      </details>
    );
  return (
    <section className={cx('flex flex-col gap-3 min-w-0', className)} data-testid={testId} aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-section">
          {title}
        </h2>
        {aside ? <span className="text-small text-ink-3">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** A heading over a few disclosures, so the page never shows more than about four at one level. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="flex flex-col gap-1 min-w-0" aria-labelledby={id}>
      <h2 id={id} className="text-section">
        {title}
      </h2>
      <div className="flex flex-col border-b border-rule">{children}</div>
    </section>
  );
}

type TaskSpend = { task: string; total: number; vendors: Array<[Mark, number]> };

/** Spend by task, split by the vendor of each run's agent; the rest of a task's total is planning and review calls. */
function SpendByTask({ rows }: { rows: TaskSpend[] | null }) {
  if (rows === null) return <EmptyState>Reading what each task cost.</EmptyState>;
  if (rows.length === 0) return <EmptyState>Spend by task appears once a run ends.</EmptyState>;
  const max = Math.max(0.0001, ...rows.map((r) => r.total));
  const other = (r: TaskSpend) => Math.max(0, r.total - r.vendors.reduce((s, [, usd]) => s + usd, 0));
  const vendors = new Map<Mark, number>();
  for (const r of rows) for (const [m, usd] of r.vendors) vendors.set(m, (vendors.get(m) ?? 0) + usd);
  const others = rows.reduce((s, r) => s + other(r), 0);
  return (
    <div data-testid="spend-by-task" className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.task} className={BAR_ROW}>
            <Link to={`/t/${r.task}`} className="font-mono no-underline hover:underline">
              {r.task}
            </Link>
            <span className={TRACK} role="img" aria-label={`${r.task}: ${[...r.vendors.map(([m, usd]) => `${TEAM_NAMES[m]} $${usd.toFixed(2)}`), ...(other(r) > 0.005 ? [`other calls $${other(r).toFixed(2)}`] : [])].join(', ') || 'no run cost'}`}>
              {r.vendors.map(([m, usd]) => (
                // a run that cost nothing still shows its vendor, as a sliver
                <span key={m} style={{ width: `${(Math.max(usd, max * 0.01) / max) * 100}%`, background: markColor[m] }} />
              ))}
              {other(r) > 0.005 ? <span style={{ width: `${(other(r) / max) * 100}%` }} className="bg-rule-strong" /> : null}
            </span>
            <span className="text-right tabular">${r.total.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className={cx(NOTE, 'flex flex-wrap gap-x-4 gap-y-1')}>
        {[...vendors.entries()].map(([m, usd]) => (
          <Key key={m} colour={markColor[m]}>
            {TEAM_NAMES[m]} ${usd.toFixed(2)}
          </Key>
        ))}
        {others > 0.005 ? <Key colour="var(--rule-strong)">Planning and review calls ${others.toFixed(2)}</Key> : null}
      </div>
    </div>
  );
}

export function Factory() {
  const { data: cards } = useTasks();
  const { data: health } = useHealth();
  const byModel = useLoad(() => api.costs('model'), []);
  const byDayHost = useLoad(() => api.costs('day-host'), []);
  const byHost = useLoad(() => api.costs('host'), []);
  const byTask = useLoad(() => api.costs('task'), []);
  const helped = useLoad(() => api.graphQuery<Helped>({ q: 'skills-helped' }), []);
  const scores = useLoad(() => api.scoreboard(), []);
  const [riskVersion, setRiskVersion] = useState(0);
  const risk = useLoad(() => api.risk(), [riskVersion]);
  const upkeep = useLoad(() => api.gardening(), []);
  const gates = useLoad(() => api.phaseGates(), []);
  const bench = useLoad(() => api.bench(), []);
  const [learned, setLearned] = useState(0);
  const [outcomeRows, setOutcomeRows] = useState<OutcomeRow[] | null>(null);
  // one response for the figures row and the panel, for the window the panel shows (R-061)
  const [span, setSpan] = useState<WindowName>('30d');
  const [metrics, setMetrics] = useState<{ data: Metrics | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    api
      .metrics(span)
      .then((data) => live && setMetrics({ data, error: null }))
      .catch((e: unknown) => live && setMetrics((m) => ({ data: m.data, error: daemonMessage(e) })));
    return () => {
      live = false;
    };
  }, [span]);
  const metric = (group: keyof Metrics['groups'], id: string) => metrics.data?.groups[group].find((m) => m.id === id) ?? null;
  const merges = metric('outcome', 'outcome.merged');
  const hops = metric('efficiency', 'efficiency.hops');
  const transcripts = metric('efficiency', 'efficiency.transcript_share');
  const packetTokens = metric('efficiency', 'efficiency.packet_tokens');
  const firstPass = metric('verification', 'verify.first_pass');
  const handoffs = metric('verification', 'verify.handoff_success');
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
  const [spendByTask, setSpendByTask] = useState<TaskSpend[] | null>(null);
  useEffect(() => {
    if (!cards) return;
    let live = true;
    Promise.all(cards.map((c) => api.events(c.task.id)))
      .then((all) => {
        if (!live) return;
        // The loops funnel: distinct tasks that entered each stage in the 7 days up to the last event (R-052).
        const latest = Math.max(0, ...all.flat().map((e) => Date.parse(e.ts)));
        const since = latest - 7 * 86_400_000;
        const entered = new Map<string, Set<string>>();
        const enter = (state: string, task: string) => (entered.get(state) ?? entered.set(state, new Set()).get(state))?.add(task);
        for (const [i, events] of all.entries()) {
          const task = cards[i]?.task.id ?? events[0]?.task ?? '';
          for (const e of events) {
            const t = Date.parse(e.ts);
            if (t < since || t > latest) continue;
            if (e.type === 'task.created') enter('planned', task);
            else if (e.type === 'task.status' && typeof e.payload.to === 'string') enter(e.payload.to, task);
          }
        }
        // what each task cost, by the vendor of the agent whose run spent it
        const spend = all.flatMap((events, i) => {
          const card = cards[i];
          if (!card) return [];
          const vendor = new Map<string, Mark>();
          const byVendor = new Map<Mark, number>();
          for (const e of events) {
            if (e.type === 'run.started' && e.run) vendor.set(e.run, agentOf(e.adapter, typeof e.payload.host === 'string' ? e.payload.host : null, typeof e.payload.model === 'string' ? e.payload.model : null).mark);
            const usd = e.type === 'run.finished' && e.run ? Number((e.payload.cost as { usd?: unknown } | undefined)?.usd) || 0 : 0;
            const mark = e.run ? vendor.get(e.run) : undefined;
            // a run that cost nothing still shows its vendor, as a sliver
            if (e.type === 'run.finished' && mark) byVendor.set(mark, (byVendor.get(mark) ?? 0) + usd);
          }
          const total = card.cost.usd ?? [...byVendor.values()].reduce((s, v) => s + v, 0);
          return total > 0 || byVendor.size ? [{ task: card.task.id, total, vendors: [...byVendor.entries()] }] : [];
        });
        setSpendByTask(spend.sort((a, b) => b.total - a.total));
        setFunnel(Object.fromEntries([...entered.entries()].map(([state, tasks]) => [state, tasks.size])));
        // learned means proposed by the learn step and approved by a person, not written by hand
        setLearned(new Set(all.flat().filter((e) => e.type === 'skill.approved').map((e) => String(e.payload.id ?? e.payload.skill))).size);
        const rows = new Map<string, OutcomeRow>();
        const rowFor = (adapter: string) => {
          let row = rows.get(adapter);
          if (!row) rows.set(adapter, (row = { adapter, merged: 0, reverted: 0, followup: 0, ci: 0, incident: 0 }));
          return row;
        };
        for (const events of all) {
          const builders = [...new Set(events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer' && e.adapter).map((e) => e.adapter as string))];
          const agents = builders.length ? builders : [...new Set(events.filter((e) => e.type === 'run.started' && e.adapter).map((e) => e.adapter as string))];
          if (agents.length === 0) continue;
          const count = (type: string) => events.filter((e) => e.type === type).length;
          if (count('merge.completed') === 0 && count('outcome.reverted') + count('outcome.followup') + count('outcome.ci') + count('outcome.incident') === 0) continue;
          for (const agent of agents) {
            const row = rowFor(agent);
            row.merged += count('merge.completed');
            row.reverted += count('outcome.reverted');
            row.followup += count('outcome.followup');
            row.ci += count('outcome.ci');
            row.incident += count('outcome.incident');
          }
        }
        setOutcomeRows([...rows.values()].sort((a, b) => b.merged - a.merged || a.adapter.localeCompare(b.adapter)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cards]);

  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || !cards) return;
    const target = document.getElementById(hash.slice(1));
    // a link to a section behind a disclosure opens it, as the replay's closing link does for #any-harness
    const shut = target?.closest('details');
    if (shut) shut.open = true;
    target?.scrollIntoView({ block: 'start' });
  }, [hash, cards, health]);

  const counts = funnel ?? {};
  const costByTask = useMemo(() => new Map((byTask ?? []).map((r) => [r.key, r])), [byTask]);
  const week = (byModel ?? []).reduce((s, r) => s + (r.usd ?? 0), 0);
  const input = (byModel ?? []).reduce((s, r) => s + r.inputTokens, 0);
  const cached = (byModel ?? []).reduce((s, r) => s + r.cachedTokens, 0);
  /** A share's figure and its "1 of 2 tasks" line, or what fills it in when there is nothing to count yet. */
  const share = (m: typeof firstPass, none: string): [string, string] => (m?.value != null ? [metricValue(m), `${Math.round(m.value * m.n)} of ${sample(m)}`] : ['none yet', none]);
  const [firstValue, firstDetail] = share(firstPass, "after a task's first tested run");
  const [handoffValue, handoffDetail] = share(handoffs, 'once a stopped run is handed on');

  const merged = (cards ?? []).filter((c) => c.task.status === 'done').length;
  // the lead says what the agents came to: a skill learned first, else merges, else that it has not started
  const lead = learned ? `It learned ${learned === 1 ? 'one skill' : `${learned} skills`}, approved by you.` : merged ? `It merged ${merged === 1 ? 'one task' : `${merged} tasks`}.` : 'It is ready for its first task.';
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="factory">
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-5 pb-8 md:pt-7 md:pb-10 flex flex-col gap-8">
        <header className="flex flex-col gap-1.5 max-w-[75ch]">
          <h1 className="text-title">Factory</h1>
          <p className="text-ink-2" data-testid="factory-headline">
            How the agents are doing, and what it costs. {lead}
          </p>
        </header>

        <MetricsPanel data={metrics.data} error={metrics.error} window={span} onWindow={setSpan}>
          <dl className="m-0 grid grid-cols-2 min-[900px]:grid-cols-4 gap-px overflow-hidden rounded-[5px] border border-rule-strong bg-rule" data-testid="kpis">
            <Figure label="Tasks merged" value={String(merges?.value ?? 0)} detail={hops?.value != null ? `${metricValue(hops)} build runs each` : 'none in this period yet'} />
            <Figure label="Spend this week" value={`$${week.toFixed(2)}`} detail={cards?.length ? `$${(week / cards.length).toFixed(2)} per task, at list prices` : undefined} />
            <Figure label="Passed the tests first time" value={firstValue} detail={firstDetail} />
            <Figure label="Hand-offs that passed" value={handoffValue} detail={handoffDetail} />
          </dl>
          <p className={NOTE} data-testid="kpi-transcript-share">
            Each hand-off passes on a packet{packetTokens?.value != null ? ` of about ${metricValue(packetTokens)}` : ''}, not the full session log. Full logs passed on: {transcripts?.value != null ? metricValue(transcripts) : '0%'}.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Explain word="verify" />
            <Explain word="handoff" />
          </div>
          {metrics.data ? (
            <Panel title="All measures" aside="Each one in plain words, with a link to its definition" collapsed testId="panel-measures">
              <Measures data={metrics.data} />
            </Panel>
          ) : null}
        </MetricsPanel>

        <Panel title="Agents" testId="panel-scoreboard">
          <Scoreboard data={scores} />
        </Panel>

        {/* shown only while something waits; a finding that would reverse a decision links here */}
        <Queue level={2} />

        <Group title="Runs and hand-offs">
          <Panel title="Runs by agent, over time" aside="Each run on its agent's line, and the packets passed between them" collapsed testId="panel-relay">
            <Explain word="packet" />
            <Relay />
          </Panel>
          <Panel title="Stages reached, last 7 days" aside="A task counts in every stage it reached, so these are not today's counts" collapsed testId="panel-loops">
            <Loops counts={counts} />
          </Panel>
          <Panel title="Packet against full log" aside="What the next agent reads, whether it passes, and what it costs" collapsed testId="panel-bench">
            {bench ? (
              <Benchmark data={bench} />
            ) : (
              <EmptyState testId="bench-empty">
                The packet against the full session log appears here once <span className="font-mono">stint bench</span> has run.
              </EmptyState>
            )}
          </Panel>
          <Panel title="One packet, any agent" collapsed testId="panel-any-harness" id="any-harness">
            <AnyHarness health={health as Health | null} />
          </Panel>
        </Group>

        <Group title="Spend">
          <Panel title="Spend by task" aside="Split by model maker, at list prices" collapsed testId="panel-spend">
            <SpendByTask rows={spendByTask} />
          </Panel>
          <Panel title="Meta models at work" collapsed testId="panel-models">
            <ModelsAtWork rows={byModel ?? []} />
            <p className={PROSE}>
              Read from cache overall: {input ? `${Math.round((cached / input) * 100)}%` : 'none'}, {tokens(cached)} of {tokens(input)} tokens.
            </p>
          </Panel>
          <Panel title="Cost per day" collapsed testId="panel-cost-day">
            <CostByDay rows={byDayHost ?? []} />
          </Panel>
          <Panel title="Credits left" collapsed testId="panel-credits">
            <CreditsLeft rows={byHost ?? []} />
          </Panel>
        </Group>

        <Group title="Learning and upkeep">
          <Panel title="What it learned" aside="A skill learned on one task, and the next task that used it" collapsed testId="panel-it-learned">
            <ItLearned helped={helped ?? []} costByTask={costByTask} />
          </Panel>
          <Panel title="Workspace memory" collapsed testId="panel-memory">
            <WorkspaceMemory />
          </Panel>
          <Panel title={`Upkeep${upkeep && upkeep.schedule !== 'off' ? `, ${upkeep.schedule}` : ''}`} collapsed testId="panel-upkeep">
            <Upkeep data={upkeep} />
          </Panel>
        </Group>

        <Group title="Results and approvals">
          <Panel title="What happened after merge" collapsed testId="panel-outcomes">
            <Outcomes rows={outcomeRows} />
          </Panel>
          <Panel title="Phase gates" collapsed testId="panel-phase-gates">
            <PhaseGatePanel gates={gates} />
          </Panel>
          <Panel title="Auto-approve" collapsed testId="panel-auto-approve">
            <AutoApprove state={risk} onChanged={() => setRiskVersion((v) => v + 1)} />
          </Panel>
        </Group>

        <footer className={cx(NOTE, 'flex flex-wrap justify-between gap-2')}>
          <span className="max-w-[60ch]">Every figure comes from the task logs in .stint/tasks/, priced at the list prices in config.json.</span>
          <span>Built on Meta's Muse models</span>
        </footer>
      </div>
    </main>
  );
}
