import type { Metrics } from '@stint-dev/core';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ADAPTER_NAMES, type Mark, ROLE_NAMES, TEAM_NAMES, agentOf, carNumber, hostMark, hostName, markColor, modelName } from '../agents';
import { type BenchData, type BenchMode, type CostRow, type Gardening, type Health, type PhaseGates, type RiskState, type ScoreRow, api, daemonMessage } from '../api';
import { Queue, WorkspaceMemory } from '../components/MemoryPanel';
import { MetricsPanel, type WindowName, metricValue } from '../components/MetricsPanel';
import { Relay } from '../components/Relay';
import { Button, EmptyState, Plate, StatusChip, Swatch, VendorMark, cx } from '../components/ui';
import { money, tokens } from '../format';
import { useHealth, useTasks } from '../hooks';

const isMeta = (model: string) => /(^|\/)(muse-|llama)/i.test(model);

/** A host's spend takes its team's livery: the local team on this machine, Meta's models wherever they are served. */
const hostColour = (host: string) => markColor[hostMark(host)];

const TH = 'font-semibold pb-2 pt-1 border-b border-rule';
const TD = 'py-3 border-b border-rule';

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
    <div data-testid="models-at-work">
      <div className="flex h-4 gap-px overflow-hidden mb-4" role="img" aria-label={`Share of tokens by model: ${models.map((m) => `${modelName(m.model)} ${Math.round((m.total / Math.max(1, all)) * 100)}%`).join(', ')}`}>
        {models.map((m) => (
          <span
            key={m.key}
            style={{ width: `${(m.total / Math.max(1, all)) * 100}%`, background: markColor[agentOf('openai-compatible', m.host, m.model).mark] }}
            title={`${modelName(m.model)}: ${tokens(m.total)} tokens`}
          />
        ))}
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-[14px] min-w-[560px]">
        <thead className="text-[12px] text-ink-2 text-left">
          <tr>
            <th className={TH}>Model</th>
            <th className={TH}>Ran on</th>
            <th className={TH}>Did</th>
            <th className={cx(TH, 'text-right')}>Tokens in</th>
            <th className={cx(TH, 'text-right')}>From cache</th>
            <th className={cx(TH, 'text-right')}>Out</th>
            <th className={cx(TH, 'text-right')}>Runs</th>
            <th className={cx(TH, 'text-right')}>Cost</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {models.map((m) => (
            <tr key={m.key} data-testid="model-row">
              <td className={cx(TD, 'font-bold')}>
                <VendorMark agent={agentOf('openai-compatible', m.host, m.model)} showName={false} size={15} /> <span className="ml-1">{modelName(m.model)}</span>
              </td>
              <td className={cx(TD, 'text-ink-2')}>{hostName(m.host)}</td>
              <td className={cx(TD, 'text-ink-2')}>{(m.roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(', ') || 'runs'}</td>
              <td className={cx(TD, 'text-right')}>{tokens(m.inputTokens)}</td>
              <td className={cx(TD, 'text-right text-ink-2')}>{m.inputTokens ? `${Math.round((m.cachedTokens / m.inputTokens) * 100)}%` : 'none'}</td>
              <td className={cx(TD, 'text-right')}>{tokens(m.outputTokens)}</td>
              <td className={cx(TD, 'text-right')}>{m.runs}</td>
              <td className={cx(TD, 'text-right font-bold')}>{m.host === 'ollama' ? 'free, local' : money(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const BENCH_COLUMNS: Array<{ name: string; value: (m: BenchMode) => number | null; show: (n: number) => string }> = [
  { name: 'Hand-over prompt', value: (m) => m.meanPromptTokens, show: (n) => `${Math.round(n).toLocaleString('en-US')} tokens` },
  { name: 'Input, whole continued run', value: (m) => m.meanInputTokens, show: (n) => Math.round(n).toLocaleString('en-US') },
  { name: 'Cost per run', value: (m) => m.meanUsd, show: (n) => `$${n.toFixed(4)}` },
];

/** The packet benchmark: each measure is its own column with its own scale, so no two scales share an axis. */
function Benchmark({ data }: { data: BenchData }) {
  const lines = [
    { label: 'the transcript', m: data.byMode.transcript, base: true },
    { label: 'the packet', m: data.byMode.packet, base: false },
    { label: 'the packet, again with the digest on', m: data.digest?.byMode.packet, base: false },
  ].filter((l): l is { label: string; m: BenchMode; base: boolean } => l.m !== undefined);
  const tasks = new Set(data.rows.map((r) => r.task)).size;
  const colour = (base: boolean) => (base ? 'var(--rule-strong)' : 'var(--ink)');
  return (
    <div data-testid="bench">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[14px] min-w-[640px]">
          <thead className="text-[12px] text-ink-2 text-left">
            <tr>
              <th className={cx(TH, 'w-[26%]')}>Continue from</th>
              {BENCH_COLUMNS.map((c) => (
                <th key={c.name} className={cx(TH, 'pl-4 text-right')}>
                  {c.name}
                </th>
              ))}
              <th className={cx(TH, 'pl-4 text-right w-[12%]')}>Tests green</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lines.map((l) => (
              <tr key={l.label} data-testid="bench-row">
                <td className={cx(TD, 'font-bold')}>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: colour(l.base) }} />
                    {l.label}
                  </span>
                </td>
                {BENCH_COLUMNS.map((c) => {
                  const v = c.value(l.m);
                  const max = Math.max(...lines.map((x) => c.value(x.m) ?? 0));
                  return (
                    <td key={c.name} className={cx(TD, 'pl-4 text-right')}>
                      {v === null ? <span className="text-ink-2">unpriced</span> : c.show(v)}
                      <div className="mt-1 h-1.5 bg-panel-2">
                        <div className="h-full" style={{ width: `${v === null || max === 0 ? 0 : (v / max) * 100}%`, background: colour(l.base) }} />
                      </div>
                    </td>
                  );
                })}
                <td className={cx(TD, 'pl-4 text-right font-bold')}>
                  {Math.round(l.m.passRate * l.m.runs)} of {l.m.runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-ink-3 max-w-[90ch]">
        {data.synthetic ? 'Synthetic rows, ' : data.replay ? 'Rebuilt from recorded runs, ' : `Live on ${new Date(data.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, `}
        {tasks} tasks from commit <span className="font-mono">{data.commit.slice(0, 7)}</span>: {ADAPTER_NAMES[data.implementer] ?? data.implementer} is stopped at the same step each time, then the Stint agent on {modelName(data.models[data.continuer] ?? null)} continues and the daemon runs the tests. Means per run. One run per task, so read it as a first measurement.
      </p>
    </div>
  );
}

function Figure({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return (
    <div className="min-w-0 flex flex-col gap-1" data-testid={testId}>
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className="m-0 text-[28px] leading-8 font-extrabold stretch-75 tabular">{value}</dd>
      {detail ? <dd className="m-0 text-[12px] text-ink-2">{detail}</dd> : null}
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

function Loops({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <ul className="flex flex-col gap-2" data-testid="loops">
      {STAGES.map(([k, name]) => (
        <li key={k} className="grid grid-cols-[96px_1fr_28px] items-center gap-3 py-1 border-b border-rule text-[14px]">
          <span className="inline-flex items-center gap-2 text-ink-2">
            {k === 'awaiting_approval' ? <Swatch tone="warn" /> : k === 'done' ? <Swatch tone="merged" /> : null}
            {name}
          </span>
          <span className="h-3 bg-panel overflow-hidden">
            <span className={cx('block h-full', k === 'awaiting_approval' ? 'bg-[var(--sw-yellow)]' : k === 'done' ? 'chequer-sm' : 'bg-ink-2')} style={{ width: `${((counts[k] ?? 0) / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-bold">{counts[k] ?? 0}</span>
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
    <div data-testid="cost-by-day">
      <div className="flex items-end gap-3 h-32">
        {list.map(([day, m]) => {
          const total = [...m.values()].reduce((s, v) => s + v, 0);
          return (
            <div key={day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <span className="text-[12px] tabular text-ink-2">${total.toFixed(2)}</span>
              <div className="w-full max-w-10 flex flex-col-reverse gap-px overflow-hidden" style={{ height: `${(total / max) * 96}px` }}>
                {[...m.entries()].map(([h, v]) => (
                  <span key={h} style={{ height: `${(v / Math.max(total, 0.0001)) * 100}%`, background: hostColour(h) }} title={`${hostName(h)}: $${v.toFixed(2)}`} />
                ))}
              </div>
              <span className="text-[12px] text-ink-3 tabular">{day.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[12px] text-ink-2" data-testid="cost-legend">
        {hosts.map((h) => (
          <span key={h} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: hostColour(h) }} />
            {hostName(h)}
          </span>
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
    <div data-testid="credits-left">
      <ul className="flex flex-col gap-2 text-[14px]">
        {left.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-2 py-2 border-b border-rule" data-testid="credits-row" data-host={r.key}>
            <span className="text-ink-2">{hostName(r.key)}</span>
            <span className="tabular font-bold">≈ ${(r.creditsLeft as number).toFixed(2)} left</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-ink-3 mt-3">Derived from metered spend, not read from the provider.</p>
    </div>
  );
}

type Helped = { skill: string; appliedIn: string[]; approvedAfter: number };

/** The learn loop's proof: the task a skill was learned from, next to the first task it was applied to. */
function ItLearned({ helped, costByTask }: { helped: Helped[]; costByTask: Map<string, CostRow> }) {
  const [pairs, setPairs] = useState<Array<{ skill: string; before: string; after: string; beforeFindings: number; afterFindings: number }>>([]);
  const { data: cards } = useTasks();
  useEffect(() => {
    if (!cards) return;
    let live = true;
    (async () => {
      const out = [];
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
        out.push({ skill: h.skill, before, after, beforeFindings: b.review?.findings.length ?? 0, afterFindings: a.review?.findings.length ?? 0 });
      }
      if (live) setPairs(out);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [helped, cards]);
  const title = (id: string) => cards?.find((c) => c.task.id === id)?.task.title ?? id;
  if (pairs.length === 0) return <EmptyState>When a skill learned from one task is applied to the next, the two appear here side by side.</EmptyState>;
  return (
    <div className="flex flex-col gap-5" data-testid="it-learned">
      {pairs.map((p) => (
        <div key={p.skill} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] text-ink-2">Learned from a review and approved by you, then given to the next car</span>
            <Link to={`/skills?skill=${p.skill}`} className="rounded-full bg-purple-tint px-3 py-1 font-mono text-[12px] text-purple no-underline hover:underline">
              {p.skill}
            </Link>
          </div>
          <div className="grid grid-cols-[52px_minmax(0,1fr)_auto_auto] gap-x-4 items-center text-[14px]">
            <span />
            <span className="pb-2 text-[12px] text-ink-2">Task</span>
            <span className="pb-2 text-[12px] text-ink-2">Review findings</span>
            <span className="pb-2 text-[12px] text-ink-2 text-right">Cost</span>
            {[
              ['Before', p.before, p.beforeFindings],
              ['After', p.after, p.afterFindings],
            ].map(([label, id, findings]) => (
              <div key={label as string} className="contents">
                <span className="py-2 border-t border-rule">
                  <Plate id={id as string} size="sm" />
                </span>
                <span className="py-2 border-t border-rule min-w-0">
                  <span className="block text-[12px] text-ink-3">{label}</span>
                  <Link to={`/t/${id}`} className="font-bold underline-offset-2 hover:underline">
                    {id} {title(id as string)}
                  </Link>
                </span>
                <span className={cx('py-2 border-t border-rule text-[19px] font-extrabold stretch-75 tabular', findings === 0 ? 'text-green' : 'text-yellow')}>
                  {findings as number}
                  <span className="sr-only"> review finding{findings === 1 ? '' : 's'}</span>
                </span>
                <span className="py-2 border-t border-rule text-right font-bold tabular">{money(costByTask.get(id as string) ?? null)}</span>
              </div>
            ))}
          </div>
          <span className="text-[12px] text-ink-3">Same road, one learned rule apart: the first car's review found the problem, the next car went out with the rule mounted.</span>
        </div>
      ))}
    </div>
  );
}

type OutcomeRow = { adapter: string; merged: number; reverted: number; followup: number; ci: number; incident: number };

/** What happened after merge, per agent that built the task: merged, reverted, followed up. */
function Outcomes({ rows }: { rows: OutcomeRow[] | null }) {
  if (rows === null) return <EmptyState>Reading what happened after merge.</EmptyState>;
  if (rows.length === 0) return <EmptyState>Outcomes appear here once a change has merged and the daemon has seen what happened to it.</EmptyState>;
  return (
    <div data-testid="outcomes">
      <div className="overflow-x-auto">
      <table className="w-full text-[14px] min-w-[420px]">
        <thead className="text-[12px] text-ink-2 text-left">
          <tr>
            <th className={TH}>Agent</th>
            <th className={cx(TH, 'text-right')}>Merged</th>
            <th className={cx(TH, 'text-right')}>Reverted</th>
            <th className={cx(TH, 'text-right')}>Followed up</th>
            <th className={cx(TH, 'text-right')}>Failing CI</th>
            <th className={cx(TH, 'text-right')}>Incidents</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.adapter} data-testid="outcome-row" data-agent={r.adapter}>
              <td className={TD}>
                <VendorMark agent={agentOf(r.adapter)} />
              </td>
              <td className={cx(TD, 'text-right font-bold')}>{r.merged}</td>
              <td className={cx(TD, 'text-right', r.reverted > 0 && 'text-red font-bold')}>{r.reverted}</td>
              <td className={cx(TD, 'text-right')}>{r.followup}</td>
              <td className={cx(TD, 'text-right')}>{r.ci}</td>
              <td className={cx(TD, 'text-right')}>{r.incident}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="text-[12px] text-ink-3 mt-3">A task built by two agents counts for both. The daemon records a revert, a follow-up within 7 days, a failed CI run and a reported incident on the task that merged.</p>
    </div>
  );
}

function Scoreboard({ data }: { data: { rows: ScoreRow[]; routing: { mode: string; explore: number } } | null }) {
  const [tag, setTag] = useState('*');
  if (data === null) return <EmptyState>Reading how each agent has done.</EmptyState>;
  const tags = [...new Set(data.rows.map((r) => r.tag))].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)));
  const rows = data.rows.filter((r) => r.tag === tag);
  const pct = (v: number | null) => (v === null ? 'none yet' : `${Math.round(v * 100)}%`);
  return (
    <div data-testid="scoreboard">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {tags.length > 1
          ? tags.map((t) => (
              <Button key={t} aria-pressed={t === tag} onClick={() => setTag(t)} className="h-7">
                {t === '*' ? 'All tasks' : t}
              </Button>
            ))
          : null}
        <span className="text-[12px] text-ink-3 ml-auto" data-testid="routing-mode">
          {data.routing.mode === 'learned' ? `Autopilot picks from these results, and tries another agent ${Math.round(data.routing.explore * 100)}% of the time` : 'Autopilot picks agents in the order of autopilot.implementers'}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState>Each agent's record appears here once the daemon has verified one of its runs.</EmptyState>
      ) : (
        // narrower than the table, a phone says it scrolls; a keyboard can scroll it
        <div className="overflow-x-auto" role="region" aria-label="Drivers table, scrolls sideways on a narrow screen" tabIndex={0}>
          <p className="sm:hidden mb-2 text-[12px] text-ink-2">The table scrolls sideways for every column.</p>
        <table className="w-full text-[14px] min-w-[600px]">
          <thead className="text-[12px] text-ink-2 text-left">
            <tr>
              <th className={cx(TH, 'w-[34px]')}>Pos</th>
              <th className={TH}>Driver</th>
              <th className={cx(TH, 'text-right')}>Attempts</th>
              <th className={cx(TH, 'text-right')}>Passed</th>
              <th className={cx(TH, 'text-right')} title="All three of the last three attempts passed">Last 3 all passed</th>
              <th className={cx(TH, 'text-right')}>Cost per merged task</th>
              <th className={cx(TH, 'text-right')}>Reverts</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r, i) => (
              <tr key={`${r.agent}/${r.model ?? ''}`} data-testid="score-row" data-agent={r.agent}>
                <td className={cx(TD, 'text-[19px] font-extrabold stretch-75')}>{i + 1}</td>
                <td className={TD}>
                  <VendorMark agent={agentOf(r.agent)} size={17} />
                  {r.model ? <span className="text-[12px] text-ink-2 ml-2">{modelName(r.model)}</span> : null}
                </td>
                <td className={cx(TD, 'text-right')}>{r.attempts}</td>
                <td className={cx(TD, 'text-right font-bold')}>{pct(r.passRate)}</td>
                <td className={cx(TD, 'text-right')}>{r.pass3 === null ? 'fewer than 3' : r.pass3 ? 'yes' : 'no'}</td>
                <td className={cx(TD, 'text-right')}>{r.costPerResolved === null ? (r.resolved ? 'unpriced' : 'none merged') : `$${r.costPerResolved.toFixed(2)}`}</td>
                <td className={cx(TD, 'text-right', r.reverts > 0 && 'text-red font-bold')}>{r.reverts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

const gatePct = (n: number) => `${Math.round(n * 100)}%`;

/** The phase gates: golden pass rates first, then whether each phase has opened and why. */
function PhaseGatePanel({ gates }: { gates: PhaseGates | null }) {
  if (!gates) return <EmptyState>The phase gates appear once the daemon can read the golden results.</EmptyState>;
  const rows: Array<[string, boolean, string]> = [
    ['Phase 2', gates.phase2.met, gates.phase2.detail],
    ['Phase 3', gates.phase3.met, gates.phase3.detail],
  ];
  return (
    <div data-testid="phase-gates">
      {gates.golden ? (
        <p className="text-[14px] tabular mb-3 font-bold" data-testid="golden-line">
          Golden tasks: {gates.golden.tasks} tasks, pass@1 {gatePct(gates.golden.passAt1)}, pass^{gates.golden.k} {gatePct(gates.golden.passPowK)}
          {gates.golden.usd !== null ? `, cost $${gates.golden.usd.toFixed(2)}` : ''}
        </p>
      ) : (
        <p className="text-[12px] text-ink-2 mb-3">No golden results yet. Run stint eval --golden --k 3.</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map(([name, met, detail]) => (
          <li key={name} className="flex items-start justify-between gap-3 border-t border-rule pt-2">
            <div className="min-w-0">
              <p className="text-[14px] font-bold">{name}</p>
              <p className="text-[12px] text-ink-2">{detail}</p>
            </div>
            <StatusChip label={met ? 'open' : 'not yet'} tone={met ? 'good' : 'neutral'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AutoApprove({ state, onChanged }: { state: RiskState | null; onChanged: () => void }) {
  if (state === null) return <EmptyState>Reading the shadow record.</EmptyState>;
  const { lane } = state;
  return (
    <div data-testid="auto-approve" className="flex flex-col gap-3 text-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={lane.enabled ? 'lane on' : 'lane off'} tone={lane.enabled ? 'warn' : 'neutral'} />
        <span className="text-ink-2">
          {lane.enabled
            ? `The policy may approve ${lane.tiers.join(' and ')} risk once ${lane.shadowDays} days of shadow decisions agree with yours.`
            : 'Every change waits for you. The record below shows what the policy would have done.'}
        </span>
        {lane.enabled ? (
          <Button className="ml-auto" tone="danger" data-testid="lane-off" onClick={() => void api.laneOff().then(onChanged)}>
            Turn the lane off
          </Button>
        ) : null}
      </div>
      {state.records.length === 0 ? (
        <EmptyState>Each approve or reject you make is recorded beside what the policy would have done.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-[14px] min-w-[480px]">
          <thead className="text-[12px] text-ink-2 text-left">
            <tr>
              <th className={TH}>Risk</th>
              <th className={cx(TH, 'text-right')}>Decisions</th>
              <th className={cx(TH, 'text-right')}>Agreed with you</th>
              <th className={cx(TH, 'text-right')}>Disagreed</th>
              <th className={cx(TH, 'text-right')}>Reverted after it would approve</th>
              <th className={cx(TH, 'text-right')}>Days on record</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {state.records.map((r) => (
              <tr key={r.tier} data-testid="shadow-row" data-tier={r.tier}>
                <td className={TD}>{r.tier}</td>
                <td className={cx(TD, 'text-right')}>{r.decisions}</td>
                <td className={cx(TD, 'text-right')}>{r.agreements}</td>
                <td className={cx(TD, 'text-right')}>{r.disagreements}</td>
                <td className={cx(TD, 'text-right')}>{r.revertsAfterWouldApprove}</td>
                <td className={cx(TD, 'text-right')}>{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <ul className="text-[12px] text-ink-2 flex flex-col gap-1">
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
        Upkeep is off. With <span className="font-mono">"gardening": {'{'} "schedule": "weekly" {'}'}</span> in the config, Stint makes a doc gardening task and a dead code and drift task each week, and they go through autopilot to your approval.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-2 text-[14px]" data-testid="upkeep">
      {data.templates.map((t) => (
        <li key={t.id} className="flex flex-wrap items-baseline gap-2 border-t border-rule pt-2" data-testid="upkeep-row" data-template={t.id}>
          <span className="font-bold min-w-0">{t.title}</span>
          <span className="ml-auto text-ink-2 text-[12px] tabular">
            {t.openTask ? (
              <>
                open as{' '}
                <Link to={`/t/${t.openTask}`} className="underline underline-offset-2">
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
  return (
    <div data-testid="any-harness" className="flex flex-col gap-3 text-[14px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="harness-chips">
        <span className="text-ink-2 w-[72px]">Harnesses</span>
        {agents.map((a) => (
          <StatusChip key={a.id} label={`${ADAPTER_NAMES[a.id] ?? a.id}${a.harness && a.harness !== 'cli' ? `, ${a.harness}` : ''}`} tone={a.capability.level === 'supported' ? 'good' : 'neutral'} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="host-chips">
        <span className="text-ink-2 w-[72px]">Hosts</span>
        {hosts.map((h) => {
          const ready = (health.models ?? []).some((m) => m.host === h && m.ready);
          return <StatusChip key={h} label={hostName(h)} tone={ready ? 'good' : 'neutral'} />;
        })}
      </div>
      <p className="text-[12px] text-ink-2">A green flag is ready here; a grey one is configured and off. Every one of them starts from the same packet, so a car can change driver to any of them.</p>
    </div>
  );
}

/**
 * A section of the standings: a heading over its figures, no box around it. A `collapsed` one is a disclosure that opens
 * on its heading, so the page leads with what the week came to and keeps the rest one click away.
 */
function Panel({ title, aside, children, className, testId, collapsed = false }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string; collapsed?: boolean }) {
  const head = (
    <>
      <h2 className="text-[19px] leading-6 font-bold stretch-112 tracking-[-0.01em]">{title}</h2>
      {aside}
    </>
  );
  if (collapsed)
    return (
      <details className={cx('group min-w-0 border-t border-rule', className)} data-testid={testId}>
        <summary className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:underline underline-offset-4">
          <span className="flex items-baseline gap-2">
            <span aria-hidden="true" className="inline-block w-3 text-ink-2 transition-transform group-open:rotate-90">
              ›
            </span>
            {head}
          </span>
        </summary>
        <div className="flex flex-col gap-3 pb-6">{children}</div>
      </details>
    );
  return (
    <section className={cx('flex flex-col gap-3 min-w-0', className)} data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">{head}</div>
      {children}
    </section>
  );
}

/** Spend by car, split by team from what each stint cost; the rest of a car's total is planning and review calls. */
function SpendByCar({ rows }: { rows: Array<{ task: string; total: number; teams: Array<[Mark, number]> }> | null }) {
  if (rows === null) return <EmptyState>Reading what each car cost.</EmptyState>;
  if (rows.length === 0) return <EmptyState>Spend by car appears once a run ends.</EmptyState>;
  const max = Math.max(0.0001, ...rows.map((r) => r.total));
  const teams = [...new Set(rows.flatMap((r) => r.teams.map(([t]) => t)))];
  return (
    <div data-testid="spend-by-car" className="flex flex-col gap-3">
      <ul className="grid grid-cols-[44px_minmax(0,1fr)_60px] gap-x-3 gap-y-3 items-center">
        {rows.map((r) => (
          <li key={r.task} className="contents">
            <Plate id={r.task} size="sm" />
            <span className="flex h-4 gap-px" role="img" aria-label={`Car ${carNumber(r.task)}: ${r.teams.map(([t, usd]) => `${TEAM_NAMES[t]} $${usd.toFixed(2)}`).join(', ') || 'no stint cost'}`} style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }}>
              {r.teams.map(([t, usd]) => (
                <span key={t} style={{ flexGrow: Math.max(usd, r.total * 0.02), background: markColor[t] }} />
              ))}
              {r.total - r.teams.reduce((s, [, usd]) => s + usd, 0) > 0.005 ? <span style={{ flexGrow: r.total - r.teams.reduce((s, [, usd]) => s + usd, 0) }} className="bg-rule-strong" /> : null}
            </span>
            <span className="text-right font-bold tabular">${r.total.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {teams.map((t) => (
          <span key={t} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: markColor[t] }} />
            {TEAM_NAMES[t]}{t === 'local' ? ', a sliver because it costs nothing' : ''}
          </span>
        ))}
        {rows.some((r) => r.total - r.teams.reduce((s, [, usd]) => s + usd, 0) > 0.005) ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-rule-strong" />
            Other calls on the car, outside a stint
          </span>
        ) : null}
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
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
  const [spendByCar, setSpendByCar] = useState<Array<{ task: string; total: number; teams: Array<[Mark, number]> }> | null>(null);
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
        // what each car cost, by the team of the driver whose stint spent it
        const cars = all.flatMap((events, i) => {
          const card = cards[i];
          if (!card) return [];
          const team = new Map<string, Mark>();
          const byTeam = new Map<Mark, number>();
          for (const e of events) {
            if (e.type === 'run.started' && e.run) team.set(e.run, agentOf(e.adapter, typeof e.payload.host === 'string' ? e.payload.host : null, typeof e.payload.model === 'string' ? e.payload.model : null).mark);
            const usd = e.type === 'run.finished' && e.run ? Number((e.payload.cost as { usd?: unknown } | undefined)?.usd) || 0 : 0;
            const mark = e.run ? team.get(e.run) : undefined;
            // a stint that cost nothing still shows its team, as a sliver
            if (e.type === 'run.finished' && mark) byTeam.set(mark, (byTeam.get(mark) ?? 0) + usd);
          }
          const total = card.cost.usd ?? [...byTeam.values()].reduce((s, v) => s + v, 0);
          return total > 0 || byTeam.size ? [{ task: card.task.id, total, teams: [...byTeam.entries()] }] : [];
        });
        setSpendByCar(cars.sort((a, b) => b.total - a.total));
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
    target?.scrollIntoView({ block: 'start' });
  }, [hash, cards, health]);

  const counts = funnel ?? {};
  const costByTask = useMemo(() => new Map((byTask ?? []).map((r) => [r.key, r])), [byTask]);
  const week = (byModel ?? []).reduce((s, r) => s + (r.usd ?? 0), 0);
  const input = (byModel ?? []).reduce((s, r) => s + r.inputTokens, 0);
  const cached = (byModel ?? []).reduce((s, r) => s + r.cachedTokens, 0);
  const runs = (byModel ?? []).reduce((s, r) => s + r.runs, 0);

  const merged = (cards ?? []).filter((c) => c.task.status === 'done').length;
  // the headline says what the week came to: rules learned first, else merges, else that it has not started
  const headline = learned ? `The factory learned ${learned === 1 ? 'one rule' : `${learned} rules`} this week` : merged ? `The factory merged ${merged === 1 ? 'one task' : `${merged} tasks`} this week` : 'The factory is ready for its first task';
  return (
    <main className="relative flex-1 min-h-0 overflow-y-auto" data-testid="factory">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8 flex flex-col gap-8">
        <h1 className="text-[19px] leading-6 sm:text-[34px] sm:leading-10 font-bold stretch-112 tracking-[-0.02em] [text-wrap:balance]" data-testid="factory-headline">
          {headline}
        </h1>

        <dl className="m-0 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 border-t border-rule-strong pt-4" data-testid="kpis">
          <Figure label="Spend this week" value={`$${week.toFixed(2)}`} detail={cards?.length ? `$${(week / cards.length).toFixed(2)} per task, list prices` : undefined} />
          <Figure
            label="Runs and merges"
            value={`${runs} run${runs === 1 ? '' : 's'}${merges?.value ? `, ${merges.value} merged` : ''}`}
            detail={hops?.value !== null && hops?.value !== undefined ? `${metricValue(hops)} implementer runs per merged task` : 'no merges in this window yet'}
          />
          <Figure
            label="Fed forward as transcripts"
            value={transcripts?.value !== null && transcripts?.value !== undefined ? metricValue(transcripts) : '0%'}
            detail={packetTokens?.value !== null && packetTokens?.value !== undefined ? `all in packets, a median ${metricValue(packetTokens)} each` : 'packets, never transcripts'}
            testId="kpi-transcript-share"
          />
          <Figure label="Skills learned" value={String(learned)} detail={learned ? 'approved by you, now mounted' : 'none proposed yet'} />
        </dl>

        <MetricsPanel data={metrics.data} error={metrics.error} window={span} onWindow={setSpan} />

        <Queue />

        <Panel title="It learned" testId="panel-it-learned">
          <ItLearned helped={helped ?? []} costByTask={costByTask} />
        </Panel>

        <Panel title="The relay" testId="panel-relay">
          <Relay />
        </Panel>

        <Panel title="Drivers" testId="panel-scoreboard">
          <Scoreboard data={scores} />
          <span className="text-[12px] text-ink-2">Each agent and model, by its attempts the daemon verified. Pass rate counts green verifications.</span>
        </Panel>

        <div className="flex flex-col">
          <Panel title="Stages, last 7 days" collapsed testId="panel-loops">
            <Loops counts={counts} />
            <p className="text-[12px] text-ink-2">Tasks that entered each stage in the 7 days up to the last event, from each task's status history. A task counts once per stage.</p>
          </Panel>
          <Panel title="Meta models at work" collapsed testId="panel-models">
            <ModelsAtWork rows={byModel ?? []} />
            <p className="text-[12px] text-ink-2">
              Input from cache: {input ? `${Math.round((cached / input) * 100)}%` : 'none'}, {tokens(cached)} of {tokens(input)} tokens.
            </p>
          </Panel>
          <Panel title="Spend by car" aside={<span className="text-[12px] text-ink-2">split by team</span>} collapsed testId="panel-spend">
            <SpendByCar rows={spendByCar} />
          </Panel>
          <Panel title="Cost per day" collapsed testId="panel-cost-day">
            <CostByDay rows={byDayHost ?? []} />
          </Panel>
          <Panel title="Credits left" collapsed testId="panel-credits">
            <CreditsLeft rows={byHost ?? []} />
          </Panel>
          <Panel title="Outcomes after merge" collapsed testId="panel-outcomes">
            <Outcomes rows={outcomeRows} />
          </Panel>
          <Panel title="Phase gates" collapsed testId="panel-phase-gates">
            <PhaseGatePanel gates={gates} />
          </Panel>
          <Panel title="Auto-approve" collapsed testId="panel-auto-approve">
            <AutoApprove state={risk} onChanged={() => setRiskVersion((v) => v + 1)} />
          </Panel>
          <Panel title={`Upkeep${upkeep && upkeep.schedule !== 'off' ? `, ${upkeep.schedule}` : ''}`} collapsed testId="panel-upkeep">
            <Upkeep data={upkeep} />
          </Panel>
          <Panel title="Workspace memory" collapsed testId="panel-memory">
            <WorkspaceMemory />
          </Panel>
          {bench ? (
            <Panel title="Packet against transcript" collapsed testId="panel-bench">
              <Benchmark data={bench} />
            </Panel>
          ) : null}
        </div>

        <section id="any-harness" className="scroll-mt-4 pt-6 border-t border-rule-strong">
          <Panel title="One packet, any harness" testId="panel-any-harness">
            <AnyHarness health={health as Health | null} />
          </Panel>
        </section>

        <footer className="pt-3 border-t border-rule flex flex-wrap justify-between gap-2 text-[12px] text-ink-2">
          <span>Every row is a folder in .stint/tasks/, and every figure is computed by the daemon from its events.jsonl at the list prices in config.json. Credits left are derived from metered spend, not read from the provider.</span>
          <span>Built on Meta's Muse models</span>
        </footer>
      </div>
    </main>
  );
}
