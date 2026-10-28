import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type Agent, agentOf, markColor } from '../agents';
import { type TaskCardData, api } from '../api';
import { age } from '../format';
import { CostMeter, Plate, StatusChip, VendorMark, cx } from './ui';

type CardTask = TaskCardData['task'];

/** Model summaries already asked for, by task and its last event: at most one ask per card per seq. */
const askedSummaries = new Set<string>();
const modelSummaries = new Map<string, string>();

type SummaryAsk = { key: string; taskId: string; cancelled: boolean; done: (summary: string | null) => void };
const summaryQueue: SummaryAsk[] = [];
let drainingSummaries = false;
const rest = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks for summaries one at a time, after letting the board draw. A local model
 * answers slowly, so a board of parallel asks would hold every connection the
 * page has; a slow ask is followed by a rest, a cached one is not.
 */
async function drainSummaries(): Promise<void> {
  if (drainingSummaries) return;
  drainingSummaries = true;
  await rest(1000);
  while (summaryQueue.length) {
    const ask = summaryQueue.shift() as SummaryAsk;
    if (ask.cancelled) {
      ask.done(null);
      continue;
    }
    if (askedSummaries.has(ask.key)) {
      ask.done(modelSummaries.get(ask.key) ?? null);
      continue;
    }
    askedSummaries.add(ask.key);
    const started = Date.now();
    try {
      const r = await api.summary(ask.taskId);
      if (r.source === 'model' && r.summary) {
        modelSummaries.set(ask.key, r.summary);
        ask.done(r.summary);
      } else ask.done(null);
    } catch {
      ask.done(null);
    }
    await rest(Date.now() - started > 1000 ? 700 : 30);
  }
  drainingSummaries = false;
}

/** The local model's card line when there is one, asked for after the board has drawn. */
function useModelSummary(card: TaskCardData): string | null {
  const key = `${card.task.id}@${card.lastEventAt}`;
  const [summary, setSummary] = useState<string | null>(() => modelSummaries.get(key) ?? null);
  useEffect(() => {
    const hit = modelSummaries.get(key) ?? null;
    if (hit) {
      setSummary(hit);
      return;
    }
    const ask: SummaryAsk = {
      key,
      taskId: card.task.id,
      cancelled: false,
      done: (got) => {
        if (got && !ask.cancelled) setSummary(got);
      },
    };
    summaryQueue.push(ask);
    void drainSummaries();
    return () => {
      ask.cancelled = true;
    };
  }, [key, card.task.id]);
  return summary;
}

/** How a task in the same split stands: merged, or its status, or what it still waits for. */
function standing(t: CardTask, all: Map<string, CardTask>): string {
  if (t.status === 'done') return 'merged';
  const open = (t.dependsOn ?? []).filter((d) => all.get(d)?.status !== 'done');
  return open.length ? `waits for ${open.join(', ')}` : t.status.replace('_', ' ');
}

/** Who holds the car now, in the words a person uses: you at the gate, the driver on track, or nobody yet. */
function Holding({ card }: { card: TaskCardData }) {
  const { task, lastRun } = card;
  if (task.status === 'awaiting_approval') return <span className="text-[12px] text-ink-2">In the pits for you</span>;
  if (task.status === 'done' || task.status === 'approved') return <span className="text-[12px] text-ink-2">Parked</span>;
  if (lastRun && !lastRun.endedAt) {
    const a = agentOf(lastRun.adapter, lastRun.host, lastRun.model);
    return (
      <span className="inline-flex items-center gap-2 text-[14px]">
        <VendorMark agent={a} showName={false} size={15} />
        <span className="text-ink-2">{lastRun.run}, live</span>
      </span>
    );
  }
  if (task.status === 'planned' && !lastRun) return <span className="text-[12px] text-ink-2">Nobody yet</span>;
  if (!lastRun) return <span className="text-[12px] text-ink-2">Unassigned</span>;
  return <span className="text-[12px] text-ink-2">Last: {agentOf(lastRun.adapter, lastRun.host, lastRun.model).name}</span>;
}

/** Every driver that took the car out, in order, one block each: who drove, not how long, which the board does not know. */
function Drivers({ agents, live, done }: { agents: Agent[]; live: boolean; done: boolean }) {
  return (
    <span className="flex flex-col gap-1 min-w-0" data-testid="card-agents">
      <span aria-hidden="true" className="flex items-center gap-1 h-[18px] border-b border-dashed border-rule-strong">
        {agents.slice(0, 6).map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same agent can drive twice, so position is the identity
          <span key={i} className={cx('h-3 flex-1 max-w-12 rounded-[2px]', live && i === agents.length - 1 && 'live-spine')} style={{ background: markColor[a.mark] }} />
        ))}
      </span>
      <span aria-hidden="true" className="flex gap-2 text-[12px] font-extrabold stretch-75 tracking-[0.03em] text-ink-2 truncate">
        {agents.length ? agents.slice(0, 6).map((a, i) => <span key={`${a.code}-${i}`}>{a.code}</span>) : <span className="font-normal [font-stretch:100%]">No stint yet</span>}
      </span>
      <span className="sr-only">{agents.length ? `Drivers so far: ${agents.map((a) => a.name).join(', ')}` : 'No driver has taken it out yet'}</span>
    </span>
  );
}

export function TaskCard({ card, all, lane }: { card: TaskCardData; all?: Map<string, CardTask>; lane?: string }) {
  const { task, lastRun } = card;
  const modelSummary = useModelSummary(card);
  const tasks = all ?? new Map<string, CardTask>();
  // a split task lists its subtasks in order, each with what it waits for: the dependency line (R-036)
  const children = [...tasks.values()].filter((t) => t.parent === task.id).sort((a, b) => a.id.localeCompare(b.id));
  const agents = (card.agents ?? (lastRun?.adapter ? [{ adapter: lastRun.adapter, host: lastRun.host, model: lastRun.model, role: lastRun.role }] : [])).map((a) => agentOf(a.adapter, a.host, a.model));
  const live = !!lastRun && !lastRun.endedAt;
  const done = task.status === 'done';
  const gate = lane === 'needs-you';
  const chip = done ? <StatusChip label="merged" tone="merged" /> : <StatusChip status={task.status} />;
  const summary = modelSummary ?? card.summary;
  return (
    <Link
      to={`/t/${task.id}`}
      data-testid="task-card"
      data-task={task.id}
      className={cx(
        'group grid grid-cols-[48px_minmax(0,1fr)_auto] lg:grid-cols-[56px_minmax(0,1fr)_160px_200px_88px_72px] items-center gap-x-3 px-3 py-3 border-b border-rule no-underline hover:bg-panel focus-visible:bg-panel',
        gate && 'bg-band',
      )}
    >
      <Plate id={task.id} variant={done ? 'dim' : task.status === 'planned' ? 'grid' : 'solid'} />
      <span className="min-w-0 flex flex-col gap-1">
        <span className="text-[14px] font-bold leading-5 group-hover:underline underline-offset-2">{task.title}</span>
        {summary ? (
          <span className="text-[12px] text-ink-2 line-clamp-2" data-testid="card-summary" data-source={modelSummary ? 'model' : 'agent.message'}>
            {summary}
          </span>
        ) : (
          <span className="text-[12px] text-ink-2 line-clamp-1">{task.goal}</span>
        )}
        <span className="font-mono text-[12px] text-ink-2 lg:hidden">{task.id}</span>
        {card.autopilot?.on ? (
          <span className="mt-1 flex items-center gap-2 text-[12px] min-w-0" data-testid="autopilot-chip">
            <StatusChip label={card.autopilot.queued ? 'queued' : `autopilot: ${card.autopilot.step}`} tone={card.autopilot.queued ? 'neutral' : 'active'} />
            {card.autopilot.reason ? <span className="text-ink-2 truncate">{card.autopilot.reason}</span> : null}
          </span>
        ) : null}
        {task.parent || task.dependsOn?.length ? (
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2" data-testid="task-family">
            {task.parent ? <span>Part of <span className="font-mono">{task.parent}</span></span> : null}
            {task.dependsOn?.length ? (
              <span>
                after{' '}
                {task.dependsOn.map((d, i) => (
                  <span key={d} className="font-mono">
                    {i ? ', ' : ''}
                    {d}
                    {tasks.get(d)?.status === 'done' ? ' (merged)' : ''}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
        {children.length ? (
          <ol className="mt-2 flex flex-col gap-1 border-l-2 border-rule-strong pl-2 text-[12px]" data-testid="subtasks" aria-label={`${children.length} subtasks`}>
            {children.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 min-w-0" data-subtask={c.id}>
                <span className="font-mono text-ink-2 shrink-0">{c.id}</span>
                <span className="truncate">{c.title}</span>
                <span className="ml-auto shrink-0 text-ink-2">{standing(c, tasks)}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 lg:hidden">
          {chip}
          <Holding card={card} />
          <span className="text-[12px] text-ink-2 tabular">{age(card.lastEventAt)} ago</span>
        </span>
      </span>
      <span className="hidden lg:block min-w-0">
        <Holding card={card} />
      </span>
      <span className="hidden lg:block min-w-0">
        <Drivers agents={agents} live={live} done={done} />
      </span>
      <span className="hidden lg:block text-[12px] text-ink-2 tabular">{age(card.lastEventAt)} ago</span>
      <span className={cx('text-right font-bold tabular', !card.cost.usd && 'text-ink-2 font-normal')}>
        <CostMeter cost={card.cost} />
      </span>
    </Link>
  );
}
