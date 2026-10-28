import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { agentOf, markColor, modelName } from '../agents';
import { type GraphData, type GraphEdge, type GraphNode, type PendingItem, type PendingPermission, type SkillRecord, api, daemonMessage } from '../api';
import { toast } from 'sonner';
import { PermissionRows } from './Permissions';
import type { LayoutIn, LayoutOut } from '../graph.worker';
import { useTasks, useWidth } from '../hooks';
import { Button, EmptyState, StatusChip, cx, tabClass } from './ui';

// the graph lays out in the pixels it is drawn at, so its text is the same size on the task view and the Factory
const W = 328;
const H = 260;

// the design's memory inks: the task in ink, decisions in ink-2, findings amber (they wait for you), what was learned
// violet, files quiet, and each run in its vendor's ink
const COLOUR: Record<string, string> = {
  task: 'var(--ink)',
  decision: 'var(--ink-2)',
  skill: 'var(--violet)',
  finding: 'var(--amber)',
  outcome: 'var(--ink-2)',
  merge: 'var(--ink-2)',
  model: 'var(--ink-2)',
  rule: 'var(--ink-2)',
  file: 'var(--ink-3)',
  run: 'var(--meta)',
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);
/** A run takes its vendor's ink; every other node takes its type's ink. */
const fill = (n: GraphNode) => (n.type === 'run' ? markColor[agentOf(str(n.data.adapter), str(n.data.host), str(n.data.model)).mark] : (COLOUR[n.type] ?? 'var(--ink-3)'));
const TYPE_NAMES: Array<[string, string]> = [
  ['task', 'task'],
  ['decision', 'decision'],
  ['finding', 'finding'],
  ['skill', 'learned skill'],
  ['file', 'file'],
  ['run', "run, in its vendor's ink"],
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
export function placeLabels(nodes: Array<{ id: string; x: number; y: number; r: number; text?: string; size: number; rank: number }>, width: number, height: number, blocks: Box[] = []): Map<string, LabelSpot> {
  const dots: Box[] = nodes.map((n) => ({ x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r }));
  // the skill pills carry their own names: every label keeps off them
  const placed: Box[] = [...blocks];
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

/** A finding citing the decision it was checked against: the line a person is asked to decide. */
const cites = (e: GraphEdge) => e.type === 'links_to' && typeof e.data.decision === 'string';

const radius = (n: GraphNode, centre: string) => (n.id === centre ? 8 : n.type === 'task' || n.type === 'decision' || n.type === 'skill' ? 6 : 4);

const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Each standing skill as a pill with its name inside, 24 px tall with a 12 px radius, kept inside the graph. A pill that
 * would cover one placed before it stays a dot, and its name is placed beside it like any other label.
 */
export function skillPills(nodes: GraphNode[], pos: Map<string, { x: number; y: number }>, state: Map<string, NodeState>, width: number, height: number): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (n.type !== 'skill' || !p || (state.get(n.id) ?? 'hidden') === 'hidden') continue;
    const w = Math.min(width - 2, shortLabel(n).length * 12 * 0.62 + 16);
    const x0 = Math.min(width - 1 - w, Math.max(1, p.x - w / 2));
    const y0 = Math.min(height - 25, Math.max(1, p.y - 12));
    const box = { x0, y0, x1: x0 + w, y1: y0 + 24 };
    if (![...out.values()].some((b) => overlaps(b, box))) out.set(n.id, box);
  }
  return out;
}

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
  const pills = useMemo(() => skillPills(graph.nodes, pos, state, width, height), [graph, pos, state, width, height]);
  const labels = useMemo(
    () =>
      placeLabels(
        graph.nodes.flatMap((n) => {
          const p = pos.get(n.id);
          if (!p || (state.get(n.id) ?? 'hidden') === 'hidden') return [];
          const rank = n.id === centre ? -1 : LABEL_RANK.indexOf(n.type);
          // a skill drawn as a pill carries its name inside it
          const named = LABEL_RANK.includes(n.type) && !pills.has(n.id);
          return [{ id: n.id, x: p.x, y: p.y, r: radius(n, centre), size: 12, rank: rank < 0 && n.id !== centre ? LABEL_RANK.length : rank, ...(named ? { text: shortLabel(n) } : {}) }];
        }),
        width,
        height,
        [...pills.values()].map((b) => ({ x0: b.x0 - 2, y0: b.y0 - 2, x1: b.x1 + 2, y1: b.y1 + 2 })),
      ),
    [graph, pos, state, centre, width, height, pills],
  );
  const firstEdge = useMemo(() => {
    const m = new Map<string, GraphEdge>();
    for (const e of [...graph.edges].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) for (const id of [e.from, e.to]) if (!m.has(id)) m.set(id, e);
    return m;
  }, [graph]);
  return (
    <div ref={measure}>
    <svg viewBox={`0 0 ${width} ${height}`} className="block w-full h-auto rounded-[5px] border border-rule bg-panel" role="group" aria-label="Memory graph" tabIndex={-1} data-testid="memory-graph" data-layout={done ? 'done' : 'running'}>
      {graph.edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const recorded = Date.parse(e.recordedAt) <= ts;
        const valid = recorded && (e.validTo === null || ts < Date.parse(e.validTo));
        if (!recorded) return null;
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={cites(e) ? 'var(--amber)' : 'var(--rule-strong)'} strokeWidth={cites(e) ? 1.5 : 1} strokeDasharray={cites(e) ? '4 3' : undefined} opacity={valid ? 0.9 : 0.25} />;
      })}
      {/* skills last, so a pill and its name sit above the dots around it */}
      {[...graph.nodes].sort((a, b) => Number(pills.has(a.id)) - Number(pills.has(b.id))).map((n) => {
        const p = pos.get(n.id);
        const s = state.get(n.id) ?? 'hidden';
        if (!p || s === 'hidden') return null;
        const first = firstEdge.get(n.id);
        const spot = labels.get(n.id);
        const pill = pills.get(n.id);
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
            // a node that goes out of force at the moment the clock is on fades over 220 ms; no motion when less is asked for
            className={cx('transition-opacity duration-[220ms] ease-out motion-reduce:transition-none', activate && 'cursor-pointer')}
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
            {pill ? (
              <>
                {/* the wash is translucent: a panel fill under it keeps the edges behind from showing through the name */}
                <rect x={pill.x0 - p.x} y={pill.y0 - p.y} width={pill.x1 - pill.x0} height={pill.y1 - pill.y0} rx={12} fill="var(--panel)" />
                <rect x={pill.x0 - p.x} y={pill.y0 - p.y} width={pill.x1 - pill.x0} height={pill.y1 - pill.y0} rx={12} fill="var(--violet-wash)" stroke="var(--violet)" />
                <text x={(pill.x0 + pill.x1) / 2 - p.x} y={(pill.y0 + pill.y1) / 2 - p.y + 4} textAnchor="middle" fontSize={12} fill="var(--ink)" className="font-mono select-none">
                  {shortLabel(n)}
                </text>
              </>
            ) : (
              <circle r={radius(n, centre)} fill={fill(n)} stroke="var(--panel)" strokeWidth={1.5} />
            )}
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

  const row = 'flex flex-col gap-0.5 py-2 border-t border-rule first:border-t-0 text-small';
  return (
    <div>
      <h3 className="sr-only">Ask the memory</h3>
      <div role="tablist" aria-label="Ask the memory" className="flex flex-wrap border-b border-rule">
        {QUERY_TABS.map(([k, name]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`memory-tab-${k}`} onClick={() => setTab(k)} className={tabClass(tab === k)}>
            {name}
          </button>
        ))}
      </div>
      {rows === null ? <p className="text-ink-3 text-small py-2">Reading the graph.</p> : null}
      {rows?.length === 0 ? (
        <p className="text-ink-2 text-small py-2">
          {tab === 'similar' ? 'No earlier task shares files, findings or tags with this one. Similar tasks appear here as the workspace grows.' : tab === 'constrains' ? 'No decision or open finding applies to these files. Decisions that bind them appear here.' : 'These files have not changed alongside others yet. Files that change together appear here.'}
        </p>
      ) : null}
      <ul className="flex flex-col" data-testid={`memory-rows-${tab}`}>
        {tab === 'similar'
          ? (rows as SimilarRow[] | null)?.map((r) => (
              <li key={r.task} className={row}>
                <Link to={`/t/${r.task}`} className="font-semibold text-ink underline decoration-rule-strong hover:decoration-ink">
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
              <li key={`${r.task}-${r.id}`} className={row}>
                <p>
                  <span className={cx('font-mono font-semibold', r.kind === 'finding' && 'text-amber')}>
                    {r.id}
                    {r.task !== id ? ` (${r.task})` : ''}
                  </span>{' '}
                  <span className="text-ink">{r.text}</span>
                </p>
                <p className="font-mono text-ink-3 break-words">
                  {r.files.slice(0, 3).join(', ')}
                  {r.files.length > 3 ? `, ${r.files.length - 3} more` : ''}
                </p>
              </li>
            ))
          : null}
        {tab === 'travels'
          ? (rows as Array<{ path: string; count: number }> | null)?.map((r) => (
              <li key={r.path} className={cx(row, 'flex-row justify-between gap-3')}>
                <span className="font-mono text-ink truncate">{r.path}</span>
                <span className="tabular text-ink-3 shrink-0">{r.count === 1 ? 'once' : `${r.count} times`}</span>
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
    <li className="flex flex-col gap-1.5 rounded-[5px] border border-violet bg-violet-wash px-3 py-3 text-small" data-testid="queue-skill" data-skill={s.id}>
      <p className="text-ink-2">
        The learn step proposes a skill from {s.evidence.join(', ')}. Nothing is written until you approve it.
      </p>
      <Link to={`/skills?skill=${s.id}`} className="self-start font-mono font-semibold text-ink underline decoration-rule-strong hover:decoration-ink">
        {s.id}
      </Link>
      <p className="text-ink">{s.description}</p>
      {s.eval ? <p className="tabular text-ink-2">{s.eval.card}</p> : null}
      {rejecting ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.rejectSkill(s.id, reason));
          }}
        >
          <input required value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Why reject ${s.id}`} placeholder="Why not?" className="flex-1 min-w-0 h-8 rounded-[5px] border border-field bg-ground px-2.5 text-ink placeholder:text-ink-3" />
          <Button className="h-8 px-2.5 text-small" tone="danger" type="submit" disabled={busy}>
            Reject
          </Button>
          <Button className="h-8 px-2.5 text-small" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button className="h-8 px-2.5 text-small" tone="primary" disabled={busy} onClick={() => act(() => api.approveSkill(s.id))}>
            Approve and commit
          </Button>
          <Button className="h-8 px-2.5 text-small" disabled={busy} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
      {error ? <p className="text-red">{error}</p> : null}
    </li>
  );
}

/**
 * Contradictions and proposed skills wait here for a person: a reviewer may not reverse a decision, nor the learn step write a
 * skill, on its own. On a task view, "Decisions waiting for you" takes that task's contradictions (`decisionsOf`, testid
 * `task-decisions`), and the memory panel the rest. `empty` is the sentence shown when nothing waits; without it the queue hides.
 */
export function Queue({ only, decisionsOf, exceptDecisionsOf, onSettled, empty, level = 3 }: { only?: string; decisionsOf?: string; exceptDecisionsOf?: string; onSettled?: () => void; empty?: string; level?: 2 | 3 }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [permissions, setPermissions] = useState<PendingPermission[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    const mine = (x: PendingItem) => x.kind === 'contradiction' && x.task === decisionsOf;
    const theirs = (x: PendingItem) => x.kind === 'contradiction' && x.task === exceptDecisionsOf;
    api
      .pending()
      .then((p) => setItems(p.filter((x) => (!only || x.task === only) && (decisionsOf ? mine(x) : !theirs(x)))))
      .catch(() => setItems([]));
    // a task's own decisions are settled there; permissions and proposed skills wait in the memory panel
    if (decisionsOf) return;
    api
      .permissions()
      .then((p) => setPermissions(only ? p.filter((x) => x.task === only) : p))
      .catch(() => setPermissions([]));
    api
      .skills()
      .then((s) => setSkills(s.filter((x) => x.status === 'proposed' && (!only || x.evidence.some((e) => e.startsWith(`${only}/`))))))
      .catch(() => setSkills([]));
  }, [only, decisionsOf, exceptDecisionsOf]);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);
  const nothing = (!items || items.length === 0) && permissions.length === 0 && skills.length === 0;
  if (nothing && !empty) return null;
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
  const waiting = contradictions.length + renames.length + permissions.length + skills.length;
  const title = decisionsOf ? 'Decisions waiting for you' : 'Waiting for you';
  return (
    <section className="flex flex-col gap-2.5" aria-label={title} data-testid={decisionsOf ? 'task-decisions' : 'queue'}>
      <div className="flex items-baseline justify-between gap-3">
        {/* a page section on the Factory, a part of the memory column on a task */}
        {level === 2 ? <h2 className="text-section">{title}</h2> : <h3 className="font-semibold">{title}</h3>}
        {waiting ? <StatusChip label={`${waiting} open`} tone="warn" /> : null}
      </div>
      {nothing ? <p className="text-small text-ink-2">{empty}</p> : null}
      <ul className="flex flex-col gap-3">
        <PermissionRows permissions={permissions} onDecided={load} />
        {contradictions.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 text-small" data-testid="queue-row">
            <p className="text-ink">
              {modelName(p.agent)}'s review of {p.task} would reverse {p.decision?.id ?? 'a decision'}. It is not applied until you decide.
            </p>
            <div className="grid grid-cols-2 rounded-[5px] border border-rule-strong overflow-hidden">
              <div className="min-w-0 px-3 py-2.5">
                <p className="font-mono font-semibold">{p.decision?.id ?? 'Decision'}</p>
                <p className="mt-1 text-ink">{p.decision?.text ?? 'Not found in decisions.md'}</p>
              </div>
              <div className="min-w-0 px-3 py-2.5 border-l border-rule-strong">
                <p className="font-mono font-semibold text-amber">{p.finding.id}</p>
                <p className="mt-1 text-ink">{p.finding.text}</p>
              </div>
            </div>
            <p className="text-ink-2">A finding never overrules a decision. {p.decision?.id ?? 'The decision'} stands until you choose.</p>
            <div className="flex flex-wrap gap-2">
              <Button className="h-8 px-2.5 text-small" disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
                Keep {p.decision?.id ?? 'it'}
              </Button>
              <Button className="h-8 px-2.5 text-small" disabled={busy === p.id || !p.decision} onClick={() => settle(p.id, 'supersede')}>
                Supersede {p.decision?.id ?? ''}
              </Button>
            </div>
          </li>
        ))}
        {renames.map((p) => (
          <li key={p.id} className="flex flex-col gap-1.5 border-t border-rule pt-2 text-small" data-testid="queue-rename">
            <p className="text-ink-2">The merge of {p.task} renamed a file other work touches by its old name, so the memory graph has it twice until you note it.</p>
            <p className="font-mono text-ink break-words">
              {p.from} is now {p.to}
            </p>
            <Button className="self-start h-8 px-2.5 text-small" disabled={busy === p.id} onClick={() => settle(p.id, 'keep')}>
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
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2">
      {TYPE_NAMES.map(([t, name]) => (
        <span key={t} className="inline-flex items-center gap-2">
          {t === 'skill' ? (
            <span aria-hidden="true" className="inline-block w-4 h-2.5 rounded-[12px] border border-violet bg-violet-wash" />
          ) : (
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: COLOUR[t] }} />
          )}
          {name}
        </span>
      ))}
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed border-amber" />
        contradicts a decision, sent to you
      </span>
      <span>Faint: no longer in force at this moment.</span>
    </div>
  );
}

/** The clock, its reading and the way back to now: `id` and `testIds` name the scrubber for the page it is on. */
function Clock({ id, range, ts, label, onChange, onNow, nowDisabled, scrubberTestId, asOfTestId }: { id: string; range: { from: number; to: number }; ts: number; label: string; onChange: (v: number) => void; onNow: () => void; nowDisabled: boolean; scrubberTestId: string; asOfTestId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label htmlFor={id} className="text-small text-ink-2 shrink-0">
        As of
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
      <span className="font-mono text-code min-w-[70px] text-right" data-testid={asOfTestId}>
        {label}
      </span>
      <Button className="h-8 px-2.5 text-small" disabled={nowDisabled} onClick={onNow}>
        Now
      </Button>
    </div>
  );
}

/**
 * What the task knows, at the moment the task view shows (asOf, set by the one clock above it): the queue, the graph and
 * the queries all answer for that moment.
 */
export function MemoryPanel({ id, asOf, onOpenFile, version }: { id: string; asOf: string | null; onOpenFile: (path: string) => void; version: number }) {
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

  const ready = graph && graph.nodes.length > 1 && range;
  return (
    <section className="flex flex-col gap-5" aria-label="Memory graph and queries" data-testid="memory-panel" id="memory">
      <Queue exceptDecisionsOf={id} />
      {error ? <EmptyState testId="empty-memory">The memory graph could not be read: {error}. Reload the page; if it stays, check the daemon log.</EmptyState> : null}
      {!error && graph && graph.nodes.length <= 1 ? (
        <EmptyState testId="empty-memory">Similar past tasks, the decisions that constrain this task and the files that change together appear here once a run has touched something.</EmptyState>
      ) : null}
      {ready ? (
        <div className="flex flex-col gap-2">
          <Graph graph={graph} centre={centre} ts={ts} height={360} onOpenFile={onOpenFile} onSelectNode={(n) => void openNode(n)} />
          {graph.total > graph.nodes.length ? (
            <p className="text-small text-ink-2 tabular" data-testid="memory-count">
              {graph.nodes.length} of {graph.total} nodes, the closest to this task
            </p>
          ) : null}
          <Legend />
        </div>
      ) : null}
      {ready ? <Queries id={id} graph={graph} asOf={asOf} /> : null}
    </section>
  );
}

/** The same graph and scrubber over the whole workspace, for the Factory (R-052). */
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
        <p className="text-small text-ink-3 tabular">
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
