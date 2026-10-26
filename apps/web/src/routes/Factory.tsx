import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ROLE_NAMES, agentOf, hostName, modelName } from '../agents';
import { type CostRow, api } from '../api';
import { Queue } from '../components/MemoryPanel';
import { Relay } from '../components/Relay';
import { EmptyState, VendorMark, cx } from '../components/ui';
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

function Figure({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="text-[22px] font-semibold tabular leading-tight">{value}</p>
      {detail ? <p className="text-[12px] text-faint">{detail}</p> : null}
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
  const byTask = useLoad(() => api.costs('task'), []);
  const helped = useLoad(() => api.graphQuery<Helped>({ q: 'skills-helped' }), []);
  const [handoffs, setHandoffs] = useState<number | null>(null);
  const [learned, setLearned] = useState(0);
  const [outcomeRows, setOutcomeRows] = useState<OutcomeRow[] | null>(null);
  useEffect(() => {
    if (!cards) return;
    let live = true;
    Promise.all(cards.map((c) => api.events(c.task.id)))
      .then((all) => {
        if (!live) return;
        setHandoffs(all.flat().filter((e) => e.type === 'run.started' && e.payload.handoffFrom).length);
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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const card of cards ?? []) c[card.task.status] = (c[card.task.status] ?? 0) + 1;
    return c;
  }, [cards]);
  const costByTask = useMemo(() => new Map((byTask ?? []).map((r) => [r.key, r])), [byTask]);
  const week = (byModel ?? []).reduce((s, r) => s + (r.usd ?? 0), 0);
  const input = (byModel ?? []).reduce((s, r) => s + r.inputTokens, 0);
  const cached = (byModel ?? []).reduce((s, r) => s + r.cachedTokens, 0);
  const runs = (byModel ?? []).reduce((s, r) => s + r.runs, 0);
  const inFlight = (cards ?? []).filter((c) => !['done', 'abandoned', 'planned'].includes(c.task.status)).length;
  const auto = (health as { autopilot?: { running: string[]; queued: string[] } } | null)?.autopilot;

  return (
    <main className="flex-1 min-h-0 overflow-y-auto" data-testid="factory">
      <div className="max-w-[1180px] mx-auto px-4 py-6 flex flex-col gap-4">
        <header>
          <h1 className="text-[20px] font-semibold">Factory</h1>
          <p className="text-muted text-[13px] mt-1">Which model did the work, what it cost, and what the factory learned.</p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 rounded-lg border border-line bg-raised p-4" data-testid="kpis">
          <Figure label="In flight" value={String(inFlight)} detail={auto ? `${auto.running.length} on autopilot${auto.queued.length ? `, ${auto.queued.length} queued` : ''}` : undefined} testId="kpi-in-flight" />
          <Figure label="Runs" value={String(runs)} detail={handoffs === null ? undefined : `${handoffs} continued from a packet`} />
          <Figure label="Spent" value={`$${week.toFixed(2)}`} detail={cards?.length ? `$${(week / cards.length).toFixed(2)} per task` : undefined} />
          <Figure label="Input from cache" value={input ? `${Math.round((cached / input) * 100)}%` : 'none'} detail={`${tokens(cached)} of ${tokens(input)} tokens`} />
          <Figure label="Skills learned" value={String(learned)} detail="each approved by you" />
        </div>

        <Panel title="The relay: who carried each task, and what they handed on" testId="panel-relay">
          <Relay />
        </Panel>

        <Panel title="Meta models at work" testId="panel-models">
          <ModelsAtWork rows={byModel ?? []} />
        </Panel>

        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Tasks by stage">
            <Loops counts={counts} />
          </Panel>
          <Panel title="Cost per day, by host">
            <CostByDay rows={byDayHost ?? []} />
          </Panel>
        </div>

        <Panel title="Outcomes after merge, per agent" testId="panel-outcomes">
          <Outcomes rows={outcomeRows} />
        </Panel>

        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="It learned">
            <ItLearned helped={helped ?? []} costByTask={costByTask} />
          </Panel>
          <Panel title="Decisions waiting for you">
            <Queue />
            <p className="text-[12px] text-faint">A reviewer can propose reversing a decision, but only you can accept it.</p>
          </Panel>
        </div>
      </div>
    </main>
  );
}
