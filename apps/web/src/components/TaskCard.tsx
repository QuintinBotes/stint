import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { agentOf } from '../agents';
import { type TaskCardData, api } from '../api';
import { age } from '../format';
import { CostMeter, StatusChip, Who, cx } from './ui';

type CardTask = TaskCardData['task'];

/** The tests line in words, so its colour is never the only signal: how many passed, or how many of how many failed. */
function testsLine(v: NonNullable<TaskCardData['verification']>): string {
  const total = v.passed + v.failed;
  if (v.status === 'green') return total ? `${v.passed} test${v.passed === 1 ? '' : 's'} passed` : 'Tests passed';
  return v.failed ? `${v.failed} of ${total} test${total === 1 ? '' : 's'} failed` : 'Tests failed';
}

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

/** What the card's foot says about time: how long it has waited for you, how long the live run has gone, or when it last moved. */
function when(card: TaskCardData, live: boolean): string {
  if (card.task.status === 'awaiting_approval') return `Waiting ${age(card.lastEventAt)}`;
  if (live && card.lastRun) return `Running ${age(card.lastRun.startedAt)}`;
  return `Updated ${age(card.lastEventAt)} ago`;
}

export function TaskCard({ card, all }: { card: TaskCardData; all?: Map<string, CardTask> }) {
  const { task, lastRun } = card;
  const modelSummary = useModelSummary(card);
  const tasks = all ?? new Map<string, CardTask>();
  // a split task lists its subtasks in order, each with what it waits for: the dependency line (R-036)
  const children = [...tasks.values()].filter((t) => t.parent === task.id).sort((a, b) => a.id.localeCompare(b.id));
  const agents = (card.agents ?? []).map((a) => agentOf(a.adapter, a.host, a.model));
  const live = !!lastRun && !lastRun.endedAt;
  // the agent at work now; else the last one that built the change (the reviewer only reads it), and how many others took part
  const builder = [...(card.agents ?? [])].reverse().find((a) => a.role === 'implementer');
  const latest = live && lastRun?.adapter ? agentOf(lastRun.adapter, lastRun.host, lastRun.model) : builder ? agentOf(builder.adapter, builder.host, builder.model) : agents.at(-1);
  const others = latest ? agents.filter((a) => a.name !== latest.name).length : 0;
  const gate = task.status === 'awaiting_approval';
  const summary = modelSummary ?? card.summary;
  const tests = card.verification ?? null;
  return (
    <article
      data-testid="task-card"
      data-task={task.id}
      className={cx('relative flex flex-col gap-2.5 p-3.5 rounded-[5px] border bg-panel', gate ? 'border-amber' : 'border-rule hover:border-rule-strong')}
    >
      <div className="flex items-center justify-between gap-2 min-w-0 text-small text-ink-2">
        <span className="font-mono">{task.id}</span>
        {task.status === 'done' ? <StatusChip label="merged" tone="merged" /> : <StatusChip status={task.status} />}
      </div>
      <h3 className="font-semibold">
        {/* the title's link covers the card, so the whole card opens the task; the controls on it sit above */}
        <Link to={`/t/${task.id}`} className="no-underline hover:underline after:absolute after:inset-0 after:rounded-[5px]">
          {task.title}
        </Link>
      </h3>
      {summary ? (
        <p className="text-small text-ink-2 line-clamp-2" data-testid="card-summary" data-source={modelSummary ? 'model' : 'agent.message'}>
          {summary}
        </p>
      ) : (
        <p className="text-small text-ink-2 line-clamp-2">{task.goal}</p>
      )}
      {card.autopilot?.on ? (
        <div className="flex flex-wrap items-center gap-2 min-w-0 text-small" data-testid="autopilot-chip">
          <StatusChip label={card.autopilot.queued ? 'queued' : `autopilot: ${card.autopilot.step}`} tone={card.autopilot.queued ? 'neutral' : 'active'} />
          {card.autopilot.reason ? <span className="text-ink-2 truncate">{card.autopilot.reason}</span> : null}
        </div>
      ) : null}
      {task.parent || task.dependsOn?.length ? (
        <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2" data-testid="task-family">
          {task.parent ? (
            <span>
              Part of <span className="font-mono">{task.parent}</span>
            </span>
          ) : null}
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
        </p>
      ) : null}
      {children.length ? (
        <ol className="flex flex-col gap-1 border-l border-rule-strong pl-2.5 text-small" data-testid="subtasks" aria-label={`${children.length} subtasks`}>
          {children.map((c) => (
            <li key={c.id} className="flex items-baseline gap-2 min-w-0" data-subtask={c.id}>
              <span className="font-mono text-ink-2 shrink-0">{c.id}</span>
              <span className="truncate">{c.title}</span>
              <span className="ml-auto shrink-0 text-ink-2">{standing(c, tasks)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {tests ? (
        <p className={cx('text-small font-medium tabular', tests.status === 'green' ? 'text-green' : 'text-red')} data-testid="card-tests">
          {testsLine(tests)}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-1.5 text-small text-ink-2" data-testid="card-agents">
        {latest ? (
          <>
            <Who agent={latest} live={live} className={live ? 'font-semibold text-ink' : undefined} />
            {others ? <span className="text-ink-3">and {others} more</span> : null}
          </>
        ) : (
          <span className="text-ink-3">{['done', 'approved', 'abandoned'].includes(card.task.status) ? 'No runs recorded.' : 'No run yet.'}</span>
        )}
      </p>
      <div className="flex items-baseline justify-between gap-2 text-small text-ink-2">
        <span>{when(card, live)}</span>
        <b className={cx('font-semibold', card.cost.usd ? 'text-ink' : 'text-ink-2')}>
          <CostMeter cost={card.cost} />
        </b>
      </div>
      {gate ? (
        <Link to={`/t/${task.id}`} className="relative z-10 inline-flex items-center justify-center h-8 px-2.5 rounded-[5px] border border-ink bg-ink text-on-ink text-small font-semibold no-underline hover:bg-ink-2 hover:border-ink-2">
          Review and approve
        </Link>
      ) : null}
    </article>
  );
}
