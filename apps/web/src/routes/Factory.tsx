import { type LearningCurve, type Metrics, type Scorecard, learningCurve, scorecardRows } from '@stint-dev/core';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ADAPTER_NAMES, type Agent, ROLE_NAMES, agentOf, hostName, markColor, modelName } from '../agents';
import { type BenchData, type BenchMode, type CostRow, DaemonError, type Gardening, type Health, type PhaseGates, type RiskState, type ScoreRow, type TaskBundle, api, daemonMessage } from '../api';
import { LearningChart } from '../components/LearningChart';
import { Queue, WorkspaceMemory } from '../components/MemoryPanel';
import { Measures, MetricsPanel, type WindowName, metricValue, sample } from '../components/MetricsPanel';
import { Relay } from '../components/Relay';
import { Button, EmptyState, Explain, StatusChip, Who, cx } from '../components/ui';
import { tokens } from '../format';
import { useHealth, useTasks } from '../hooks';

const isMeta = (model: string) => /(^|\/)(muse-|llama)/i.test(model);

const SMALL = 'h-8 px-2.5 text-small';
const NOTE = 'text-small text-ink-3';
/** A note's paragraph, kept to a readable measure. */
const PROSE = 'text-small text-ink-3 max-w-[65ch]';
const NUM = 'stint-table-number';

/** A wide table's frame: on a narrow screen it scrolls sideways inside it, and a keyboard can focus it to scroll. */
function Scroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stint-table-region" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
/** One bar row, as the design sets the loops: label, track, figure. */
const BAR_ROW = 'grid grid-cols-[96px_minmax(0,1fr)_64px] sm:grid-cols-[150px_minmax(0,1fr)_64px] items-center gap-3 min-h-[30px] text-small';
const TRACK = 'flex h-3.5 overflow-hidden bg-panel-2';

/** An ink square and its name, for a legend. */
function Key({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: colour }} />
      {children}
    </span>
  );
}

/** A read from the daemon: nothing yet, the data, or why it failed. A failed refresh keeps the data read before. */
type Loaded<T> = { data: T | null; error: string | null };

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [v, setV] = useState<Loaded<T>>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setV({ data, error: null }))
      .catch((e: unknown) => live && setV((now) => ({ data: now.data, error: daemonMessage(e) })));
    return () => {
      live = false;
    };
  }, deps);
  return v;
}

/** A panel's content once read; before that, that it is reading or why it could not, so a failed read never shows as an empty panel. */
function WhenRead<T>({ v, what, children }: { v: Loaded<T>; what: string; children: (data: T) => ReactNode }) {
  if (v.data === null)
    return v.error ? (
      <p role="alert" className="stint-field-error" data-testid="panel-error">
        {what.charAt(0).toUpperCase()}
        {what.slice(1)} could not be read: {v.error}.
      </p>
    ) : (
      <p className={NOTE}>Reading {what}.</p>
    );
  return (
    <>
      {v.error ? (
        <p role="alert" className="stint-field-error" data-testid="panel-stale">
          Showing {what} as last read. The refresh failed: {v.error}.
        </p>
      ) : null}
      {children(v.data)}
    </>
  );
}

/** Which model did the work, where it ran and what it did. Meta's models first. */
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
        <table className="stint-table min-w-[640px]">
          <thead>
            <tr>
              {['Model', 'Ran on', 'Role'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              {['Tokens read', 'From cache', 'Tokens written', 'Runs'].map((h) => (
                <th key={h} scope="col" className={NUM}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {models.map((m) => (
              <tr key={m.key} data-testid="model-row">
                <td className="text-ink">
                  <Who agent={{ ...agentOf('openai-compatible', m.host, m.model), name: modelName(m.model) }} className="font-semibold" />
                </td>
                <td>{hostName(m.host)}</td>
                <td>{(m.roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(', ') || 'runs'}</td>
                <td className={NUM}>{tokens(m.inputTokens)}</td>
                <td className={NUM}>{m.inputTokens ? `${Math.round((m.cachedTokens / m.inputTokens) * 100)}%` : 'none'}</td>
                <td className={NUM}>{tokens(m.outputTokens)}</td>
                <td className={NUM}>{m.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </div>
  );
}

const BENCH_COLUMNS: Array<{ name: string; value: (m: BenchMode) => number; show: (n: number) => string }> = [
  { name: 'Note to the next agent', value: (m) => m.meanPromptTokens, show: (n) => `${Math.round(n).toLocaleString('en-US')} tokens` },
  { name: 'Tokens read by the next run', value: (m) => m.meanInputTokens, show: (n) => Math.round(n).toLocaleString('en-US') },
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
        <table className="stint-table table-fixed min-w-[640px]">
          <thead>
            <tr>
              <th scope="col" className="w-[28%]">
                Continue from
              </th>
              {BENCH_COLUMNS.map((c) => (
                <th key={c.name} scope="col" className={NUM}>
                  {c.name}
                </th>
              ))}
              <th scope="col" className={cx(NUM, 'w-[13%]')}>
                Tests passed
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lines.map((l) => (
              <tr key={l.label} data-testid="bench-row">
                <td className="font-semibold text-ink">
                  <Key colour={colour(l.base)}>{l.label}</Key>
                </td>
                {BENCH_COLUMNS.map((c) => {
                  const v = c.value(l.m);
                  const max = Math.max(...lines.map((x) => c.value(x.m)));
                  return (
                    <td key={c.name} className={NUM}>
                      {c.show(v)}
                      <div className="mt-1 h-1.5 bg-panel-2">
                        <div className="h-full" style={{ width: `${max === 0 ? 0 : (v / max) * 100}%`, background: colour(l.base) }} />
                      </div>
                    </td>
                  );
                })}
                <td className={cx(NUM, 'font-semibold text-ink')}>
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

const SOURCES = { attempts: 'The scorecard attempts', relays: 'The relays' } as const;

/**
 * The scorecard (R-070): what the tests and the review caught on seeded tasks with hidden tests, each figure with the
 * runs it rests on, in the words of the table in docs/proofs.md; then who ran, and what it does and does not show.
 */
function ScorecardPanel({ card }: { card: Scorecard }) {
  const repos = new Set(card.tasks.map((t) => t.repo)).size;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return (
    <div data-testid="scorecard" className="flex flex-col gap-3">
      <Scroller label="Scorecard">
        <table className="stint-table min-w-[640px]">
          <thead>
            <tr>
              {['Figure', 'Result', 'Rests on'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {/* docs/proofs.md keeps the cost row; the screen shows money only against a spend limit */}
            {scorecardRows(card)
              .filter(([figure]) => figure !== 'Cost per green attempt')
              .map(([figure, result, restsOn]) => (
                <tr key={figure} data-testid="scorecard-row">
                  <td>{figure}</td>
                  <td className="font-semibold text-ink">{result}</td>
                  <td>{restsOn}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Scroller>
      <Scroller label="Who ran the scorecard">
        <table className="stint-table min-w-[640px]">
          <thead>
            <tr>
              {['Ran in', 'Model', 'Ran on', 'Through', 'Role'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              <th scope="col" className={NUM}>
                Runs
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {card.models.map((m) => (
              <tr key={`${m.source}/${m.role}/${m.adapter}/${m.host}/${m.model}`} data-testid="scorecard-model">
                <td>{SOURCES[m.source]}</td>
                <td className="font-semibold text-ink">{modelName(m.model)}</td>
                <td>{hostName(m.host)}</td>
                <td>{ADAPTER_NAMES[m.adapter] ?? m.adapter}</td>
                <td>{ROLE_NAMES[m.role] ?? m.role}</td>
                <td className={NUM}>{m.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
      <p className={PROSE} data-testid="scorecard-scope">
        {card.live ? 'Measured live' : 'A dry run on fake models, not live'} on {new Date(card.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}: {n(card.attempts.length, 'attempt', 'attempts')} on {n(card.tasks.length, 'seeded task', 'seeded tasks')} in {n(repos, 'repository', 'repositories')}, each from a fresh clone, graded by hidden tests the agent never saw. It shows what the tests and the review caught on these tasks; it does not show how an agent does on other work, and each figure rests only on the runs beside it.
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

type Helped = { skill: string; appliedIn: string[]; approvedAfter: number };
type Pair = { skill: string; before: TaskBundle; after: TaskBundle };

/** A task's runs in words: how many, and how many were killed. */
const runsLine = (b: TaskBundle) => {
  const killed = b.runs.filter((r) => r.endedBy === 'killed').length;
  return `${b.runs.length}, ${killed === 0 ? 'none' : killed === 1 ? 'one' : killed} killed`;
};
/** Every agent that ran on a task, once each, in the order they first ran. */
const agentsOf = (b: TaskBundle): Agent[] => [...new Map(b.runs.map((r) => agentOf(r.adapter, r.host, r.model)).map((a) => [a.name, a])).values()];

/** The learn loop's proof: the task a skill was learned from, next to the first task it was applied to, side by side. */
function ItLearned({ helped }: { helped: Helped[] }) {
  const [pairs, setPairs] = useState<Loaded<Pair[]>>({ data: null, error: null });
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
      return out;
    })()
      .then((data) => live && setPairs({ data, error: null }))
      .catch((e: unknown) => live && setPairs((now) => ({ data: now.data, error: daemonMessage(e) })));
    return () => {
      live = false;
    };
  }, [helped, cards]);
  return <WhenRead v={pairs} what="the skills learned and used">{(list) => <Pairs pairs={list} />}</WhenRead>;
}

function Pairs({ pairs }: { pairs: Pair[] }) {
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
        ];
        return (
          <div key={p.skill} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={NOTE}>Skill</span>
              <Link to={`/skills?skill=${p.skill}`} className="inline-flex items-center min-h-6 px-2 rounded-[3px] border border-violet bg-violet-wash font-mono text-small text-violet no-underline hover:underline">
                {p.skill}
              </Link>
            </div>
            <Scroller label={`${p.skill}, before and after`}>
              <table className="stint-table table-fixed">
                <colgroup>
                  <col className="w-[112px] sm:w-[132px]" />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Measure</span>
                    </th>
                    <th scope="col">
                      <span className="font-mono">{p.before.task.id}</span>, before the skill
                    </th>
                    <th scope="col">
                      <span className="font-mono">{p.after.task.id}</span>, with the skill
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, cell]) => (
                    <tr key={label}>
                      <th scope="row" className="text-ink-3">
                        {label}
                      </th>
                      {sides.map((b) => (
                        <td key={b.task.id} className="text-ink">
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
function Outcomes({ rows }: { rows: OutcomeRow[] }) {
  if (rows.length === 0) return <EmptyState>What happened to each merged change appears here once one has merged.</EmptyState>;
  return (
    <div data-testid="outcomes" className="flex flex-col gap-3">
      <Scroller label="What happened after merge">
        <table className="stint-table min-w-[480px]">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              {['Merged', 'Reverted', 'Followed up', 'Checks failed', 'Incidents'].map((h) => (
                <th key={h} scope="col" className={NUM}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.adapter} data-testid="outcome-row" data-agent={r.adapter}>
                <td className="text-ink">
                  <Who agent={agentOf(r.adapter)} className="font-semibold" />
                </td>
                <td className={cx(NUM, 'font-semibold text-ink')}>{r.merged}</td>
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
function Scoreboard({ data }: { data: { rows: ScoreRow[]; routing: { mode: string; explore: number } } }) {
  const [tag, setTag] = useState('*');
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
      {data.rows.length === 0 ? (
        <EmptyState testId="scoreboard-empty">Each agent's record appears here once Stint has tested one of its runs.</EmptyState>
      ) : rows.length === 0 ? (
        // the tag chips are a filter: nothing under one tag is not nothing at all
        <div className="flex flex-wrap items-center gap-x-4">
          <EmptyState testId="scoreboard-filtered-empty">No agent has a tested run on tasks tagged {tag}.</EmptyState>
          <Button className={SMALL} onClick={() => setTag('*')}>
            Show all tasks
          </Button>
        </div>
      ) : (
        <Scroller label="Agents, scrolls sideways on a narrow screen">
          <table className="stint-table min-w-[640px]">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                {['Runs tested', 'Passed', 'Passed the last 3', 'Reverted'].map((h) => (
                  <th key={h} scope="col" className={NUM}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => (
                <tr key={`${r.agent}/${r.model ?? ''}`} data-testid="score-row" data-agent={r.agent}>
                  <td className="text-ink">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <Who agent={agentOf(r.agent)} className="font-semibold" />
                      {r.model ? <span className="text-ink-2">{modelName(r.model)}</span> : null}
                    </span>
                  </td>
                  <td className={NUM}>{r.attempts}</td>
                  <td className={cx(NUM, 'font-semibold text-ink')}>{pct(r.passRate)}</td>
                  <td className={NUM}>{r.pass3 === null ? 'fewer than 3' : r.pass3 ? 'yes' : 'no'}</td>
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
function PhaseGatePanel({ gates }: { gates: PhaseGates }) {
  const rows: Array<[string, boolean, string]> = [
    ['Phase 2', gates.phase2.met, gates.phase2.detail],
    ['Phase 3', gates.phase3.met, gates.phase3.detail],
  ];
  return (
    <div data-testid="phase-gates" className="flex flex-col gap-3">
      {gates.golden ? (
        <p className="tabular font-semibold" data-testid="golden-line">
          {gates.golden.tasks} sample tasks, {gates.golden.k} tries each: {gatePct(gates.golden.passAt1)} of tries passed, {gatePct(gates.golden.passPowK)} of tasks passed every try.
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
            <StatusChip label={met ? 'open' : 'not yet'} tone={met ? 'active' : 'neutral'} shape={met ? 'running' : 'waiting'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AutoApprove({ state, onChanged }: { state: RiskState; onChanged: () => void }) {
  const { lane } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const off = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api
      .laneOff()
      .then(onChanged)
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div data-testid="auto-approve" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={lane.enabled ? 'lane on' : 'lane off'} tone={lane.enabled ? 'active' : 'neutral'} shape={lane.enabled ? 'running' : 'closed'} />
        <span className="text-ink-2">
          {lane.enabled
            ? `The policy may approve ${lane.tiers.join(' and ')} risk changes itself once its choices have matched yours for ${lane.shadowDays} days.`
            : 'Every change waits for you. Below is what the policy would have chosen.'}
        </span>
        {lane.enabled ? (
          <Button className={cx(SMALL, 'ml-auto')} tone="danger" aria-disabled={busy} aria-busy={busy || undefined} data-testid="lane-off" onClick={off}>
            {busy ? 'Turning it off' : 'Turn the lane off'}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="stint-field-error basis-full" data-testid="lane-off-error">
            The lane is still on: {error}
          </p>
        ) : null}
      </div>
      {state.records.length === 0 ? (
        <EmptyState>Each approve or reject you make is recorded beside what the policy would have done.</EmptyState>
      ) : (
        <Scroller label="Your decisions and the policy's">
          <table className="stint-table min-w-[520px]">
            <thead>
              <tr>
                <th scope="col">Risk</th>
                {['Your decisions', 'Policy agreed', 'Policy disagreed', 'Would approve, then reverted', 'Days on record'].map((h) => (
                  <th key={h} scope="col" className={NUM}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {state.records.map((r) => (
                <tr key={r.tier} data-testid="shadow-row" data-tier={r.tier}>
                  <td className="text-ink">{r.tier}</td>
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

function Upkeep({ data }: { data: Gardening }) {
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
function AnyHarness({ health }: { health: Health }) {
  const agents = health.adapters.filter((a) => a.id !== 'replay');
  const hosts = [...new Set((health.models ?? []).map((m) => m.host))];
  const row = 'grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[80px_minmax(0,1fr)] items-start gap-x-4 gap-y-2';
  return (
    <div data-testid="any-harness" className="flex flex-col gap-3">
      <div className={row}>
        <span className="text-ink-3 sm:leading-6">Agents</span>
        <div className="flex flex-wrap gap-2" data-testid="harness-chips">
          {agents.map((a) => {
            const ready = a.capability.level === 'supported';
            return <StatusChip key={a.id} label={`${ADAPTER_NAMES[a.id] ?? a.id}${a.harness && a.harness !== 'cli' && a.harness !== a.id ? `, ${a.harness}` : ''}${ready ? '' : ', off'}`} tone={ready ? 'active' : 'neutral'} shape={ready ? 'running' : 'closed'} />;
          })}
        </div>
      </div>
      <div className={row}>
        <span className="text-ink-3 sm:leading-6">Model hosts</span>
        <div className="flex flex-wrap gap-2" data-testid="host-chips">
          {hosts.map((h) => {
            const ready = (health.models ?? []).some((m) => m.host === h && m.ready);
            return <StatusChip key={h} label={`${hostName(h)}${ready ? '' : ', off'}`} tone={ready ? 'active' : 'neutral'} shape={ready ? 'running' : 'closed'} />;
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
        <summary className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-12 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-surface-hover">
          <Chevron />
          <h3 className="font-semibold">{title}</h3>
          {aside ? <span className={cx(NOTE, 'basis-full pl-5 sm:basis-auto sm:pl-0')}>{aside}</span> : null}
        </summary>
        <div className="flex flex-col gap-3 pt-1 pb-6">{children}</div>
      </details>
    );
  return (
    <section className={cx('stint-section', className)} data-testid={testId} aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="stint-section-title">
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
    <section className="stint-section gap-2" aria-labelledby={id}>
      <h2 id={id} className="stint-section-title">
        {title}
      </h2>
      <div className="flex flex-col border-b border-rule">{children}</div>
    </section>
  );
}

/** What the Factory works out from every task's log and the workspace log: the stage funnel, skills learned, findings over time, and what happened after merge. */
type FromLogs = { funnel: Record<string, number>; learned: number; merged: number; outcomes: OutcomeRow[]; learning: LearningCurve };

export function Factory() {
  const { data: cards, error: cardsError } = useTasks();
  const { data: health, error: healthError } = useHealth();
  const byModel = useLoad(() => api.costs('model'), []);
  const helped = useLoad(() => api.graphQuery<Helped>({ q: 'skills-helped' }), []);
  const scores = useLoad(() => api.scoreboard(), []);
  const [riskVersion, setRiskVersion] = useState(0);
  const risk = useLoad(() => api.risk(), [riskVersion]);
  const upkeep = useLoad(() => api.gardening(), []);
  const gates = useLoad(() => api.phaseGates(), []);
  // no results yet is the panel's empty state, not a failure
  const bench = useLoad(() => api.bench().catch((e: unknown) => (e instanceof DaemonError && e.status === 404 ? false : Promise.reject(e))), []);
  const scorecard = useLoad(() => api.scorecard().catch((e: unknown) => (e instanceof DaemonError && e.status === 404 ? false : Promise.reject(e))), []);
  const [logs, setLogs] = useState<Loaded<FromLogs>>({ data: null, error: null });
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
  useEffect(() => {
    if (!cards) return;
    let live = true;
    Promise.all([Promise.all(cards.map((c) => api.events(c.task.id))), api.workspaceEvents()])
      .then(([all, workspace]) => {
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
        setLogs({
          data: {
            funnel: Object.fromEntries([...entered.entries()].map(([state, tasks]) => [state, tasks.size])),
            // learned means proposed by the learn step and approved by a person, not written by hand
            learned: new Set(all.flat().filter((e) => e.type === 'skill.approved').map((e) => String(e.payload.id ?? e.payload.skill))).size,
            // merged as the Tasks merged figure counts it: a task whose log has its merge, over all time
            merged: all.filter((events) => events.some((e) => e.type === 'merge.completed')).length,
            outcomes: [...rows.values()].sort((a, b) => b.merged - a.merged || a.adapter.localeCompare(b.adapter)),
            learning: learningCurve([...all.flat(), ...workspace]),
          },
          error: null,
        });
      })
      .catch((e: unknown) => live && setLogs((now) => ({ data: now.data, error: daemonMessage(e) })));
    return () => {
      live = false;
    };
  }, [cards]);
  // the task list failing first means the logs were never asked for
  const fromLogs: Loaded<FromLogs> = { data: logs.data, error: logs.error ?? (cards ? null : cardsError) };

  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || !cards) return;
    const target = document.getElementById(hash.slice(1));
    // a link to a section behind a disclosure opens it, as the replay's closing link does for #any-harness
    const shut = target?.closest('details');
    if (shut) shut.open = true;
    target?.scrollIntoView({ block: 'start' });
  }, [hash, cards, health]);

  /** A share's figure and its "1 of 2 tasks" line, or what fills it in when there is nothing to count yet. */
  const share = (m: typeof firstPass, none: string): [string, string] => (m?.value != null ? [metricValue(m), `${Math.round(m.value * m.n)} of ${sample(m)}`] : ['none yet', none]);
  const [firstValue, firstDetail] = share(firstPass, "after a task's first tested run");
  const [handoffValue, handoffDetail] = share(handoffs, 'once a stopped run is handed on');

  // the lead says what the agents came to over all time (the figures below count the chosen period): a skill learned first, else merges, else that it has not started
  const merged = logs.data?.merged ?? 0;
  const learned = logs.data?.learned ?? 0;
  const lead = logs.data === null ? '' : learned ? `It has learned ${learned === 1 ? 'one skill' : `${learned} skills`} so far, approved by you.` : merged ? `It has merged ${merged === 1 ? 'one task' : `${merged} tasks`} so far.` : 'It is ready for its first task.';
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="factory">
      <div className="stint-page">
        <header className="stint-page-header">
          <div className="stint-page-heading">
            <h1 className="stint-page-title">Factory</h1>
            <p className="stint-page-summary" data-testid="factory-headline">
              How the agents are doing. {lead}
            </p>
          </div>
        </header>

        <MetricsPanel data={metrics.data} error={metrics.error} window={span} onWindow={setSpan}>
          {metrics.data ? (
            <>
              <dl className="m-0 grid grid-cols-1 min-[560px]:grid-cols-3 gap-px overflow-hidden rounded-[5px] border border-rule bg-rule" data-testid="kpis">
                <Figure label="Tasks merged" value={String(merges?.value ?? 0)} detail={hops?.value != null ? `${metricValue(hops)} build ${hops.value === 1 ? 'run' : 'runs'} each` : 'none in this period yet'} />
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
              <Panel title="All measures" aside="Each one in plain words, with a link to its definition" collapsed testId="panel-measures">
                <Measures data={metrics.data} />
              </Panel>
            </>
          ) : null}
        </MetricsPanel>

        <Panel title="Agents" testId="panel-scoreboard">
          <WhenRead v={scores} what="each agent's record">
            {(d) => <Scoreboard data={d} />}
          </WhenRead>
        </Panel>

        {/* shown only while something waits; a finding that would reverse a decision links here */}
        <div className="stint-section empty:hidden">
          <Queue level={2} />
        </div>

        <Group title="Runs and hand-offs">
          <Panel title="Runs by agent, over time" aside="Each run on its agent's line, and the packets passed between them" collapsed testId="panel-relay">
            <Explain word="packet" />
            <Relay />
          </Panel>
          <Panel title="Stages reached, last 7 days" aside="A task counts in every stage it reached, so these are not today's counts" collapsed testId="panel-loops">
            <WhenRead v={fromLogs} what="the stages">
              {(d) => <Loops counts={d.funnel} />}
            </WhenRead>
          </Panel>
          <Panel title="Packet against full log" aside="What the next agent reads, and whether it passes" collapsed testId="panel-bench">
            <WhenRead v={bench} what="the benchmark">
              {(d) =>
                d ? (
                  <Benchmark data={d} />
                ) : (
                  <EmptyState testId="bench-empty">
                    The packet against the full session log appears here once <span className="font-mono">stint bench</span> has run.
                  </EmptyState>
                )
              }
            </WhenRead>
          </Panel>
          <Panel title="One packet, any agent" collapsed testId="panel-any-harness" id="any-harness">
            <WhenRead v={{ data: health, error: healthError }} what="the agents and hosts">
              {(h) => <AnyHarness health={h} />}
            </WhenRead>
          </Panel>
        </Group>

        <Group title="Models">
          <Panel title="Meta models at work" collapsed testId="panel-models">
            <WhenRead v={byModel} what="the models at work">
              {(rows) => {
                const input = rows.reduce((s, r) => s + r.inputTokens, 0);
                const cached = rows.reduce((s, r) => s + r.cachedTokens, 0);
                return (
                  <>
                    <ModelsAtWork rows={rows} />
                    <p className={PROSE}>
                      Read from cache overall: {input ? `${Math.round((cached / input) * 100)}%` : 'none'}, {tokens(cached)} of {tokens(input)} tokens.
                    </p>
                  </>
                );
              }}
            </WhenRead>
          </Panel>
        </Group>

        <Group title="Learning and upkeep">
          <Panel title="What it learned" aside="A skill learned on one task, and the next task that used it" collapsed testId="panel-it-learned">
            <WhenRead v={helped} what="the skills that helped">
              {(h) => <ItLearned helped={h} />}
            </WhenRead>
          </Panel>
          <Panel title="Review findings per task" aside="Each task's last review, in the order reviewed, and where each skill was approved" collapsed testId="panel-learning">
            <WhenRead v={fromLogs} what="the review findings">
              {(d) => <LearningChart curve={d.learning} />}
            </WhenRead>
          </Panel>
          <Panel title="Workspace memory" collapsed testId="panel-memory">
            <WorkspaceMemory />
          </Panel>
          <Panel title={`Upkeep${upkeep.data && upkeep.data.schedule !== 'off' ? `, ${upkeep.data.schedule}` : ''}`} collapsed testId="panel-upkeep">
            <WhenRead v={upkeep} what="the upkeep schedule">
              {(d) => <Upkeep data={d} />}
            </WhenRead>
          </Panel>
        </Group>

        <Group title="Results and approvals">
          <Panel title="Scorecard on seeded tasks" aside="What the tests and the review caught, graded by hidden tests, with the runs each figure rests on" collapsed testId="panel-scorecard">
            <WhenRead v={scorecard} what="the scorecard">
              {(d) =>
                d ? (
                  <ScorecardPanel card={d} />
                ) : (
                  <EmptyState testId="scorecard-empty">The scorecard appears here once one has been run on this repository, with the hidden tests that grade it.</EmptyState>
                )
              }
            </WhenRead>
          </Panel>
          <Panel title="What happened after merge" collapsed testId="panel-outcomes">
            <WhenRead v={fromLogs} what="what happened after merge">
              {(d) => <Outcomes rows={d.outcomes} />}
            </WhenRead>
          </Panel>
          <Panel title="Phase gates" collapsed testId="panel-phase-gates">
            <WhenRead v={gates} what="the phase gates">
              {(d) => <PhaseGatePanel gates={d} />}
            </WhenRead>
          </Panel>
          <Panel title="Auto-approve" collapsed testId="panel-auto-approve">
            <WhenRead v={risk} what="what the policy would have done">
              {(d) => <AutoApprove state={d} onChanged={() => setRiskVersion((v) => v + 1)} />}
            </WhenRead>
          </Panel>
        </Group>

        <footer className={cx(NOTE, 'flex flex-wrap justify-between gap-2 mt-10')}>
          <span className="max-w-[60ch]">Every figure comes from the task logs in .stint/tasks/.</span>
          <span>Built on Meta's Muse models</span>
        </footer>
      </div>
    </main>
  );
}
