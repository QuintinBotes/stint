import type { StintEvent } from '@stint-dev/core';
import { type ReactNode, useMemo } from 'react';
import { ROLE_NAMES, agentOf, hostName, markColor, modelName, storyClock } from '../agents';
import type { RunSummary } from '../api';
import { duration, localTime } from '../format';
import { CostMeter, EmptyState, StatusChip, VendorMark, cx } from './ui';

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
      return p.source === 'voice' ? <>Task created from speech: "{str(p.transcript)}"</> : <>Task created: {str(p.title)}</>;
    case 'task.status':
      return <>Status {str(p.from)} to {str(p.to)}</>;
    case 'agent.message':
      return <span className="text-muted">{str(p.text)}</span>;
    case 'agent.tool_call': {
      const args = (p.args ?? {}) as Record<string, unknown>;
      const target = str(args.path) || str(args.file_path) || str(args.command) || str(args.pattern);
      return (
        <>
          <span className="text-muted">{str(p.tool)}</span> <code className="font-mono text-[12px]">{target}</code>
        </>
      );
    }
    case 'agent.tool_result':
      return <span className="text-faint">{str(p.summary) || 'result'}</span>;
    case 'file.changed':
      return (
        <>
          <code className="font-mono text-[12px]">{str(p.path)}</code>{' '}
          <span className="tabular text-good">+{Number(p.added)}</span> <span className="tabular text-bad">-{Number(p.removed)}</span>
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
          Verification by the daemon: <span className="tabular">{Number(p.passed)} passed, {Number(p.failed)} failed</span>
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
          <span className="text-faint"> ({str(p.reason)})</span>
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
    case 'human.command':
      return (
        <>
          You ran <code className="font-mono text-[12px]">{str(p.command)}</code>
        </>
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
      return <span className="text-faint">Unclassified output ({str(p.originalType)})</span>;
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
      return <span className="text-faint">{e.type}</span>;
  }
}

function EventRow({ e, selected, onSelect }: { e: StintEvent; selected: boolean; onSelect: (seq: number) => void }) {
  const human = e.type === 'human.command' || e.vendor === 'human';
  const marked = e.type === 'verification.ran' || e.type === 'review.recorded' || e.type === 'rule.blocked';
  return (
    <li>
      <button
        type="button"
        data-testid="event-row"
        data-seq={e.seq}
        data-type={e.type}
        onClick={() => onSelect(e.seq)}
        className={cx(
          'w-full text-left grid grid-cols-[1fr_auto] gap-2 px-2 py-1 rounded-sm text-[12.5px] leading-[18px]',
          selected ? 'bg-accent-tint' : 'hover:bg-sunken',
          human && 'border-l-2 border-ink pl-1.5',
          marked && 'font-medium',
        )}
      >
        <span className="min-w-0 break-words">{describe(e)}</span>
        <time className="tabular text-faint text-[11px]" dateTime={e.ts}>
          {storyClock(e.payload) ?? localTime(e.ts)}
        </time>
      </button>
    </li>
  );
}

function Segment({ b, showAll, selected, onSelect, live }: { b: Extract<Block, { kind: 'segment' }>; showAll: boolean; selected: number | null; onSelect: (seq: number) => void; live: boolean }) {
  const s = b.summary;
  const finished = b.events.find((e) => e.type === 'run.finished');
  const host = str(b.started.payload.host);
  const model = str(b.started.payload.model);
  const agent = agentOf(b.started.adapter, host, model);
  const role = str(b.started.payload.role);
  const isCall = b.started.adapter === 'openai-compatible';
  const startAt = b.started.payload.replayAt;
  const endAt = finished?.payload.replayAt;
  const took =
    typeof startAt === 'number' && (typeof endAt === 'number' || !finished)
      ? `${Math.round(((typeof endAt === 'number' ? endAt : startAt) - startAt) / 1000)}s`
      : duration(b.started.ts, finished?.ts ?? null);
  const endedBy = finished ? str(finished.payload.endedBy) : 'running';
  const shown = showAll ? b.events : b.events.filter((e) => NOTABLE.has(e.type));
  const hidden = b.events.length - shown.length;
  return (
    <section data-testid="run-segment" data-run={b.run} data-adapter={b.started.adapter} className="relative pl-4">
      <span aria-hidden className={cx('absolute left-0 top-0 bottom-0 w-[3px] rounded-full', live && 'live-spine')} style={{ background: markColor[agent.mark] }} />
      <header className="flex items-start justify-between gap-2 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px]">
            <VendorMark agent={agent} showName={false} />
            <span className="font-semibold truncate" data-testid="segment-model">
              {modelName(model)}
            </span>
            <span className="text-faint shrink-0">{b.run}</span>
          </div>
          <div className="text-[12px] text-muted mt-0.5 truncate">
            {isCall
              ? `${ROLE_NAMES[role] ?? role} ${host === 'ollama' ? 'offline on this machine' : `on ${hostName(host)}`}`
              : `${agent.name} ${b.started.payload.handoffFrom ? `continues from packet ${str(b.started.payload.handoffFrom)}` : ROLE_NAMES[role] ?? role}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusChip status={endedBy} />
          <span className="text-[11px] text-faint tabular">
            {took}, <CostMeter cost={s?.cost ?? (finished?.payload.cost as never)} />
          </span>
        </div>
      </header>
      <ol className="flex flex-col gap-px pb-2">
        {shown.filter((e) => e.type !== 'run.finished').map((e) => (
          <EventRow key={e.seq} e={e} selected={selected === e.seq} onSelect={onSelect} />
        ))}
        {finished && endedBy === 'killed' ? (
          <li className="px-2 py-1 text-[12.5px] text-warn">Killed. In-flight step unknown: {str(finished.payload.inFlight) || 'none recorded'}</li>
        ) : null}
        {hidden > 0 && !showAll ? <li className="px-2 text-[11px] text-faint">{hidden} more, including messages</li> : null}
      </ol>
    </section>
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
      className="relative w-full my-1 flex items-center gap-3 rounded-md border border-line-strong bg-raised px-3 py-2 text-left hover:border-accent"
    >
      <span aria-hidden className="h-2.5 w-2.5 rotate-45 border border-ink bg-surface" />
      <span className="text-[12.5px]">
        <span className="font-semibold">Packet {str(p.name)}</span>
        <span className="tabular">, {Number(p.tokens)} tokens</span>
        <span className="text-faint tabular">, {kb} KB, after the run was {str(p.reason) || 'ended'}</span>
      </span>
    </button>
  );
}

export function Rail({
  events,
  runs,
  showAll,
  selected,
  onSelect,
  onOpenPacket,
}: {
  events: StintEvent[];
  runs: RunSummary[];
  showAll: boolean;
  selected: number | null;
  onSelect: (seq: number) => void;
  onOpenPacket: (name: string) => void;
}) {
  const bs = useMemo(() => blocks(events, runs), [events, runs]);
  if (events.length === 0) return <EmptyState testId="empty-rail">Runs appear here, one segment per agent, as soon as the task is assigned.</EmptyState>;
  return (
    <div className="flex flex-col gap-1" data-testid="rail">
      {bs.map((b) => {
        if (b.kind === 'segment') {
          const live = !b.events.some((e) => e.type === 'run.finished');
          return <Segment key={`s-${b.run}`} b={b} showAll={showAll} selected={selected} onSelect={onSelect} live={live} />;
        }
        if (b.kind === 'joint') return <Joint key={`j-${b.event.seq}`} e={b.event} onOpen={onOpenPacket} />;
        if (!showAll && !NOTABLE.has(b.event.type) && b.event.type !== 'task.created') return null;
        return (
          <ol key={`r-${b.event.seq}`} className="pl-4">
            <EventRow e={b.event} selected={selected === b.event.seq} onSelect={onSelect} />
          </ol>
        );
      })}
    </div>
  );
}
