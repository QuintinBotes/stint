import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { agentOf, carNumber, markColor, modelName } from '../agents';
import { type GraphData, type GraphEdge, type GraphNode, type PendingItem, type PendingPermission, type SkillRecord, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { PermissionRows } from './Permissions';
import type { LayoutIn, LayoutOut } from '../graph.worker';
import { useTasks, useWidth } from '../hooks';
import { Button, EmptyState, cx } from './ui';

// the graph lays out in the pixels it is drawn at, so its text is the same size on the task view and the Standings
const W = 328;
const H = 260;

// the design's memory colours: cars on the plate, decisions yellow, what was learned purple, findings red, stints blue
const COLOUR: Record<string, string> = {
  task: 'var(--plate)',
  decision: 'var(--yellow)',
  skill: 'var(--purple)',
  finding: 'var(--red)',
  outcome: 'var(--green)',
  merge: 'var(--green)',
  model: 'var(--ink-2)',
  rule: 'var(--yellow)',
  file: 'var(--ink-3)',
  run: 'var(--meta)',
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);
/** A stint wears its driver's team livery; every other node takes its type's colour. */
const fill = (n: GraphNode) => (n.type === 'run' ? markColor[agentOf(str(n.data.adapter), str(n.data.host), str(n.data.model)).mark] : (COLOUR[n.type] ?? 'var(--ink-3)'));
const TYPE_NAMES: Array<[string, string]> = [
  ['task', 'car'],
  ['decision', 'decision'],
  ['finding', 'finding'],
  ['skill', 'learned skill'],
  ['file', 'file'],
  ['run', 'stint, in its team livery'],
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

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// skills first after the centre: there are few, and what the factory learned is what the panel is for
const LABEL_RANK = ['skill', 'task', 'decision', 'finding', 'run', 'file'];

type LabelSpot = { dx: number; dy: number; anchor: 'start' | 'middle' | 'end' };

/**
 * Where each label goes: beside its node, above or below it, or on a diagonal, else nowhere. Higher-ranked nodes go first, so a
 * crowded graph keeps the labels that matter legible; a node without a label still names itself in its tooltip.
 */
export function placeLabels(nodes: Array<{ id: string; x: number; y: number; r: number; text?: string; size: number; rank: number }>, width: number, height: number): Map<string, LabelSpot> {
  const dots: Box[] = nodes.map((n) => ({ x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r }));
  const placed: Box[] = [];
  const spots = new Map<string, LabelSpot>();
  for (const n of [...nodes].sort((a, b) => a.rank - b.rank)) {
    if (!n.text) continue;
    // a generous box: the font's full ascent and descent, and a wide average glyph
    const w = n.text.length * n.size * 0.62;
    const candidates: LabelSpot[] = [
      { dx: 9, dy: 4, anchor: 'start' },
      { dx: -9, dy: 4, anchor: 'end' },
      { dx: 0, dy: -(n.r + 3), anchor: 'middle' },
      { dx: 0, dy: n.r + n.size, anchor: 'middle' },
      { dx: 6, dy: -(n.r + 3), anchor: 'start' },
      { dx: -6, dy: -(n.r + 3), anchor: 'end' },
      { dx: 6, dy: n.r + n.size, anchor: 'start' },
      { dx: -6, dy: n.r + n.size, anchor: 'end' },
    ];
    for (const spot of candidates) {
      const left = n.x + spot.dx - (spot.anchor === 'start' ? 0 : spot.anchor === 'middle' ? w / 2 : w);
      const box = { x0: left, y0: n.y + spot.dy - n.size, x1: left + w, y1: n.y + spot.dy + n.size * 0.3 };
      if (box.x0 < 0 || box.x1 > width || box.y0 < 0 || box.y1 > height) continue;
      // the centre and the skills are what the graph is about: their labels may cover a neighbour's dot, never a label
      if (placed.some((t) => overlaps(t, box)) || (n.rank > 0 && dots.some((t) => overlaps(t, box)))) continue;
      placed.push(box);
      spots.set(n.id, spot);
      break;
    }
  }
  return spots;
}

/** A finding citing the decision it was checked against: the line the stewards are asked about. */
const cites = (e: GraphEdge) => e.type === 'links_to' && typeof e.data.decision === 'string';

const radius = (n: GraphNode, centre: string) => (n.id === centre ? 8 : n.type === 'task' || n.type === 'decision' || n.type === 'skill' ? 6 : 4);

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

function useLayout(graph: GraphData | null, centre: string, width: number, height: number): { pos: Map<string, { x: number; y: number }>; done: boolean } {
  const [layout, setLayout] = useState({ pos: new Map<string, { x: number; y: number }>(), done: false });
  // one worker for the graph's life: a new size or graph is a new message, never a worker torn down while it loads
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    const w = new Worker(new URL('../graph.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<LayoutOut>) => {
      if (e.data.seq === latest.current) setLayout({ pos: new Map(e.data.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), done: e.data.done });
    };
    worker.current = w;
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (!graph || !worker.current) return;
    setLayout((l) => ({ ...l, done: false }));
    latest.current += 1;
    const msg: LayoutIn = { type: 'layout', seq: latest.current, nodes: graph.nodes.map((n) => ({ id: n.id, pinned: n.id === centre })), edges: graph.edges, width, height };
    worker.current.postMessage(msg);
  }, [graph, centre, width, height]);
  return layout;
}

function Graph({ graph, centre, ts, height = H, onOpenFile, onSelectNode }: { graph: GraphData; centre: string; ts: number; height?: number; onOpenFile?: (path: string) => void; onSelectNode?: (node: GraphNode) => void }) {
  const { ref: measure, width: measured } = useWidth<HTMLDivElement>(W);
  // whole steps of 8 px, so a resize re-lays the graph out only when it changes enough to matter
  const width = Math.max(240, Math.round(measured / 8) * 8);
  const { pos, done } = useLayout(graph, centre, width, height);
  const state = useMemo(() => stateAt(graph.nodes, graph.edges, ts, centre), [graph, ts, centre]);
  const labels = useMemo(
    () =>
      placeLabels(
        graph.nodes.flatMap((n) => {
          const p = pos.get(n.id);
          if (!p || (state.get(n.id) ?? 'hidden') === 'hidden') return [];
          const rank = n.id === centre ? -1 : LABEL_RANK.indexOf(n.type);
          return [{ id: n.id, x: p.x, y: p.y, r: radius(n, centre), size: 12, rank: rank < 0 && n.id !== centre ? LABEL_RANK.length : rank, ...(LABEL_RANK.includes(n.type) ? { text: shortLabel(n) } : {}) }];
        }),
        width,
        height,
      ),
    [graph, pos, state, centre, width, height],
  );
  const firstEdge = useMemo(() => {
    const m = new Map<string, GraphEdge>();
    for (const e of [...graph.edges].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) for (const id of [e.from, e.to]) if (!m.has(id)) m.set(id, e);
    return m;
  }, [graph]);
  return (
    <div ref={measure}>
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full h-auto rounded-[4px] border border-rule bg-panel" role="group" aria-label="Memory graph" tabIndex={-1} data-testid="memory-graph" data-layout={done ? 'done' : 'running'}>
      {graph.edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const recorded = Date.parse(e.recordedAt) <= ts;
        const valid = recorded && (e.validTo === null || ts < Date.parse(e.validTo));
        if (!recorded) return null;
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={cites(e) ? 'var(--yellow)' : 'var(--rule-strong)'} strokeWidth={cites(e) ? 1.5 : 1} strokeDasharray={cites(e) ? '4 3' : undefined} opacity={valid ? 0.9 : 0.25} />;
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id);
        const s = state.get(n.id) ?? 'hidden';
        if (!p || s === 'hidden') return null;
        const first = firstEdge.get(n.id);
        const spot = labels.get(n.id);
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
            <circle r={radius(n, centre)} fill={fill(n)} stroke="var(--panel)" strokeWidth={1.5} />
            {spot ? (
              <text x={spot.dx} y={spot.dy} textAnchor={spot.anchor} fontSize={12} fill="var(--ink)" className="tabular select-none">
                {shortLabel(n)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
    </div>
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
      <h3 className="text-[14px] font-bold stretch-112 mb-2">Ask the memory</h3>
      <div role="tablist" aria-label="Ask the memory" className="flex gap-4 border-b border-rule mb-2">
        {QUERY_TABS.map(([k, name]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            data-testid={`memory-tab-${k}`}
            onClick={() => setTab(k)}
            className={cx('pb-1 -mb-px border-b-[3px] text-[14px]', tab === k ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {name}
          </button>
        ))}
      </div>
      {rows === null ? <p className="text-ink-3 text-[12px] py-2">Reading the graph.</p> : null}
      {rows?.length === 0 ? (
        <p className="text-ink-3 text-[12px] py-2">
          {tab === 'similar' ? 'No earlier task shares files, findings or tags with this one.' : tab === 'constrains' ? 'No decision or open finding applies to these files.' : 'These files have not changed alongside others yet.'}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2" data-testid={`memory-rows-${tab}`}>
        {tab === 'similar'
          ? (rows as SimilarRow[] | null)?.map((r) => (
              <li key={r.task} className="text-[12px]">
                <Link to={`/t/${r.task}`} className="font-bold text-ink underline-offset-2 hover:underline">
                  {r.task} {title(r.task)}
                </Link>
                <p className="text-ink-2">
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
                <span className={cx('font-mono font-bold', r.kind === 'decision' ? 'text-yellow' : 'text-red')}>
                  {r.id}
                  {r.task !== id ? ` (${r.task})` : ''}
                </span>{' '}
                <span className="text-ink">{r.text}</span>
                <p className="text-ink-3">{r.files.slice(0, 3).join(', ')}{r.files.length > 3 ? `, ${r.files.length - 3} more` : ''}</p>
              </li>
            ))
          : null}
        {tab === 'travels'
          ? (rows as Array<{ path: string; count: number }> | null)?.map((r) => (
              <li key={r.path} className="text-[12px] flex justify-between gap-2">
                <span className="font-mono text-ink truncate">{r.path}</span>
                <span className="tabular text-ink-2 shrink-0">{r.count === 1 ? 'once' : `${r.count} times`}</span>
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
      .catch((e: unknown) => setError(daemonMessage(e)))
      .finally(() => setBusy(false));
  };
  return (
    <li className="border-t-2 border-purple bg-purple-tint px-3 py-3 text-[14px]" data-testid="queue-skill" data-skill={s.id}>
      <p className="text-ink-2 mb-1">
        The learn step proposes a skill from {s.evidence.join(', ')}. Nothing is written until you approve it.
      </p>
      <Link to={`/skills?skill=${s.id}`} className="font-mono font-bold text-ink underline-offset-2 hover:underline">
        {s.id}
      </Link>
      <p className="text-ink mb-2">{s.description}</p>
      {s.eval ? <p className="tabular text-ink-2 mb-2">{s.eval.card}</p> : null}
      {rejecting ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.rejectSkill(s.id, reason));
          }}
        >
          <input required value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Why reject ${s.id}`} placeholder="Why not?" className="flex-1 min-w-0 h-7 rounded-[3px] border border-rule-strong bg-ground px-2 text-ink" />
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
      {error ? <p className="mt-2 text-red">{error}</p> : null}
    </li>
  );
}

/**
 * Contradictions and proposed skills wait here for a person: a reviewer may not reverse a decision, nor the learn step write a
 * skill, on its own. On a task view the stewards beside the gate take that task's contradictions, and the memory panel the rest.
 */
export function Queue({ only, stewardsOf, exceptStewardsOf, onSettled }: { only?: string; stewardsOf?: string; exceptStewardsOf?: string; onSettled?: () => void }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [permissions, setPermissions] = useState<PendingPermission[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    const mine = (x: PendingItem) => x.kind === 'contradiction' && x.task === stewardsOf;
    const theirs = (x: PendingItem) => x.kind === 'contradiction' && x.task === exceptStewardsOf;
    api
      .pending()
      .then((p) => setItems(p.filter((x) => (!only || x.task === only) && (stewardsOf ? mine(x) : !theirs(x)))))
      .catch(() => setItems([]));
    // the stewards settle contradictions only; permissions and proposed skills wait in the memory panel
    if (stewardsOf) return;
    api
      .permissions()
      .then((p) => setPermissions(only ? p.filter((x) => x.task === only) : p))
      .catch(() => setPermissions([]));
    api
      .skills()
      .then((s) => setSkills(s.filter((x) => x.status === 'proposed' && (!only || x.evidence.some((e) => e.startsWith(`${only}/`))))))
      .catch(() => setSkills([]));
  }, [only, stewardsOf, exceptStewardsOf]);
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
      .catch((e: unknown) => toast.error(`${action === 'keep' ? 'Not kept' : 'Not superseded'}: ${daemonMessage(e)}`))
      .finally(() => setBusy(null));
  };
  return (
    <section className="mb-4" aria-label={stewardsOf ? 'Stewards' : 'Waiting for you'} data-testid={stewardsOf ? 'stewards' : 'queue'}>
      {stewardsOf ? (
        <h2 className="text-[14px] leading-5 font-bold mb-2">Stewards</h2>
      ) : (
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-yellow mb-2">
          <span aria-hidden="true" className="sw" style={{ background: 'var(--sw-yellow)' }} />
          Waiting for you
        </h2>
      )}
      <ul className="flex flex-col gap-3">
        <PermissionRows permissions={permissions} onDecided={load} />
        {contradictions.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 border-t-2 border-yellow pt-2 text-[14px] leading-5" data-testid="queue-row">
            <p className="text-ink">
              {modelName(p.agent)}'s review of {p.task} would reverse {p.decision?.id ?? 'a decision'}. It is not applied until you decide.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="font-mono font-bold text-yellow">{p.decision?.id ?? 'Decision'}</p>
                <p className="text-ink">{p.decision?.text ?? 'Not found in decisions.md'}</p>
              </div>
              <div className="min-w-0">
                <p className="font-mono font-bold text-ink">{p.finding.id}</p>
                <p className="text-ink">{p.finding.text}</p>
              </div>
            </div>
            <p className="text-ink-2">A finding never overrules a decision. {p.decision?.id ?? 'The decision'} stands until you choose.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
                Keep {p.decision?.id ?? 'it'}
              </Button>
              <Button disabled={busy === p.id || !p.decision} onClick={() => settle(p.id, 'supersede')}>
                Supersede {p.decision?.id ?? ''}
              </Button>
            </div>
          </li>
        ))}
        {renames.map((p) => (
          <li key={p.id} className="border-t border-rule pt-2 text-[14px]" data-testid="queue-rename">
            <p className="text-ink-2 mb-1">The merge of {p.task} renamed a file other work touches by its old name, so the memory graph has it twice until you note it.</p>
            <p className="font-mono text-ink mb-2">
              {p.from} is now {p.to}
            </p>
            <Button disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
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

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {TYPE_NAMES.map(([t, name]) => (
        <span key={t} className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: COLOUR[t] }} />
          {name}
        </span>
      ))}
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed border-yellow" />
        a finding that cites a decision
      </span>
      <span>Faint means no longer in force at this moment.</span>
    </div>
  );
}

/** The clock, its reading and the way back to now: `id` and `testIds` name the scrubber for the page it is on. */
function Clock({ id, range, ts, label, onChange, onNow, nowDisabled, scrubberTestId, asOfTestId }: { id: string; range: { from: number; to: number }; ts: number; label: string; onChange: (v: number) => void; onNow: () => void; nowDisabled: boolean; scrubberTestId: string; asOfTestId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={id} className="text-[12px] text-ink-2 shrink-0">
        Race clock
      </label>
      <input
        id={id}
        data-testid={scrubberTestId}
        type="range"
        min={range.from}
        max={range.to}
        step={Math.max(1, Math.round((range.to - range.from) / 400))}
        value={Math.min(range.to, Math.max(range.from, ts))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-[140px]"
      />
      <span className="tabular text-[14px] font-extrabold stretch-87 min-w-[70px] text-right" data-testid={asOfTestId}>
        {label}
      </span>
      <Button className="h-7" tone={nowDisabled ? 'quiet' : 'primary'} disabled={nowDisabled} onClick={onNow}>
        Now
      </Button>
    </div>
  );
}

/**
 * What the car knows, on the task view's own clock: the stint chart sets the moment (asOf), and the graph, the queries
 * and the queue answer for it. No second clock here, so one drag rewinds the whole view.
 */
export function MemoryPanel({ id, asOf, onOpenFile, version, clock }: { id: string; asOf: string | null; onOpenFile: (path: string) => void; version: number; clock?: (ms: number) => string }) {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const ts = asOf ? Date.parse(asOf) : (range?.to ?? Date.now());
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
    <section className="flex flex-col gap-3" aria-label="Memory" data-testid="memory-panel" id="memory">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
        <div className="min-w-0 flex flex-col gap-2">
          {error ? <EmptyState testId="empty-memory">The memory graph could not be read: {error}. Reload the page; if it stays, check the daemon log.</EmptyState> : null}
          {!error && graph && graph.nodes.length <= 1 ? (
            <EmptyState testId="empty-memory">Similar past tasks, the decisions that constrain this task and the files that change together appear here once a run has touched something.</EmptyState>
          ) : null}
          {graph && graph.nodes.length > 1 && range ? (
            <>
              <p className="text-[12px] text-ink-2">
                What car {carNumber(id)} knew {asOf ? 'at ' : 'by '}
                <span className="tabular font-bold text-ink" data-testid="memory-asof">
                  {clock ? clock(ts) : at(new Date(ts).toISOString())}
                </span>
                {asOf ? '' : ', now'}. Move the stint chart's clock to rewind it.
              </p>
              <Graph graph={graph} centre={centre} ts={ts} height={340} onOpenFile={onOpenFile} onSelectNode={(n) => void openNode(n)} />
              {graph.total > graph.nodes.length ? (
                <p className="text-[12px] text-ink-2 tabular" data-testid="memory-count">
                  {graph.nodes.length} of {graph.total} nodes, the closest to this task
                </p>
              ) : null}
              <Legend />
            </>
          ) : null}
        </div>
        <aside aria-label="Ask the memory" className="min-w-0">
          <Queue exceptStewardsOf={id} />
          {graph && graph.nodes.length > 1 && range ? <Queries id={id} graph={graph} asOf={asOf} /> : null}
        </aside>
      </div>
    </section>
  );
}

/** The same graph and scrubber over the whole workspace, for the Standings (R-052). */
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
  if (error) return <EmptyState testId="factory-memory">The memory graph could not be read: {error}. Reload the page; if it stays, check the daemon log.</EmptyState>;
  if (!graph || graph.nodes.length <= 1 || !range) {
    return <EmptyState testId="factory-memory">The memory graph of the whole workspace appears here once a run has touched something.</EmptyState>;
  }
  return (
    <div data-testid="factory-memory" className="flex flex-col gap-2">
      <Graph graph={graph} centre={centre} ts={ts} height={380} />
      {graph.total > graph.nodes.length ? (
        <p className="text-[12px] text-ink-3 tabular">
          {graph.nodes.length} of {graph.total} nodes, the most connected
        </p>
      ) : null}
      <Clock
        id="factory-memory-scrubber"
        range={range}
        ts={ts}
        label={at(new Date(ts).toISOString())}
        scrubberTestId="factory-memory-scrubber"
        asOfTestId="factory-memory-asof"
        nowDisabled={draft === null}
        onNow={() => setDraft(null)}
        onChange={(v) => setDraft(v)}
      />
      <Legend />
    </div>
  );
}
