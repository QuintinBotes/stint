import type { StintEvent } from '@stint-dev/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { DAEMON, ROLE_NAMES, YOU, agentOf, hostName, markColor, modelName, storyClock } from '../agents';
import { type RunSummary, api } from '../api';
import { duration, localTime } from '../format';
import { useHealth } from '../hooks';
import { Button, type ChipTone, CostMeter, EmptyState, StatusChip, VendorMark, cx } from './ui';

/** What raises attention on the rail when collapsed: what the agent did, what changed, what was decided or refused. */
const NOTABLE = new Set([
  'agent.tool_call',
  'file.changed',
  'decision.recorded',
  'verification.ran',
  'review.recorded',
  'rule.blocked',
  'run.refused',
  'skill.applied',
  'runtime.unclassified',
  'human.command',
  'handoff.created',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'merge.completed',
  'skill.proposed',
  'skill.approved',
  'skill.status',
  'skill.retire_proposed',
  'skill.evaluated',
  'outcome.reverted',
  'provider.fallback',
]);

type Block =
  | { kind: 'segment'; run: string; summary: RunSummary | undefined; events: StintEvent[]; started: StintEvent }
  | { kind: 'joint'; event: StintEvent }
  | { kind: 'row'; event: StintEvent };

function blocks(events: StintEvent[], runs: RunSummary[]): Block[] {
  const out: Block[] = [];
  let open: Extract<Block, { kind: 'segment' }> | null = null;
  for (const e of events) {
    if (e.type === 'run.started' && e.run) {
      open = { kind: 'segment', run: e.run, summary: runs.find((r) => r.run === e.run), events: [], started: e };
      out.push(open);
      continue;
    }
    if (e.type === 'handoff.created') {
      out.push({ kind: 'joint', event: e });
      open = null;
      continue;
    }
    if (open && e.run === open.run) {
      open.events.push(e);
      if (e.type === 'run.finished') open = null;
      continue;
    }
    out.push({ kind: 'row', event: e });
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One line of plain words for an event. Agent text is evidence, so it is shown as text, never as markdown. */
export function describe(e: StintEvent): ReactNode {
  const p = e.payload;
  switch (e.type) {
    case 'task.created':
      return <>Task created: {str(p.title ?? p.transcript)}</>;
    case 'task.status':
      return <>Status {str(p.from)} to {str(p.to)}</>;
    case 'agent.message':
      return <span className="text-ink-2">{str(p.text)}</span>;
    case 'agent.tool_call': {
      const args = (p.args ?? {}) as Record<string, unknown>;
      const target = str(args.path) || str(args.file_path) || str(args.command) || str(args.pattern);
      return (
        <>
          <span className="text-ink-2">{str(p.tool)}</span> <code className="font-mono text-[12px]">{target}</code>
        </>
      );
    }
    case 'agent.tool_result':
      return <span className="text-ink-2">{str(p.summary) || 'result'}</span>;
    case 'file.changed':
      return (
        <>
          <code className="font-mono text-[12px]">{str(p.path)}</code>{' '}
          <span className="tabular text-green">+{Number(p.added)}</span> <span className="tabular text-red">-{Number(p.removed)}</span>
        </>
      );
    case 'decision.recorded':
      return (
        <>
          <span className="font-semibold">{str(p.id)}</span> decided: {str(p.text)}
        </>
      );
    case 'verification.ran':
      return (
        <>
          Verification by the daemon:{' '}
          <span className="tabular">
            {Number(p.passed)} passed{p.tamper === null ? ', tests unchanged' : ''}, {Number(p.failed)} failed
          </span>
        </>
      );
    case 'review.recorded':
      return (
        <>
          Review: {str(p.verdict).replace('_', ' ')}, {Number(p.findings)} finding{Number(p.findings) === 1 ? '' : 's'}
          {Number(p.contradictions) > 0 ? `, ${Number(p.contradictions)} routed to the queue` : ''}
          {p.offline ? ', offline' : ''}
        </>
      );
    case 'rule.blocked':
      return (
        <>
          Refused by Stint rules: <code className="font-mono text-[12px]">{str(p.action)}</code>
          <span className="text-ink-2"> ({str(p.reason)})</span>
        </>
      );
    case 'run.refused':
      return <>Run refused: {str(p.message)}</>;
    case 'skill.applied':
      return <>Skill mounted: {str(p.skill)}</>;
    case 'skill.proposed':
      return <>Skill proposed: {str(p.id)}</>;
    case 'skill.approved':
      return <>Skill approved: {str(p.id)}</>;
    case 'skill.status':
      return (
        <>
          Skill {str(p.id)} is now {str(p.to)} (helped {Number(p.helped)}, hurt {Number(p.hurt)})
        </>
      );
    case 'skill.retire_proposed':
      return (
        <>
          Retirement proposed for {str(p.id)}: helped {Number(p.helped)}, hurt {Number(p.hurt)}
        </>
      );
    case 'skill.evaluated':
      return <>Skill evaluated: {str(p.id)}: {str(p.card)}</>;
    case 'outcome.reverted':
      return <>This change was reverted after merge</>;
    case 'eval.ran':
      return (
        <>
          Golden eval {str(p.golden)} run {Number(p.run)}/{Number(p.k)}: {p.passed ? 'passed' : 'failed'}
        </>
      );
    case 'human.command':
      // a typed command, or a person's word on a queue item ("Kept D3"), which has text and no command
      return p.command ? (
        <>
          You ran <code className="font-mono text-[12px]">{str(p.command)}</code>
        </>
      ) : (
        <>You: {str(p.text)}</>
      );
    case 'approval.requested':
      return <>Approval requested</>;
    case 'approval.granted':
      return <>Approved by {str(p.by) || 'a person'}</>;
    case 'approval.rejected':
      return <>Rejected: {str(p.reason)}</>;
    case 'merge.completed':
      return (
        <>
          Merged into {str(p.into) || 'the base branch'} as <code className="font-mono text-[12px]">{str(p.commit).slice(0, 7)}</code>
        </>
      );
    case 'provider.fallback':
      return <>Fell back from {str(p.from)} to {str(p.to)} ({str(p.reason)})</>;
    case 'runtime.unclassified':
      return <span className="text-ink-2">Unclassified output ({str(p.originalType)})</span>;
    case 'escalation.triggered':
      return p.unavailable ? (
        <>
          {str(p.failures)} failed runs; nothing to escalate to was available, so it went to {str(p.to)}
        </>
      ) : (
        <>
          {str(p.failures)} failed runs, so {str(p.from)} escalated to {str(p.to)}
        </>
      );
    case 'bestofn.started':
      return <>Building {str(p.n)} candidates at once: {(p.candidates as string[] | undefined)?.join(', ')}</>;
    case 'bestofn.picked':
      return (
        <>
          Picked {str(p.pick)}: {str(p.reason)}
        </>
      );
    default:
      return <span className="text-ink-2">{e.type}</span>;
  }
}

/** Below this many rows everything renders, so find-in-page works on an ordinary task; above it only what is on screen. */
const VIRTUAL_FROM = 400;

type Seg = Extract<Block, { kind: 'segment' }>;
type Item =
  | { kind: 'head'; key: string; seg: Seg; live: boolean }
  | { kind: 'event'; key: string; e: StintEvent; seg: Seg | null; live: boolean }
  | { kind: 'note'; key: string; seg: Seg; live: boolean; text: string; warn: boolean }
  | { kind: 'joint'; key: string; e: StintEvent }
  | { kind: 'checkpoint'; key: string; seg: Seg; commit: string };

/** The rail as one flat list, so it can be windowed: a segment is its header, its rows, its notes and its checkpoint. */
function items(events: StintEvent[], runs: RunSummary[], showAll: boolean): Item[] {
  const out: Item[] = [];
  for (const b of blocks(events, runs)) {
    if (b.kind === 'segment') {
      const finished = b.events.find((e) => e.type === 'run.finished');
      const live = !finished;
      out.push({ kind: 'head', key: `h-${b.run}`, seg: b, live });
      const shown = showAll ? b.events : b.events.filter((e) => NOTABLE.has(e.type));
      for (const e of shown) if (e.type !== 'run.finished') out.push({ kind: 'event', key: `e-${e.seq}`, e, seg: b, live });
      if (finished && str(finished.payload.endedBy) === 'killed') {
        out.push({ kind: 'note', key: `k-${b.run}`, seg: b, live, text: `Red flag: the run was stopped. In-flight step unknown: ${str(finished.payload.inFlight) || 'none recorded'}`, warn: true });
      }
      const hidden = b.events.length - shown.length;
      if (hidden > 0 && !showAll) out.push({ kind: 'note', key: `m-${b.run}`, seg: b, live, text: `${hidden} more, including messages`, warn: false });
      const commit = finished ? str(finished.payload.commit) : '';
      if (commit) out.push({ kind: 'checkpoint', key: `c-${b.run}`, seg: b, commit });
      continue;
    }
    if (b.kind === 'joint') {
      out.push({ kind: 'joint', key: `j-${b.event.seq}`, e: b.event });
      continue;
    }
    if (!showAll && !NOTABLE.has(b.event.type) && b.event.type !== 'task.created') continue;
    out.push({ kind: 'event', key: `r-${b.event.seq}`, e: b.event, seg: null, live: false });
  }
  return out;
}

/** Where the rail starts inside its scroller, which the windowing needs; offsetTop would measure from the wrong box. */
function offsetIn(el: HTMLElement | null, scroller: HTMLElement | null): number {
  if (!el || !scroller) return 0;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

const segAgent = (seg: Seg) => agentOf(seg.started.adapter, str(seg.started.payload.host), str(seg.started.payload.model));

/** The run's coloured spine, drawn beside every row of its segment. */
function Spine({ seg, live, children }: { seg: Seg; live: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-4">
      <span aria-hidden="true" className={cx('absolute left-0 top-0 bottom-0 w-[3px] rounded-[1px]', live && 'live-spine')} style={{ background: markColor[segAgent(seg).mark] }} />
      {children}
    </div>
  );
}

/** What an expanded row shows: the agent's words in full, or the event's payload. */
function detail(e: StintEvent): string {
  if (e.type === 'agent.message') return str(e.payload.text);
  const text = JSON.stringify(e.payload, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n...` : text;
}

/** Who an event belongs to in race control: you, the driver of its stint, or the daemon. */
function driverOf(e: StintEvent, seg: Seg | null) {
  if (e.type === 'human.command' || e.vendor === 'human') return YOU;
  if (seg) return segAgent(seg);
  return e.adapter ? agentOf(e.adapter) : DAEMON;
}

function EventRow({ e, seg, selected, expanded, onActivate }: { e: StintEvent; seg: Seg | null; selected: boolean; expanded: boolean; onActivate: (seq: number, keyboard: boolean) => void }) {
  const human = e.type === 'human.command' || e.vendor === 'human';
  const marked = e.type === 'verification.ran' || e.type === 'review.recorded' || e.type === 'rule.blocked';
  const tint = e.type === 'verification.ran' ? (e.payload.status === 'green' ? 'bg-added' : 'bg-removed') : e.type === 'rule.blocked' ? 'bg-removed' : null;
  const who = driverOf(e, seg);
  return (
    <>
      <button
        type="button"
        data-testid="event-row"
        data-seq={e.seq}
        data-type={e.type}
        aria-expanded={selected ? expanded : undefined}
        // a click made by Enter or Space has detail 0
        onClick={(ev) => onActivate(e.seq, ev.detail === 0)}
        className={cx(
          'w-full text-left grid grid-cols-[44px_32px_minmax(0,1fr)] gap-2 px-2 py-1 border-b border-rule text-[14px] leading-5',
          selected ? 'bg-panel-2' : tint ?? 'hover:bg-panel',
          marked && 'font-semibold',
        )}
      >
        <time className={cx('tabular text-[12px]', tint ? 'text-ink-2' : 'text-ink-3')} dateTime={e.ts}>
          {storyClock(e.payload) ?? localTime(e.ts)}
        </time>
        <span className={cx('text-[12px] font-extrabold stretch-75 tracking-[0.03em]', human ? 'text-ink' : 'text-ink-2')} title={who.name}>
          {who.code}
        </span>
        <span className="min-w-0 break-words">{describe(e)}</span>
      </button>
      {selected && expanded ? (
        <pre className="mx-2 my-1 max-h-60 overflow-auto rounded-[3px] bg-panel p-2 font-mono text-[12px] leading-[16px] whitespace-pre-wrap break-words" data-testid="event-detail" tabIndex={0}>
          {detail(e)}
        </pre>
      ) : null}
    </>
  );
}

/**
 * How much a person is asked before this run's work can land, from the gate health reports for its
 * harness and the task's risk tier: an observed gate means the harness's own approvals are on and
 * Stint never bypasses them; low risk can take the auto-approve lane with the daemon's verify;
 * anything else waits for a person.
 */
export function permissionTier(gate: string | null | undefined, risk: string | null | undefined): { label: string; tone: ChipTone } {
  if (gate === 'observed') return { label: 'never bypass', tone: 'warn' };
  if (risk === 'low') return { label: 'auto, verified', tone: 'good' };
  return { label: 'manual', tone: 'neutral' };
}

function SegmentHead({ seg, gate, risk }: { seg: Seg; gate?: string | null; risk?: string | null }) {
  const s = seg.summary;
  const finished = seg.events.find((e) => e.type === 'run.finished');
  const host = str(seg.started.payload.host);
  const model = str(seg.started.payload.model);
  const agent = segAgent(seg);
  const role = str(seg.started.payload.role);
  const isCall = seg.started.adapter === 'openai-compatible';
  const startAt = seg.started.payload.replayAt;
  const endAt = finished?.payload.replayAt;
  const took =
    typeof startAt === 'number' && (typeof endAt === 'number' || !finished)
      ? `${Math.round(((typeof endAt === 'number' ? endAt : startAt) - startAt) / 1000)}s`
      : duration(seg.started.ts, finished?.ts ?? null);
  const endedBy = finished ? str(finished.payload.endedBy) : 'running';
  const tier = permissionTier(gate, risk);
  return (
    <header data-testid="run-segment" data-run={seg.run} data-adapter={seg.started.adapter} className="flex items-start justify-between gap-2 pt-3 pb-2 border-b border-rule">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[14px]">
          <VendorMark agent={agent} showName={false} size={18} />
          <span className="font-bold truncate" data-testid="segment-model">
            {modelName(model)}
          </span>
          <span className="text-ink-2 shrink-0">stint {seg.run}</span>
        </div>
        <div className="text-[12px] text-ink-2 mt-1 truncate">
          {isCall
            ? `${ROLE_NAMES[role] ?? role} ${host === 'ollama' ? 'offline on this machine' : `on ${hostName(host)}`}`
            : `${agent.name} ${seg.started.payload.handoffFrom ? `continues from packet ${str(seg.started.payload.handoffFrom)}` : ROLE_NAMES[role] ?? role}`}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <StatusChip status={endedBy} />
        <span data-testid="permission-tier" title="Permission tier">
          <StatusChip label={tier.label} tone={tier.tone} />
        </span>
        <span className="text-[12px] text-ink-2 tabular">
          {took}, <CostMeter cost={s?.cost ?? (finished?.payload.cost as never)} />
        </span>
      </div>
    </header>
  );
}

function Joint({ e, onOpen }: { e: StintEvent; onOpen: (name: string) => void }) {
  const p = e.payload;
  const kb = (Number(p.bytes) / 1024).toFixed(1);
  return (
    <button
      type="button"
      data-testid="handoff-joint"
      onClick={() => onOpen(str(p.name))}
      className="relative w-full my-2 flex items-center gap-3 rounded-[4px] bg-board text-board-ink px-3 py-2 text-left hover:outline hover:outline-1 hover:outline-rule-strong"
    >
      <span className="shrink-0 text-[14px] leading-4 font-extrabold stretch-70 tracking-[0.02em] uppercase">Pit stop</span>
      <span className="text-[14px] leading-5">
        <span className="font-bold">Packet {str(p.name)}</span>
        <span className="tabular">, {Number(p.tokens)} tokens</span>
        <span className="opacity-75 tabular">, {kb} KB, after the run was {str(p.reason) || 'ended'}</span>
      </span>
    </button>
  );
}

const LATER = 'Restoring the conversation comes in a later release; the packet carries it forward today.';

/** A run boundary: the commit the run ended on, which can be opened in a worktree of its own. */
function Checkpoint({ seg, commit }: { seg: Seg; commit: string }) {
  const { id = '' } = useParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path: string } | { error: string } | null>(null);
  const restore = () => {
    setBusy(true);
    api
      .restoreCheckpoint(id, seg.run)
      .then((r) => setResult({ path: r.path }))
      .catch((e: unknown) => setResult({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="py-2 text-[12px]" data-testid="checkpoint" data-run={seg.run}>
      <div className="flex items-center gap-2 text-ink-3">
        <span aria-hidden="true" className="h-px flex-1 bg-rule" />
        <span>
          Checkpoint after {seg.run}, <code className="font-mono">{commit.slice(0, 7)}</code>
        </span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-[3px] px-2 text-ink-2 hover:text-ink border border-ink-3 hover:border-ink">
          Restore
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-rule" />
      </div>
      {open ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 justify-center" role="group" aria-label={`Restore the checkpoint after ${seg.run}`}>
          <Button className="h-7" disabled={busy} onClick={restore}>
            Code
          </Button>
          <span className="w-full text-center text-ink-2">{LATER}</span>
        </div>
      ) : null}
      {result && 'path' in result ? (
        <p className="mt-1 text-center text-ink-2" data-testid="checkpoint-restored">
          {seg.run}'s code at <code className="font-mono">{commit.slice(0, 7)}</code> is in <code className="font-mono text-ink">{result.path}</code>
        </p>
      ) : null}
      {result && 'error' in result ? <p className="mt-1 text-center text-red">The checkpoint was not restored: {result.error}</p> : null}
    </div>
  );
}

export function Rail({
  events,
  runs,
  showAll,
  selected,
  onSelect,
  onOpenPacket,
  rewound = false,
}: {
  events: StintEvent[];
  runs: RunSummary[];
  showAll: boolean;
  selected: number | null;
  onSelect: (seq: number) => void;
  onOpenPacket: (name: string) => void;
  /** The view shows an earlier moment, so the newest events are not on the rail yet. */
  rewound?: boolean;
}) {
  const list = useMemo(() => items(events, runs, showAll), [events, runs, showAll]);
  const { data: health } = useHealth();
  const gates = useMemo(() => new Map((health?.adapters ?? []).map((a) => [a.id, a.gate])), [health]);
  const risk = useMemo(() => {
    const assessed = [...events].reverse().find((e) => e.type === 'risk.assessed');
    return typeof assessed?.payload.tier === 'string' ? assessed.payload.tier : null;
  }, [events]);
  const virtual = list.length >= VIRTUAL_FROM;
  const live = list.some((it) => it.kind === 'head' && it.live);
  const root = useRef<HTMLOListElement>(null);
  // the rail scrolls inside the task view's column, its parent
  const scroller = () => root.current?.parentElement ?? null;
  const v = useVirtualizer({
    count: virtual ? list.length : 0,
    getScrollElement: scroller,
    // measured on the replay in the drawer: a wrong guess makes every newly drawn row correct the layout while scrolling
    estimateSize: (i) => (list[i]?.kind === 'head' ? 90 : list[i]?.kind === 'joint' ? 72 : list[i]?.kind === 'checkpoint' ? 38 : 50),
    getItemKey: (i) => list[i]?.key ?? i,
    // at 12, each scroll step drew enough rows to miss the frame budget on a slow CI runner (p95 50 ms, 33 ms at 6)
    overscan: 6,
    scrollMargin: offsetIn(root.current, scroller()),
  });
  // While the person scrolls up, rows measured above the fold do not move scrollTop: the window's corrections fought
  // their scroll and left it drawing rows from further down. Otherwise the library's own rule stands, so what is on
  // screen stays put: a row first measured with its top above the fold, or re-measured wholly above it.
  v.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, inst) => {
    if (inst.scrollDirection === 'backward') return false;
    const fold = (inst.scrollOffset ?? 0) + inst.scrollAdjustments;
    return inst.itemSizeCache.has(item.key) ? item.end <= fold : item.start < fold;
  };

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (seq: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(seq)) next.add(seq);
      return next;
    });
  // Enter on a row selects and opens it in one press; a mouse click selects, and a second click opens
  const activate = (seq: number, keyboard: boolean) => {
    if (keyboard) {
      onSelect(seq);
      toggle(seq);
    } else if (seq === selected) toggle(seq);
    else onSelect(seq);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || selected === null || e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      toggle(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // pinned to the newest row while a run is live, unless the person scrolled up; then a pill offers the way back
  const atEnd = useRef(true);
  const [behind, setBehind] = useState(false);
  useEffect(() => {
    const el = scroller();
    if (!el) return;
    const onScroll = () => {
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      if (atEnd.current) setBehind(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [events.length === 0]);
  const toEnd = () => {
    if (virtual) v.scrollToIndex(list.length - 1, { align: 'end' });
    else {
      const el = scroller();
      if (el) el.scrollTop = el.scrollHeight;
    }
    atEnd.current = true;
    setBehind(false);
  };
  const seen = useRef(0);
  useLayoutEffect(() => {
    if (list.length > seen.current && live) {
      if (atEnd.current) toEnd();
      else setBehind(true);
    }
    seen.current = list.length;
  }, [list.length, live]);

  // j, k and a linked ?ev= bring the selection on screen once, when it changes or first loads, never on later events
  const broughtIn = useRef<number | null>(null);
  useEffect(() => {
    if (selected === null || broughtIn.current === selected) return;
    const i = list.findIndex((it) => it.kind === 'event' && it.e.seq === selected);
    if (i < 0) return;
    broughtIn.current = selected;
    if (virtual) v.scrollToIndex(i, { align: 'auto' });
    else root.current?.querySelector(`[data-seq="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, list]);

  if (events.length === 0) return <EmptyState testId="empty-rail">{rewound ? 'Nothing had happened yet at this moment on the race clock.' : 'Runs appear here, one stint per agent, as soon as the task is assigned.'}</EmptyState>;

  const render = (it: Item) => {
    switch (it.kind) {
      case 'head':
        return (
          <Spine seg={it.seg} live={it.live}>
            <SegmentHead seg={it.seg} gate={gates.get(it.seg.started.adapter ?? '') ?? null} risk={risk} />
          </Spine>
        );
      case 'event': {
        const row = <EventRow e={it.e} seg={it.seg} selected={selected === it.e.seq} expanded={expanded.has(it.e.seq)} onActivate={activate} />;
        return it.seg ? (
          <Spine seg={it.seg} live={it.live}>
            {row}
          </Spine>
        ) : (
          <div className="pl-5">{row}</div>
        );
      }
      case 'note':
        return (
          <Spine seg={it.seg} live={it.live}>
            <p className={cx('px-2 py-2 border-b border-rule', it.warn ? 'text-[14px] font-semibold text-ink bg-removed' : 'text-[12px] text-ink-3')}>{it.text}</p>
          </Spine>
        );
      case 'joint':
        return <Joint e={it.e} onOpen={onOpenPacket} />;
      case 'checkpoint':
        return <Checkpoint seg={it.seg} commit={it.commit} />;
    }
  };

  const pill = behind ? (
    <button
      type="button"
      data-testid="jump-latest"
      onClick={toEnd}
      className="sticky bottom-2 left-full z-10 mt-2 block rounded-[3px] bg-ink px-3 py-1 text-[12px] font-bold text-ground shadow-[var(--shadow)]"
    >
      Jump to latest
    </button>
  ) : null;

  if (!virtual) {
    return (
      <>
        <ol ref={root} className="flex flex-col" data-testid="rail" aria-label="Timeline">
          {list.map((it) => (
            <li key={it.key}>{render(it)}</li>
          ))}
        </ol>
        {pill}
      </>
    );
  }
  const margin = v.options.scrollMargin;
  return (
    <>
      <ol ref={root} className="relative" style={{ height: v.getTotalSize() }} data-testid="rail" data-virtual="true" aria-label="Timeline">
        {v.getVirtualItems().map((row) => (
          <li key={row.key} data-index={row.index} ref={v.measureElement} className="absolute left-0 right-0 top-0" style={{ transform: `translateY(${row.start - margin}px)` }}>
            {render(list[row.index] as Item)}
          </li>
        ))}
      </ol>
      {pill}
    </>
  );
}
