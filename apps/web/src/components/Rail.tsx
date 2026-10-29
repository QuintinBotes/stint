import type { StintEvent } from '@stint-dev/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ROLE_NAMES, agentOf, hostName, markColor, modelName, storyClock } from '../agents';
import { type RunSummary, api } from '../api';
import { duration, localTime, money } from '../format';
import { useHealth } from '../hooks';
import { useHold } from './Scrubber';
import { Button, type ChipTone, CostMeter, EmptyState, StateMark, StatusChip, Who, cx } from './ui';

/** What raises attention on the rail when collapsed: what the agent did, what changed, what was decided or refused. */
const NOTABLE = new Set([
  'agent.tool_call',
  'file.changed',
  'decision.recorded',
  'verification.ran',
  'visual.checked',
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
const LIMIT_WORDS: Record<string, string> = { builds: 'build', handoffs: 'hand-off', reviewRounds: 'review round', usd: 'spend', minutes: 'agent time' };

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
          <span className="text-ink-2">{str(p.tool)}</span> <code className="font-mono break-all">{target}</code>
        </>
      );
    }
    case 'agent.tool_result':
      return <span className="text-ink-2">{str(p.summary) || 'result'}</span>;
    case 'file.changed':
      return (
        <>
          <code className="font-mono break-all">{str(p.path)}</code>{' '}
          <span className="tabular text-ink-2">
            +{Number(p.added)} -{Number(p.removed)}
          </span>
        </>
      );
    case 'decision.recorded':
      return (
        <>
          <span className="font-semibold">{str(p.id)}</span> decided: {str(p.text)}
        </>
      );
    case 'visual.checked':
      return (
        <>
          Muse Spark looked at {str(p.ref).split(' :: ')[0]}: {p.holds ? 'it looks right' : `looks wrong, ${str(p.problem)}`}
          {p.marked ? '; SAM 3.1 marked it' : ''}
        </>
      );
    case 'verification.ran':
      return (
        <>
          Tests run by Stint:{' '}
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
          Refused by Stint rules: <code className="font-mono">{str(p.action)}</code>
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
          <code className="font-mono break-all">{str(p.command)}</code>
        </>
      ) : (
        <>{str(p.text)}</>
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
          Merged into {str(p.into) || 'the base branch'} as <code className="font-mono">{str(p.commit).slice(0, 7)}</code>
        </>
      );
    case 'provider.fallback':
      return <>Fell back from {str(p.from)} to {str(p.to)} ({str(p.reason)})</>;
    case 'runtime.unclassified':
      return <span className="text-ink-2">Unclassified output ({str(p.originalType)})</span>;
    case 'cost.recorded':
      return (
        <>
          {modelName(str(p.model))} {p.for === 'digest' ? 'read the diff to write the packet' : `answered (${str(p.for)})`}, {money(p.cost as Parameters<typeof money>[0])}
        </>
      );
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
    case 'limit.reached':
      return (
        <>
          The {LIMIT_WORDS[str(p.limit)] ?? str(p.limit)} limit is reached: {p.limit === 'usd' ? `${money({ usd: Number(p.used) })} of ${money({ usd: Number(p.cap) })}` : `${Number(p.used)} of ${Number(p.cap)}${p.limit === 'minutes' ? ' min' : ''}`}
        </>
      );
    case 'limits.changed':
      return <>Limits changed by {str(p.by) || 'a person'}</>;
    case 'sharpen.asked': {
      const asked = (p.questions as unknown[] | undefined)?.length ?? 0;
      return (
        <>
          Sharpen round {str(p.round)}: {asked} question{asked === 1 ? '' : 's'} for you, {(p.assumed as unknown[] | undefined)?.length ?? 0} assumed
        </>
      );
    }
    case 'sharpen.answered':
      return (
        <>
          {str(p.question || p.assumption)} answered by {str(p.by) || 'you'}, recorded as {str(p.decision)}
        </>
      );
    case 'proofs.set':
      return <>Proofs set for {(p.proofs as unknown[] | undefined)?.length ?? 0} criteria</>;
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
        out.push({ kind: 'note', key: `k-${b.run}`, seg: b, live, text: `In-flight step unknown: ${str(finished.payload.inFlight) || 'none recorded'}`, warn: true });
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

/** The run's axis: a 4 px bar in its vendor's ink beside every row of its segment; the agent's name is in its head. */
function Spine({ seg, live, children }: { seg: Seg; live: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-8 pr-4">
      <span aria-hidden="true" className={cx('absolute left-4 top-0 bottom-0 w-1', live && 'live-spine')} style={{ background: markColor[segAgent(seg).mark] }} />
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

function EventRow({ e, selected, expanded, tabStop, onActivate }: { e: StintEvent; selected: boolean; expanded: boolean; tabStop: boolean; onActivate: (seq: number, keyboard: boolean) => void }) {
  const human = e.type === 'human.command' || e.vendor === 'human';
  const marked = e.type === 'verification.ran' || e.type === 'review.recorded' || e.type === 'rule.blocked';
  // green is a passing verification only; a red one or a refusal is red
  const tint = e.type === 'verification.ran' ? (e.payload.status === 'green' ? 'bg-green-wash' : 'bg-red-wash') : e.type === 'rule.blocked' ? 'bg-red-wash' : null;
  return (
    <>
      <button
        type="button"
        data-testid="event-row"
        data-seq={e.seq}
        data-type={e.type}
        aria-expanded={selected ? expanded : undefined}
        // the rail is one stop for Tab; the arrow keys move along it
        tabIndex={tabStop ? 0 : -1}
        // a click made by Enter or Space has detail 0
        onClick={(ev) => onActivate(e.seq, ev.detail === 0)}
        className={cx(
          // the clock column fits its reading: a story's 0:12 and a live task's time of day both stay on one line
          'w-full text-left grid grid-cols-[auto_minmax(0,1fr)] gap-2 px-1.5 py-1 rounded-[3px] text-small',
          selected ? 'bg-panel-2 shadow-[inset_0_0_0_1px_var(--rule-strong)] forced-colors:outline' : (tint ?? 'hover:bg-panel-2'),
          marked && 'font-medium',
        )}
      >
        <time className="min-w-14 font-mono text-small text-ink-3 tabular whitespace-nowrap" dateTime={e.ts}>
          {storyClock(e.payload) ?? localTime(e.ts)}
        </time>
        <span className="min-w-0 break-words">
          {human ? <span className="mr-1.5 inline-flex items-center h-5 px-1.5 rounded-[3px] bg-panel-2 text-ink font-medium">You</span> : null}
          {describe(e)}
        </span>
      </button>
      {selected && expanded ? (
        <pre className="my-1 max-h-60 overflow-auto rounded-[3px] bg-term text-term-ink p-2 font-mono text-small whitespace-pre-wrap break-words" data-testid="event-detail" tabIndex={0}>
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
  if (gate === 'observed') return { label: 'you, and the agent asks first', tone: 'neutral' };
  if (risk === 'low') return { label: 'automatic once tests pass', tone: 'neutral' };
  return { label: 'you', tone: 'neutral' };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
      ? `${Math.round(((typeof endAt === 'number' ? endAt : startAt) - startAt) / 1000)} s`
      : duration(seg.started.ts, finished?.ts ?? null);
  const endedBy = finished ? str(finished.payload.endedBy) : 'running';
  const tier = permissionTier(gate, risk);
  const from = str(seg.started.payload.handoffFrom);
  const what = isCall ? `${capital(ROLE_NAMES[role] ?? role)} ${host === 'ollama' ? 'offline on this machine' : `on ${hostName(host)}`}` : `${capital(ROLE_NAMES[role] ?? role)}${from ? ` from packet ${from}` : ''}`;
  return (
    <header data-testid="run-segment" data-run={seg.run} data-adapter={seg.started.adapter} className="pt-3 pb-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-code text-ink-3">{seg.run}</span>
        <Who agent={agent} live={!finished} className="font-semibold" />
        <StatusChip status={endedBy} />
      </div>
      <p className="mt-0.5 text-small text-ink-2">
        {what}
        {isCall ? '' : (
          <>
            , <span data-testid="segment-model">{modelName(model)}</span>
          </>
        )}
        , {took}, <CostMeter cost={s?.cost ?? (finished?.payload.cost as never)} />
      </p>
      <p className="mt-0.5 text-small text-ink-2">
        Approval: <span data-testid="permission-tier">{tier.label}</span>
      </p>
    </header>
  );
}

/** The square joint between two runs: the packet one run left the next, with its size. */
function Joint({ e, onOpen }: { e: StintEvent; onOpen: (name: string) => void }) {
  const p = e.payload;
  const reason = str(p.reason) || 'ended';
  const stopped = reason === 'killed' || reason === 'failed';
  return (
    <div className="relative pl-8 pr-4 py-1">
      <span aria-hidden="true" className={cx('absolute left-3 top-[15px] size-3 border-2 bg-ground', stopped ? 'border-red' : 'border-ink')} />
      <button
        type="button"
        data-testid="handoff-joint"
        onClick={() => onOpen(str(p.name))}
        title={`${(Number(p.bytes) / 1024).toFixed(1)} KB. Open the packet`}
        className={cx('w-full flex items-baseline justify-between gap-2 rounded-[3px] border bg-ground px-2.5 py-2 text-left text-small hover:border-ink-2', stopped ? 'border-red' : 'border-rule-strong')}
      >
        <span className="min-w-0">
          <span className="font-semibold">Packet {str(p.name)}</span> <span className="text-ink-2">{stopped ? `${reason}, built from the log` : reason}</span>
        </span>
        <span className="shrink-0 font-mono tabular">{Number(p.tokens)} tokens</span>
      </button>
    </div>
  );
}

const LATER = 'Restoring the conversation comes in a later release; the packet carries it forward today.';

/** A run boundary: the commit the run ended on, which can be opened in a worktree of its own. */
function Checkpoint({ seg, commit }: { seg: Seg; commit: string }) {
  const { id = '' } = useParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path: string } | { error: string } | null>(null);
  const hold = useHold();
  const restore = () => {
    if (busy) return;
    setBusy(true);
    api
      .restoreCheckpoint(id, seg.run)
      .then((r) => setResult({ path: r.path }))
      .catch((e: unknown) => setResult({ error: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="pl-8 pr-4 py-1.5 text-small" data-testid="checkpoint" data-run={seg.run}>
      <div className="flex items-center gap-2 text-ink-2">
        <span>
          Checkpoint after {seg.run}, <code className="font-mono">{commit.slice(0, 7)}</code>
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-rule" />
        <Button className="h-7 px-2 text-small" aria-expanded={open} onClick={() => setOpen(!open)}>
          Restore
        </Button>
      </div>
      {open ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" role="group" aria-label={`Restore the checkpoint after ${seg.run}`}>
          <Button className="h-7 px-2 text-small" disabled={busy} aria-busy={busy} onClick={restore} {...hold}>
            {busy ? 'Restoring' : 'Code'}
          </Button>
          <span className="text-ink-2">{LATER}</span>
        </div>
      ) : null}
      {result && 'path' in result ? (
        <p className="mt-1 text-ink-2" data-testid="checkpoint-restored">
          {seg.run}'s code at <code className="font-mono">{commit.slice(0, 7)}</code> is in <code className="font-mono text-ink break-all">{result.path}</code>
        </p>
      ) : null}
      {result && 'error' in result ? (
        <p role="alert" className="mt-1 text-red">
          The checkpoint was not restored: {result.error}
        </p>
      ) : null}
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
    // the mean heights measured in the 320 px rail on the replay: a wrong guess makes every newly drawn row correct the
    // layout while scrolling
    estimateSize: (i) => ({ head: 100, joint: 50, checkpoint: 40, note: 30, event: 40 })[list[i]?.kind ?? 'event'],
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

  if (events.length === 0)
    return (
      <div className="px-4">
        <EmptyState testId="empty-rail">{rewound ? 'Nothing had happened yet at this moment.' : 'Runs appear here, one segment per agent, as soon as the task is assigned.'}</EmptyState>
      </div>
    );

  // the one row Tab lands on: the chosen event when it is drawn, else the first event drawn
  const drawn = virtual ? v.getVirtualItems().map((r) => list[r.index]) : list;
  const drawnEvents = drawn.flatMap((it) => (it?.kind === 'event' ? [it.e.seq] : []));
  const stop = selected !== null && drawnEvents.includes(selected) ? selected : (drawnEvents[0] ?? null);
  const arrows = (ev: React.KeyboardEvent<HTMLOListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
    const rows = [...ev.currentTarget.querySelectorAll<HTMLElement>('[data-testid="event-row"]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    ev.preventDefault();
    const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)));
    rows[to]?.focus();
    rows[to]?.scrollIntoView({ block: 'nearest' });
  };

  const render = (it: Item) => {
    switch (it.kind) {
      case 'head':
        return (
          <Spine seg={it.seg} live={it.live}>
            <SegmentHead seg={it.seg} gate={gates.get(it.seg.started.adapter ?? '') ?? null} risk={risk} />
          </Spine>
        );
      case 'event': {
        const row = <EventRow e={it.e} selected={selected === it.e.seq} expanded={expanded.has(it.e.seq)} tabStop={stop === it.e.seq} onActivate={activate} />;
        return it.seg ? (
          <Spine seg={it.seg} live={it.live}>
            {row}
          </Spine>
        ) : (
          <div className="pl-8 pr-4">{row}</div>
        );
      }
      case 'note':
        return (
          <Spine seg={it.seg} live={it.live}>
            {it.warn ? (
              <p className="my-1 rounded-[3px] bg-red-wash px-2.5 py-2 text-small">
                <b className="inline-flex items-center gap-1.5 font-semibold text-red">
                  <StateMark shape="failed" />
                  Killed.
                </b>{' '}
                {it.text}
              </p>
            ) : (
              <p className="px-1.5 py-1 text-small text-ink-3">{it.text}</p>
            )}
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
      className="sticky bottom-2 left-full z-10 mt-2 mr-4 block rounded-[5px] bg-ink px-3 h-8 text-small font-semibold text-on-ink"
    >
      Jump to latest
    </button>
  ) : null;

  if (!virtual) {
    return (
      <>
        <ol ref={root} className="flex flex-col pt-1 pb-3" data-testid="rail" aria-label="Runs and their events. The arrow keys move between events." onKeyDown={arrows}>
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
      <ol ref={root} className="relative" style={{ height: v.getTotalSize() }} data-testid="rail" data-virtual="true" aria-label="Runs and their events. The arrow keys move between events." onKeyDown={arrows}>
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
