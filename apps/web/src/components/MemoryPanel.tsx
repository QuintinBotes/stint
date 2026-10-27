import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { modelName } from '../agents';
import { type GraphData, type GraphEdge, type GraphNode, type PendingItem, type PendingPermission, type SkillRecord, api } from '../api';
import { PermissionRows } from './Permissions';
import type { LayoutIn, LayoutOut } from '../graph.worker';
import { useTasks } from '../hooks';
import { Button, EmptyState, cx } from './ui';

const W = 328;
const H = 260;

const COLOUR: Record<string, string> = {
  task: 'var(--accent)',
  decision: 'var(--status-warn)',
  skill: 'var(--status-good)',
  finding: 'var(--status-bad)',
  outcome: 'var(--status-good)',
  merge: 'var(--status-good)',
  model: 'var(--vendor-meta)',
  rule: 'var(--status-warn)',
  file: 'var(--ink-faint)',
  run: 'var(--ink-muted)',
};
const TYPE_NAMES: Array<[string, string]> = [
  ['task', 'task'],
  ['decision', 'decision'],
  ['finding', 'finding'],
  ['skill', 'skill'],
  ['file', 'file'],
  ['run', 'run'],
  ['model', 'model'],
];

/** File basename, decision id, run, finding id: the shortest name that is still unambiguous on this graph. */
export function shortLabel(n: GraphNode): string {
  if (n.type === 'file') return n.label.split('/').at(-1) ?? n.label;
  if (n.type === 'decision' || n.type === 'run') return n.id.split('/').at(-1) ?? n.label;
  if (n.type === 'finding') return n.id.split('#').at(-1) ?? n.label;
  if (n.type === 'task') return n.id.slice('task:'.length);
  return n.label;
}

const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type NodeState = 'on' | 'faded' | 'hidden';

/**
 * Which nodes stand at a moment (R-019): on when an edge of theirs is valid then; faded (35%) when every edge they
 * had by then has ended, as a superseded decision; hidden when nothing about them was recorded yet.
 */
export function stateAt(nodes: GraphNode[], edges: GraphEdge[], ts: number, centre: string): Map<string, NodeState> {
  const state = new Map<string, NodeState>(nodes.map((n) => [n.id, n.id === centre ? 'on' : 'hidden']));
  for (const e of edges) {
    const from = Date.parse(e.recordedAt);
    if (from > ts) continue;
    const valid = e.validTo === null || ts < Date.parse(e.validTo);
    for (const id of [e.from, e.to]) {
      if (valid) state.set(id, 'on');
      else if (state.get(id) === 'hidden') state.set(id, 'faded');
    }
  }
  return state;
}

function useLayout(graph: GraphData | null, centre: string): { pos: Map<string, { x: number; y: number }>; done: boolean } {
  const [layout, setLayout] = useState({ pos: new Map<string, { x: number; y: number }>(), done: false });
  useEffect(() => {
    if (!graph) return;
    setLayout((l) => ({ ...l, done: false }));
    const worker = new Worker(new URL('../graph.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<LayoutOut>) => setLayout({ pos: new Map(e.data.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), done: e.data.done });
    const msg: LayoutIn = { type: 'layout', nodes: graph.nodes.map((n) => ({ id: n.id, pinned: n.id === centre })), edges: graph.edges, width: W, height: H };
    worker.postMessage(msg);
    return () => worker.terminate();
  }, [graph, centre]);
  return layout;
}

function Graph({ graph, centre, ts, onOpenFile, onSelectNode }: { graph: GraphData; centre: string; ts: number; onOpenFile?: (path: string) => void; onSelectNode?: (node: GraphNode) => void }) {
  const { pos, done } = useLayout(graph, centre);
  const state = useMemo(() => stateAt(graph.nodes, graph.edges, ts, centre), [graph, ts, centre]);
  const firstEdge = useMemo(() => {
    const m = new Map<string, GraphEdge>();
    for (const e of [...graph.edges].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) for (const id of [e.from, e.to]) if (!m.has(id)) m.set(id, e);
    return m;
  }, [graph]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-md border border-line bg-sunken" role="group" aria-label="Memory graph" tabIndex={-1} data-testid="memory-graph" data-layout={done ? 'done' : 'running'}>
      {graph.edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const recorded = Date.parse(e.recordedAt) <= ts;
        const valid = recorded && (e.validTo === null || ts < Date.parse(e.validTo));
        if (!recorded) return null;
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-strong)" strokeWidth={1} opacity={valid ? 0.9 : 0.25} />;
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id);
        const s = state.get(n.id) ?? 'hidden';
        if (!p || s === 'hidden') return null;
        const first = firstEdge.get(n.id);
        const big = n.type === 'task' || n.type === 'decision' || n.type === 'skill';
        const labelled = big || n.type === 'finding' || n.type === 'file' || n.type === 'run';
        // a file opens in the diff; a decision or a run selects its place on the timeline (R-052)
        const activate = n.type === 'file' && onOpenFile ? () => onOpenFile(n.label) : (n.type === 'decision' || n.type === 'run') && onSelectNode ? () => onSelectNode(n) : undefined;
        const fadedNote = s === 'faded' ? ', no longer in force' : '';
        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            opacity={s === 'faded' ? 0.35 : 1}
            data-node={n.id}
            data-state={s}
            className={cx(activate && 'cursor-pointer')}
            onClick={activate}
            {...(activate
              ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  'aria-label': n.type === 'file' ? `Open ${n.label} in the diff` : n.type === 'decision' ? `Show ${shortLabel(n)} on the timeline` : `Show run ${shortLabel(n)} on the timeline`,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activate();
                    }
                  },
                }
              : {})}
          >
            <title>{`${n.label}${first ? `, recorded at ${at(first.recordedAt)} by event ${first.eventId}` : ''}${fadedNote}`}</title>
            <circle r={n.id === centre ? 8 : big ? 6 : 4} fill={COLOUR[n.type] ?? 'var(--ink-faint)'} stroke="var(--surface)" strokeWidth={1.5} />
            {labelled ? (
              <text x={p.x > W - 110 ? -9 : 9} y={4} textAnchor={p.x > W - 110 ? 'end' : 'start'} fontSize={n.type === 'file' ? 9 : 10} fill="var(--ink)" className="tabular select-none">
                {shortLabel(n)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

const QUERY_TABS = [
  ['similar', 'Similar'],
  ['travels', 'Travels with'],
  ['constrains', 'Constrains'],
] as const;
type QueryTab = (typeof QUERY_TABS)[number][0];

type SimilarRow = { task: string; score: number; evidence: { files: string[]; themes: string[]; tags: string[] } };
type ConstrainsRow = { kind: 'decision' | 'finding'; id: string; task: string; text: string; files: string[] };

function Queries({ id, graph, asOf }: { id: string; graph: GraphData; asOf: string | null }) {
  const [tab, setTab] = useState<QueryTab>('similar');
  const [loaded, setLoaded] = useState<{ tab: QueryTab; rows: unknown[] } | null>(null);
  // rows belong to the tab that asked for them; a switch shows nothing until its own rows arrive
  const rows = loaded?.tab === tab ? loaded.rows : null;
  const { data: cards } = useTasks();
  const title = (t: string) => cards?.find((c) => c.task.id === t)?.task.title ?? t;
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (tab === 'similar') return api.graphQuery<SimilarRow>({ q: 'similar', task: id });
      if (tab === 'constrains') return api.graphQuery<ConstrainsRow>({ q: 'constrains', task: id, ...(asOf ? { asOf } : {}) });
      // the files this task touched, and what changes alongside each
      const mine = graph.edges.filter((e) => e.type === 'touches' && e.from.startsWith(`run:${id}/`)).map((e) => e.to.slice('file:'.length));
      const counts = new Map<string, number>();
      for (const path of [...new Set(mine)].slice(0, 6)) {
        for (const r of await api.graphQuery<{ path: string; count: number }>({ q: 'files-together', path })) if (!mine.includes(r.path)) counts.set(r.path, (counts.get(r.path) ?? 0) + r.count);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([path, count]) => ({ path, count }));
    };
    load()
      .then((r) => live && setLoaded({ tab, rows: r }))
      .catch(() => live && setLoaded({ tab, rows: [] }));
    return () => {
      live = false;
    };
  }, [tab, id, graph, asOf]);

  return (
    <div className="mt-4">
      <div role="tablist" className="flex gap-1 border-b border-line mb-2">
        {QUERY_TABS.map(([k, name]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`memory-tab-${k}`}
            onClick={() => setTab(k)}
            className={cx('h-7 px-2 -mb-px border-b-2 text-[12px]', tab === k ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}
          >
            {name}
          </button>
        ))}
      </div>
      {rows === null ? <p className="text-faint text-[12px] py-2">Reading the graph.</p> : null}
      {rows?.length === 0 ? (
        <p className="text-faint text-[12px] py-2">
          {tab === 'similar' ? 'No earlier task shares files, findings or tags with this one.' : tab === 'constrains' ? 'No decision or open finding applies to these files.' : 'These files have not changed alongside others yet.'}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2" data-testid={`memory-rows-${tab}`}>
        {tab === 'similar'
          ? (rows as SimilarRow[] | null)?.map((r) => (
              <li key={r.task} className="text-[12px]">
                <Link to={`/t/${r.task}`} className="font-medium text-ink hover:text-accent">
                  {r.task} {title(r.task)}
                </Link>
                <p className="text-muted">
                  {[
                    r.evidence.files.length ? `shares ${r.evidence.files.join(', ')}` : null,
                    r.evidence.themes.length ? `same findings on ${r.evidence.themes.slice(0, 3).join(', ')}` : null,
                    r.evidence.tags.length ? `tagged ${r.evidence.tags.join(', ')}` : null,
                  ]
                    .filter(Boolean)
                    .join('; ')}
                </p>
              </li>
            ))
          : null}
        {tab === 'constrains'
          ? (rows as ConstrainsRow[] | null)?.map((r) => (
              <li key={`${r.task}-${r.id}`} className="text-[12px]">
                <span className={cx('font-medium', r.kind === 'decision' ? 'text-warn' : 'text-bad')}>
                  {r.id}
                  {r.task !== id ? ` (${r.task})` : ''}
                </span>{' '}
                <span className="text-ink">{r.text}</span>
                <p className="text-faint">{r.files.slice(0, 3).join(', ')}{r.files.length > 3 ? `, ${r.files.length - 3} more` : ''}</p>
              </li>
            ))
          : null}
        {tab === 'travels'
          ? (rows as Array<{ path: string; count: number }> | null)?.map((r) => (
              <li key={r.path} className="text-[12px] flex justify-between gap-2">
                <span className="font-mono text-ink truncate">{r.path}</span>
                <span className="tabular text-muted shrink-0">{r.count === 1 ? 'once' : `${r.count} times`}</span>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}

/** A skill the learn step proposed: nothing is written to .agents/skills until a person approves it. */
function SkillProposal({ s, onDecided }: { s: SkillRecord; onDecided: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(onDecided)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <li className="rounded-md border border-good/40 bg-good-tint p-3 text-[12px]" data-testid="queue-skill" data-skill={s.id}>
      <p className="text-muted mb-1">
        The learn step proposes a skill from {s.evidence.join(', ')}. Nothing is written until you approve it.
      </p>
      <Link to={`/skills?skill=${s.id}`} className="font-mono font-medium text-ink hover:text-accent">
        {s.id}
      </Link>
      <p className="text-ink mb-2">{s.description}</p>
      {s.eval ? <p className="tabular text-muted mb-2">{s.eval.card}</p> : null}
      {rejecting ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.rejectSkill(s.id, reason));
          }}
        >
          <input required value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Why reject ${s.id}`} placeholder="Why not?" className="flex-1 min-w-0 h-7 rounded-md border border-line bg-surface px-2" />
          <Button className="h-7" tone="danger" type="submit" disabled={busy}>
            Reject
          </Button>
          <Button className="h-7" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button className="h-7" tone="primary" disabled={busy} onClick={() => act(() => api.approveSkill(s.id))}>
            Approve and commit
          </Button>
          <Button className="h-7" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
      {error ? <p className="mt-2 text-bad">{error}</p> : null}
    </li>
  );
}

/** Contradictions and proposed skills wait here for a person: a reviewer may not reverse a decision, nor the learn step write a skill, on its own. */
export function Queue({ only, onSettled }: { only?: string; onSettled?: () => void }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [permissions, setPermissions] = useState<PendingPermission[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .pending()
      .then((p) => setItems(only ? p.filter((x) => x.task === only) : p))
      .catch(() => setItems([]));
    api
      .permissions()
      .then((p) => setPermissions(only ? p.filter((x) => x.task === only) : p))
      .catch(() => setPermissions([]));
    api
      .skills()
      .then((s) => setSkills(s.filter((x) => x.status === 'proposed' && (!only || x.evidence.some((e) => e.startsWith(`${only}/`))))))
      .catch(() => setSkills([]));
  }, [only]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  if ((!items || items.length === 0) && permissions.length === 0 && skills.length === 0) return null;
  // the queue carries contradictions, rename merges and skill proposals (R-052); proposals render from the skills list below, which carries their evidence
  const contradictions = (items ?? []).filter((p) => p.kind === 'contradiction');
  const renames = (items ?? []).filter((p) => p.kind === 'rename-merge');
  const settle = (name: string, action: 'keep' | 'supersede') => {
    setBusy(name);
    api
      .settle(name, action)
      .then(() => {
        load();
        onSettled?.();
      })
      .finally(() => setBusy(null));
  };
  return (
    <section className="mb-4" aria-label="Waiting for you" data-testid="queue">
      <h3 className="text-[12px] font-semibold text-warn mb-2">Waiting for you</h3>
      <ul className="flex flex-col gap-2">
        <PermissionRows permissions={permissions} onDecided={load} />
        {contradictions.map((p) => (
          <li key={p.id} className="rounded-md border border-warn/40 bg-warn-tint p-3 text-[12px]" data-testid="queue-row">
            <p className="text-muted mb-2">
              {modelName(p.agent)}'s review of {p.task} would reverse {p.decision?.id ?? 'a decision'}. It is not applied until you decide.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <p className="font-medium text-ink">{p.decision?.id ?? 'Decision'}</p>
                <p className="text-ink">{p.decision?.text ?? 'Not found in decisions.md'}</p>
              </div>
              <div>
                <p className="font-medium text-ink">{p.finding.id}</p>
                <p className="text-ink">{p.finding.text}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="h-7" disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
                Keep {p.decision?.id ?? 'it'}
              </Button>
              <Button className="h-7" disabled={busy === p.id || !p.decision} onClick={() => settle(p.id, 'supersede')}>
                Supersede {p.decision?.id ?? ''}
              </Button>
            </div>
          </li>
        ))}
        {renames.map((p) => (
          <li key={p.id} className="rounded-md border border-line bg-raised p-3 text-[12px]" data-testid="queue-rename">
            <p className="text-muted mb-1">The merge of {p.task} renamed a file other work touches by its old name, so the memory graph has it twice until you note it.</p>
            <p className="font-mono text-ink mb-2">
              {p.from} is now {p.to}
            </p>
            <Button className="h-7" disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
              Note it as the same file
            </Button>
          </li>
        ))}
        {skills.map((s) => (
          <SkillProposal
            key={s.id}
            s={s}
            onDecided={() => {
              load();
              onSettled?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

export function MemoryPanel({ id, asOf, setAsOf, onOpenFile, version }: { id: string; asOf: string | null; setAsOf: (v: string | null) => void; onOpenFile: (path: string) => void; version: number }) {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    api
      .graph(id)
      .then((g) => {
        setGraph(g);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, version]);
  const range = useMemo(() => {
    if (!graph || graph.edges.length === 0) return null;
    const times = graph.edges.map((e) => Date.parse(e.recordedAt));
    return { from: Math.min(...times), to: Math.max(...times) };
  }, [graph]);
  const [draft, setDraft] = useState<number | null>(null);
  const ts = draft ?? (asOf ? Date.parse(asOf) : (range?.to ?? Date.now()));
  const centre = `task:${id}`;

  // A decision opens its decision.recorded row; a run opens its segment, both through the ev the rail reads (R-052).
  const openNode = useCallback(
    async (n: GraphNode) => {
      const task = typeof n.data.task === 'string' ? n.data.task : id;
      const events = await api.events(task).catch(() => []);
      const select = (seq: number) => {
        if (task === id) {
          setParams(
            (p) => {
              const next = new URLSearchParams(p);
              next.set('ev', String(seq));
              return next;
            },
            { replace: true },
          );
        } else navigate(`/t/${task}?ev=${seq}`);
      };
      if (n.type === 'decision') {
        const decision = typeof n.data.decision === 'string' ? n.data.decision : shortLabel(n);
        const ev = events.find((e) => e.type === 'decision.recorded' && e.payload.id === decision);
        if (ev) select(ev.seq);
      } else if (n.type === 'run') {
        const run = typeof n.data.run === 'string' ? n.data.run : shortLabel(n);
        const ev = events.find((e) => e.type === 'run.started' && e.run === run);
        if (ev) select(ev.seq);
        if (task === id) setTimeout(() => document.querySelector(`[data-testid="run-segment"][data-run="${run}"]`)?.scrollIntoView({ block: 'nearest' }), 60);
      }
    },
    [id, navigate, setParams],
  );

  return (
    <aside className="h-full overflow-y-auto p-4 border-l border-line" aria-label="Memory" data-testid="memory-panel">
      <h2 className="text-[13px] font-semibold mb-3">Memory</h2>
      <Queue />
      {error ? <EmptyState testId="empty-memory">The memory graph could not be read: {error}</EmptyState> : null}
      {!error && graph && graph.nodes.length <= 1 ? (
        <EmptyState testId="empty-memory">Similar past tasks, the decisions that constrain this task and the files that change together appear here once a run has touched something.</EmptyState>
      ) : null}
      {graph && graph.nodes.length > 1 && range ? (
        <>
          <Graph graph={graph} centre={centre} ts={ts} onOpenFile={onOpenFile} onSelectNode={(n) => void openNode(n)} />
          {graph.total > graph.nodes.length ? (
            <p className="mt-1 text-[11px] text-faint tabular" data-testid="memory-count">
              {graph.nodes.length} of {graph.total} nodes, the closest to this task
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-muted">
            {TYPE_NAMES.map(([t, name]) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COLOUR[t] }} />
                {name}
              </span>
            ))}
          </div>
          <div className="mt-3">
            <label className="flex items-center justify-between text-[12px] text-muted mb-1" htmlFor="memory-scrubber">
              <span>
                As of <span className="tabular text-ink" data-testid="memory-asof">{at(new Date(ts).toISOString())}</span>
              </span>
              <Button className="h-6 px-2 text-[11px]" disabled={!asOf && draft === null} onClick={() => { setDraft(null); setAsOf(null); }}>
                Now
              </Button>
            </label>
            <input
              id="memory-scrubber"
              data-testid="memory-scrubber"
              type="range"
              min={range.from}
              max={range.to}
              step={Math.max(1, Math.round((range.to - range.from) / 400))}
              value={Math.min(range.to, Math.max(range.from, ts))}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDraft(v);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => setAsOf(v >= range.to ? null : new Date(v).toISOString()), 100);
              }}
              className="w-full accent-[var(--accent)]"
            />
          </div>
          <Queries id={id} graph={graph} asOf={asOf} />
        </>
      ) : null}
    </aside>
  );
}

/** The same graph and scrubber over the whole workspace, for the Factory view (R-052). */
export function WorkspaceMemory() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    api
      .workspaceGraph()
      .then((g) => {
        setGraph(g);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const range = useMemo(() => {
    if (!graph || graph.edges.length === 0) return null;
    const times = graph.edges.map((e) => Date.parse(e.recordedAt));
    return { from: Math.min(...times), to: Math.max(...times) };
  }, [graph]);
  const ts = draft ?? range?.to ?? Date.now();
  const centre = graph?.nodes.find((n) => n.type === 'task')?.id ?? '';
  if (error) return <EmptyState testId="factory-memory">The memory graph could not be read: {error}</EmptyState>;
  if (!graph || graph.nodes.length <= 1 || !range) {
    return <EmptyState testId="factory-memory">The memory graph of the whole workspace appears here once a run has touched something.</EmptyState>;
  }
  return (
    <div data-testid="factory-memory">
      <Graph graph={graph} centre={centre} ts={ts} />
      {graph.total > graph.nodes.length ? (
        <p className="mt-1 text-[11px] text-faint tabular">
          {graph.nodes.length} of {graph.total} nodes, the most connected
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-muted">
        {TYPE_NAMES.map(([t, name]) => (
          <span key={t} className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: COLOUR[t] }} />
            {name}
          </span>
        ))}
      </div>
      <div className="mt-3">
        <label className="flex items-center justify-between text-[12px] text-muted mb-1" htmlFor="factory-memory-scrubber">
          <span>
            As of{' '}
            <span className="tabular text-ink" data-testid="factory-memory-asof">
              {at(new Date(ts).toISOString())}
            </span>
          </span>
          <Button className="h-6 px-2 text-[11px]" disabled={draft === null} onClick={() => setDraft(null)}>
            Now
          </Button>
        </label>
        <input
          id="factory-memory-scrubber"
          data-testid="factory-memory-scrubber"
          type="range"
          min={range.from}
          max={range.to}
          step={Math.max(1, Math.round((range.to - range.from) / 400))}
          value={Math.min(range.to, Math.max(range.from, ts))}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </div>
    </div>
  );
}
