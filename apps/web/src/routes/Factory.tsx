import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ADAPTER_NAMES, ROLE_NAMES, agentOf, hostName, modelName } from '../agents';
import { type BenchData, type BenchMode, type CostRow, type Gardening, type Health, type PhaseGates, type RiskState, type ScoreRow, api } from '../api';
import { Queue, WorkspaceMemory } from '../components/MemoryPanel';
import { Relay } from '../components/Relay';
import { Button, EmptyState, StatusChip, VendorMark, cx } from '../components/ui';
import { money, tokens } from '../format';
import { useHealth, useTasks } from '../hooks';

const isMeta = (model: string) => /(^|\/)(muse-|llama)/i.test(model);

const HOST_COLOUR: Record<string, string> = {
  'meta-api': 'var(--vendor-meta)',
  ollama: 'var(--vendor-local)',
  fireworks: 'var(--vendor-alt)',
  baseten: 'var(--vendor-alt)',
  modal: 'var(--vendor-alt)',
};

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
      <div className="flex h-3 rounded-full overflow-hidden border border-line mb-4" role="img" aria-label="Share of tokens by model">
        {models.map((m, i) => (
          <span
            key={m.key}
            style={{ width: `${(m.total / Math.max(1, all)) * 100}%`, background: isMeta(m.model) ? 'var(--vendor-meta)' : 'var(--vendor-alt)', opacity: 1 - i * 0.18 }}
            title={`${modelName(m.model)}: ${tokens(m.total)} tokens`}
          />
        ))}
      </div>
      <table className="w-full text-[13px]">
        <thead className="text-[12px] text-muted text-left">
          <tr>
            <th className="font-normal pb-2">Model</th>
            <th className="font-normal pb-2">Ran on</th>
            <th className="font-normal pb-2">Did</th>
            <th className="font-normal pb-2 text-right">Tokens in</th>
            <th className="font-normal pb-2 text-right">From cache</th>
            <th className="font-normal pb-2 text-right">Out</th>
            <th className="font-normal pb-2 text-right">Runs</th>
            <th className="font-normal pb-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {models.map((m) => (
            <tr key={m.key} className="border-t border-line" data-testid="model-row">
              <td className="py-2 font-medium">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-sm" style={{ background: isMeta(m.model) ? 'var(--vendor-meta)' : 'var(--vendor-alt)' }} />
                  {modelName(m.model)}
                </span>
              </td>
              <td className="py-2 text-muted">{hostName(m.host)}</td>
              <td className="py-2 text-muted">{(m.roles ?? []).map((r) => ROLE_NAMES[r] ?? r).join(', ') || 'runs'}</td>
              <td className="py-2 text-right">{tokens(m.inputTokens)}</td>
              <td className="py-2 text-right text-muted">{m.inputTokens ? `${Math.round((m.cachedTokens / m.inputTokens) * 100)}%` : 'none'}</td>
              <td className="py-2 text-right">{tokens(m.outputTokens)}</td>
              <td className="py-2 text-right">{m.runs}</td>
              <td className="py-2 text-right">{m.host === 'ollama' ? 'free, local' : money(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    { label: 'the packet with the diff digest', m: data.digest?.byMode.packet, base: false },
  ].filter((l): l is { label: string; m: BenchMode; base: boolean } => l.m !== undefined);
  const tasks = new Set(data.rows.map((r) => r.task)).size;
  const colour = (base: boolean) => (base ? 'var(--ink-faint)' : 'var(--accent)');
  return (
    <div data-testid="bench">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[13px] min-w-[640px]">
          <thead className="text-[12px] text-muted text-left">
            <tr>
              <th className="font-normal pb-2 w-[26%]">Continue from</th>
              {BENCH_COLUMNS.map((c) => (
                <th key={c.name} className="font-normal pb-2 pl-4 text-right">
                  {c.name}
                </th>
              ))}
              <th className="font-normal pb-2 pl-4 text-right w-[12%]">Tests green</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {lines.map((l) => (
              <tr key={l.label} className="border-t border-line" data-testid="bench-row">
                <td className="py-2 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="size-2.5 rounded-sm" style={{ background: colour(l.base) }} />
                    {l.label}
                  </span>
                </td>
                {BENCH_COLUMNS.map((c) => {
                  const v = c.value(l.m);
                  const max = Math.max(...lines.map((x) => c.value(x.m) ?? 0));
                  return (
                    <td key={c.name} className="py-2 pl-4 text-right">
                      {v === null ? <span className="text-muted">unpriced</span> : c.show(v)}
                      <div className="mt-1 h-1.5 rounded-full bg-sunken">
                        <div className="h-full rounded-full" style={{ width: `${v === null || max === 0 ? 0 : (v / max) * 100}%`, background: colour(l.base) }} />
                      </div>
                    </td>
                  );
                })}
                <td className="py-2 pl-4 text-right">
                  {Math.round(l.m.passRate * l.m.runs)} of {l.m.runs}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted max-w-[90ch]">
        {data.synthetic ? 'Synthetic rows, ' : data.replay ? 'Rebuilt from recorded runs, ' : `Live on ${new Date(data.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, `}
        {tasks} tasks from commit <span className="font-mono">{data.commit.slice(0, 7)}</span>: {ADAPTER_NAMES[data.implementer] ?? data.implementer} is stopped at the same step each time, then the Stint agent on {modelName(data.models[data.continuer] ?? null)} continues and the daemon runs the tests. Means per run. One run per task, so read it as a first measurement.
      </p>
    </div>
  );
}

function Figure({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-raised p-4" data-testid={testId}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular leading-tight tracking-[-0.01em]">{value}</p>
      {detail ? <p className="mt-1 text-[12px] text-muted truncate" title={detail}>{detail}</p> : null}
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
    <ul className="flex flex-col gap-1.5" data-testid="loops">
      {STAGES.map(([k, name]) => (
        <li key={k} className="grid grid-cols-[88px_1fr_24px] items-center gap-2 text-[12px]">
          <span className="text-muted">{name}</span>
          <span className="h-2 rounded-full bg-sunken overflow-hidden">
            <span className={cx('block h-full rounded-full', k === 'awaiting_approval' ? 'bg-warn' : k === 'done' ? 'bg-good' : 'bg-accent')} style={{ width: `${((counts[k] ?? 0) / max) * 100}%` }} />
          </span>
          <span className="tabular text-right">{counts[k] ?? 0}</span>
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
              <span className="text-[11px] tabular text-muted">${total.toFixed(2)}</span>
              <div className="w-full max-w-10 flex flex-col-reverse rounded-sm overflow-hidden" style={{ height: `${(total / max) * 96}px` }}>
                {[...m.entries()].map(([h, v]) => (
                  <span key={h} style={{ height: `${(v / Math.max(total, 0.0001)) * 100}%`, background: HOST_COLOUR[h] ?? 'var(--vendor-alt)' }} title={`${hostName(h)}: $${v.toFixed(2)}`} />
                ))}
              </div>
              <span className="text-[11px] text-faint tabular">{day.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted" data-testid="cost-legend">
        {hosts.map((h) => (
          <span key={h} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: HOST_COLOUR[h] ?? 'var(--vendor-alt)' }} />
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
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {left.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-2" data-testid="credits-row" data-host={r.key}>
            <span className="text-muted">{hostName(r.key)}</span>
            <span className="tabular">≈ ${(r.creditsLeft as number).toFixed(2)} left</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-faint mt-3">Derived from metered spend, not read from the provider.</p>
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
    <div className="flex flex-col gap-3" data-testid="it-learned">
      {pairs.map((p) => (
        <div key={p.skill} className="rounded-lg border border-line bg-raised p-4">
          <p className="text-[12px] text-muted mb-3">
            Skill <span className="font-mono text-good">{p.skill}</span>, learned from a review and approved by you
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[
              ['Before', p.before, p.beforeFindings],
              ['After', p.after, p.afterFindings],
            ].map(([label, id, findings]) => (
              <div key={label as string}>
                <p className="text-[12px] text-faint">{label}</p>
                <Link to={`/t/${id}`} className="font-medium hover:text-accent">
                  {id} {title(id as string)}
                </Link>
                <p className="text-[13px] tabular mt-1">
                  {money(costByTask.get(id as string) ?? null)}, {findings === 0 ? 'no review findings' : `${findings} review finding${findings === 1 ? '' : 's'}`}
                </p>
              </div>
            ))}
          </div>
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
      <table className="w-full text-[13px]">
        <thead className="text-[12px] text-muted text-left">
          <tr>
            <th className="font-normal pb-2">Agent</th>
            <th className="font-normal pb-2 text-right">Merged</th>
            <th className="font-normal pb-2 text-right">Reverted</th>
            <th className="font-normal pb-2 text-right">Followed up</th>
            <th className="font-normal pb-2 text-right">Failing CI</th>
            <th className="font-normal pb-2 text-right">Incidents</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.adapter} className="border-t border-line" data-testid="outcome-row" data-agent={r.adapter}>
              <td className="py-2 font-medium">
                <VendorMark agent={agentOf(r.adapter)} />
              </td>
              <td className="py-2 text-right">{r.merged}</td>
              <td className="py-2 text-right">{r.reverted}</td>
              <td className="py-2 text-right">{r.followup}</td>
              <td className="py-2 text-right">{r.ci}</td>
              <td className="py-2 text-right">{r.incident}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[12px] text-faint mt-3">A task built by two agents counts for both. The daemon records a revert, a follow-up within 7 days, a failed CI run and a reported incident on the task that merged.</p>
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
        <span className="text-[12px] text-muted ml-auto" data-testid="routing-mode">
          {data.routing.mode === 'learned' ? `Autopilot picks from these results, and tries another agent ${Math.round(data.routing.explore * 100)}% of the time` : 'Autopilot picks agents in the order of autopilot.implementers'}
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState>Each agent's record appears here once the daemon has verified one of its runs.</EmptyState>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-[12px] text-muted text-left">
            <tr>
              <th className="font-normal pb-2">Agent and model</th>
              <th className="font-normal pb-2 text-right">Attempts</th>
              <th className="font-normal pb-2 text-right">Passed</th>
              <th className="font-normal pb-2 text-right" title="All three of the last three attempts passed">Last 3 all passed</th>
              <th className="font-normal pb-2 text-right">Cost per merged task</th>
              <th className="font-normal pb-2 text-right">Reverts</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={`${r.agent}/${r.model ?? ''}`} className="border-t border-line" data-testid="score-row" data-agent={r.agent}>
                <td className="py-2">
                  <VendorMark agent={agentOf(r.agent)} />
                  {r.model ? <span className="text-muted ml-2">{modelName(r.model)}</span> : null}
                </td>
                <td className="py-2 text-right">{r.attempts}</td>
                <td className="py-2 text-right">{pct(r.passRate)}</td>
                <td className="py-2 text-right">{r.pass3 === null ? 'fewer than 3' : r.pass3 ? 'yes' : 'no'}</td>
                <td className="py-2 text-right">{r.costPerResolved === null ? (r.resolved ? 'unpriced' : 'none merged') : `$${r.costPerResolved.toFixed(2)}`}</td>
                <td className="py-2 text-right">{r.reverts}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <p className="text-[13px] tabular mb-3" data-testid="golden-line">
          Golden tasks: {gates.golden.tasks} tasks, pass@1 {gatePct(gates.golden.passAt1)}, pass^{gates.golden.k} {gatePct(gates.golden.passPowK)}
          {gates.golden.usd !== null ? `, cost $${gates.golden.usd.toFixed(2)}` : ''}
        </p>
      ) : (
        <p className="text-[13px] text-muted mb-3">No golden results yet. Run stint eval --golden --k 3.</p>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map(([name, met, detail]) => (
          <li key={name} className="flex items-start justify-between gap-3 border-t border-line pt-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{name}</p>
              <p className="text-[12px] text-muted">{detail}</p>
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
    <div data-testid="auto-approve" className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={lane.enabled ? 'lane on' : 'lane off'} tone={lane.enabled ? 'warn' : 'neutral'} />
        <span className="text-muted">
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
        <table className="w-full text-[13px]">
          <thead className="text-[12px] text-muted text-left">
            <tr>
              <th className="font-normal pb-2">Risk</th>
              <th className="font-normal pb-2 text-right">Decisions</th>
              <th className="font-normal pb-2 text-right">Agreed with you</th>
              <th className="font-normal pb-2 text-right">Disagreed</th>
              <th className="font-normal pb-2 text-right">Reverted after it would approve</th>
              <th className="font-normal pb-2 text-right">Days on record</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {state.records.map((r) => (
              <tr key={r.tier} className="border-t border-line" data-testid="shadow-row" data-tier={r.tier}>
                <td className="py-2">{r.tier}</td>
                <td className="py-2 text-right">{r.decisions}</td>
                <td className="py-2 text-right">{r.agreements}</td>
                <td className="py-2 text-right">{r.disagreements}</td>
                <td className="py-2 text-right">{r.revertsAfterWouldApprove}</td>
                <td className="py-2 text-right">{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="text-[12px] text-muted flex flex-col gap-1">
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
    <ul className="flex flex-col gap-2 text-[13px]" data-testid="upkeep">
      {data.templates.map((t) => (
        <li key={t.id} className="flex flex-wrap items-baseline gap-2 border-t border-line pt-2" data-testid="upkeep-row" data-template={t.id}>
          <span className="font-medium min-w-0">{t.title}</span>
          <span className="ml-auto text-muted text-[12px] tabular">
            {t.openTask ? (
              <>
                open as{' '}
                <Link to={`/t/${t.openTask}`} className="text-accent hover:underline">
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
    <div data-testid="any-harness" className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="harness-chips">
        <span className="text-muted w-[64px]">Harnesses</span>
        {agents.map((a) => (
          <StatusChip key={a.id} label={`${ADAPTER_NAMES[a.id] ?? a.id}${a.harness && a.harness !== 'cli' ? `, ${a.harness}` : ''}`} tone={a.capability.level === 'supported' ? 'good' : 'neutral'} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="host-chips">
        <span className="text-muted w-[64px]">Hosts</span>
        {hosts.map((h) => {
          const ready = (health.models ?? []).some((m) => m.host === h && m.ready);
          return <StatusChip key={h} label={hostName(h)} tone={ready ? 'good' : 'neutral'} />;
        })}
      </div>
      <p className="text-[12px] text-muted">Green is ready here; grey is configured and off. Every one of them starts from the same packet, so a task can move between any of them.</p>
    </div>
  );
}

function Panel({ title, children, className, testId }: { title: string; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-raised p-4', className)} data-testid={testId}>
      <h2 className="text-[13px] font-semibold mb-3">{title}</h2>
      {children}
    </section>
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
  const [handoffs, setHandoffs] = useState<number | null>(null);
  const [learned, setLearned] = useState(0);
  const [outcomeRows, setOutcomeRows] = useState<OutcomeRow[] | null>(null);
  const [fedForward, setFedForward] = useState<{ packetTokens: number; hops: number } | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!cards) return;
    let live = true;
    Promise.all(cards.map((c) => api.events(c.task.id)))
      .then((all) => {
        if (!live) return;
        setHandoffs(all.flat().filter((e) => e.type === 'run.started' && e.payload.handoffFrom).length);
        // What was fed forward into continued runs, counted from the packets those runs started from (R-052).
        // Transcripts are kept for audit and never fed forward, so every fed-forward token here is packet tokens.
        let packetTokens = 0;
        let hops = 0;
        // The loops funnel: distinct tasks that entered each stage in the 7 days up to the last event (R-052).
        const latest = Math.max(0, ...all.flat().map((e) => Date.parse(e.ts)));
        const since = latest - 7 * 86_400_000;
        const entered = new Map<string, Set<string>>();
        const enter = (state: string, task: string) => (entered.get(state) ?? entered.set(state, new Set()).get(state))?.add(task);
        for (const [i, events] of all.entries()) {
          const task = cards[i]?.task.id ?? events[0]?.task ?? '';
          const packets = new Map<string, number>();
          for (const e of events) if (e.type === 'handoff.created' && typeof e.payload.name === 'string') packets.set(e.payload.name, Number(e.payload.tokens) || 0);
          for (const e of events) {
            if (e.type === 'run.started' && typeof e.payload.handoffFrom === 'string') {
              hops += 1;
              packetTokens += packets.get(e.payload.handoffFrom) ?? 0;
            }
            const t = Date.parse(e.ts);
            if (t < since || t > latest) continue;
            if (e.type === 'task.created') enter('planned', task);
            else if (e.type === 'task.status' && typeof e.payload.to === 'string') enter(e.payload.to, task);
          }
        }
        setFedForward({ packetTokens, hops });
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

  const counts = funnel ?? {};
  const costByTask = useMemo(() => new Map((byTask ?? []).map((r) => [r.key, r])), [byTask]);
  const week = (byModel ?? []).reduce((s, r) => s + (r.usd ?? 0), 0);
  const input = (byModel ?? []).reduce((s, r) => s + r.inputTokens, 0);
  const cached = (byModel ?? []).reduce((s, r) => s + r.cachedTokens, 0);
  const runs = (byModel ?? []).reduce((s, r) => s + r.runs, 0);
  const inFlight = (cards ?? []).filter((c) => !['done', 'abandoned', 'planned'].includes(c.task.status)).length;
  const auto = (health as { autopilot?: { running: string[]; queued: string[] } } | null)?.autopilot;

  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const merged = (cards ?? []).filter((c) => c.task.status === 'done').length;
  // the headline says what the week came to: rules learned first, else merges, else that it has not started
  const headline = learned ? `The factory learned ${learned === 1 ? 'one rule' : `${learned} rules`} this week` : merged ? `The factory merged ${merged === 1 ? 'one task' : `${merged} tasks`} this week` : 'The factory is ready for its first task';
  const live = (cards ?? []).filter((c) => !['done', 'abandoned', 'planned'].includes(c.task.status));
  return (
    <main className="flex-1 min-h-0 overflow-y-auto" data-testid="factory">
      <div className="px-4 py-6 flex flex-col gap-4 max-w-[1600px] mx-auto">
        <header>
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em]" data-testid="factory-headline">
            {headline}
          </h1>
          <p className="text-muted text-[13px] mt-1">
            {monday.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} to today. Every figure is computed by the daemon from each task's events.jsonl; derived figures carry ≈.
          </p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="kpis">
          <Figure label="Tasks in flight" value={String(inFlight)} detail={live.length ? live.slice(0, 2).map((c) => `${c.task.id} ${c.task.status.replace('_', ' ')}`).join(', ') : auto?.queued.length ? `${auto.queued.length} queued` : 'nothing running'} testId="kpi-in-flight" />
          <Figure label="Runs and hand-offs" value={`${runs} run${runs === 1 ? '' : 's'}${handoffs ? `, ${handoffs} hop${handoffs === 1 ? '' : 's'}` : ''}`} detail={handoffs === null ? undefined : handoffs ? `${handoffs} continued from a packet, no work lost` : 'every run was the first on its task'} />
          <Figure label="Spend this week" value={`$${week.toFixed(2)}`} detail={cards?.length ? `$${(week / cards.length).toFixed(2)} per task, list prices` : undefined} />
          <Figure label="Input from cache" value={input ? `${Math.round((cached / input) * 100)}%` : 'none'} detail={`${tokens(cached)} of ${tokens(input)} tokens`} />
          <Figure
            label="Fed forward as transcripts"
            value="0%"
            detail={fedForward ? `${tokens(fedForward.packetTokens)} tokens fed forward, all in ${fedForward.hops} packet${fedForward.hops === 1 ? '' : 's'}` : 'packets, never transcripts'}
            testId="kpi-transcript-share"
          />
          <Figure label="Skills learned" value={String(learned)} detail={learned ? 'approved by you, now mounted' : 'none proposed yet'} />
        </div>

        <Panel title="The relay: who carried each task, and what they handed on" testId="panel-relay">
          <Relay />
        </Panel>

        <Panel title="Memory: the whole workspace" testId="panel-memory">
          <WorkspaceMemory />
        </Panel>

        <Panel title="Meta models at work" testId="panel-models">
          <ModelsAtWork rows={byModel ?? []} />
        </Panel>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-4 min-w-0">
            <Panel title="Loops: tasks entering each stage, last 7 days">
              <Loops counts={counts} />
              <p className="text-[12px] text-faint mt-3">Tasks that entered each stage in the 7 days up to the last event, from each task's status history. A task counts once per stage.</p>
            </Panel>
            <Panel title="Cost per day, by host">
              <CostByDay rows={byDayHost ?? []} />
            </Panel>
            <Panel title="Credits left, by host">
              <CreditsLeft rows={byHost ?? []} />
            </Panel>
          </div>
          <div className="flex flex-col gap-4 min-w-0">
            <Panel title="It learned" className="border-good/40">
              <ItLearned helped={helped ?? []} costByTask={costByTask} />
            </Panel>
            <Panel title="Adjudication queue: decisions waiting for you">
              <Queue />
              <p className="text-[12px] text-faint">A reviewer can propose reversing a decision and the learn step can propose a skill, but only you can accept either.</p>
            </Panel>
          </div>
        </div>

        {bench ? (
          <Panel title="Benchmark: continuing from a packet or from the transcript" testId="panel-bench">
            <Benchmark data={bench} />
          </Panel>
        ) : null}

        <Panel title="Scoreboard: how each agent has done" testId="panel-scoreboard">
          <Scoreboard data={scores} />
        </Panel>

        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Outcomes after merge, per agent" testId="panel-outcomes">
            <Outcomes rows={outcomeRows} />
          </Panel>
          <Panel title="Phase gates: the golden tasks and the shadow record" testId="panel-phase-gates">
            <PhaseGatePanel gates={gates} />
          </Panel>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Auto-approve: earned in shadow, off unless you turn it on" testId="panel-auto-approve">
            <AutoApprove state={risk} onChanged={() => setRiskVersion((v) => v + 1)} />
          </Panel>
          <Panel title={`Upkeep${upkeep && upkeep.schedule !== 'off' ? `, ${upkeep.schedule}` : ''}`} testId="panel-upkeep">
            <Upkeep data={upkeep} />
          </Panel>
        </div>

        <section id="any-harness" className="scroll-mt-4">
          <Panel title="Any harness, any model, one packet" testId="panel-any-harness">
            <AnyHarness health={health as Health | null} />
          </Panel>
        </section>

        <footer className="pt-3 border-t border-line flex flex-wrap justify-between gap-2 text-[12px] text-faint">
          <span>Prices from config.json, per host. Credits left are derived from metered spend, not read from the provider.</span>
          <span>Built on Meta's Muse models</span>
        </footer>
      </div>
    </main>
  );
}
