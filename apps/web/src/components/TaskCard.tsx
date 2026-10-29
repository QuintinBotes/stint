import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { agentOf } from '../agents';
import { type PendingPermission, type TaskCardData, api } from '../api';
import { age } from '../format';
import { CostMeter, StateMark, StatusChip, Who, cx } from './ui';

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

/** The local model's card line when there is one, asked for after the board has drawn. A task no run has started has nothing to summarise, so nothing is asked. */
function useModelSummary(card: TaskCardData): string | null {
  const key = `${card.task.id}@${card.lastEventAt}`;
  const ran = !!card.lastRun;
  const [summary, setSummary] = useState<string | null>(() => (ran ? (modelSummaries.get(key) ?? null) : null));
  useEffect(() => {
    if (!ran) {
      setSummary(null);
      return;
    }
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
  }, [key, card.task.id, ran]);
  return summary;
}

const CLOSED = ['approved', 'done', 'abandoned'];

/** A task autopilot stopped to ask you, at a limit or anywhere else, needs you whatever its status says, until a run starts again. */
export const stoppedForYou = (c: TaskCardData) => !!c.autopilot?.needsYou && !CLOSED.includes(c.task.status) && !(c.lastRun && !c.lastRun.endedAt);

/** The tasks this one waits on that are not merged yet; autopilot starts it only once there are none (R-036). */
export const waitsFor = (t: CardTask, all: Map<string, CardTask>) => (t.dependsOn ?? []).filter((d) => all.get(d)?.status !== 'done');

/** "criterion 1", "criteria 1 and 2", "criteria 1, 2 and 3" */
export function criteriaWords(n: number[]): string {
  const list = n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : String(n[0] ?? '');
  return `criteri${n.length === 1 ? 'on' : 'a'} ${list}`;
}

/** The goal a task is part of and the criteria it covers, linked to the goal: "Part of G-0001, covers criteria 1 and 2". */
export function GoalOf({ task, className }: { task: Pick<CardTask, 'goalId' | 'goalCriteria'>; className?: string }) {
  if (!task.goalId) return null;
  return (
    <span data-testid="task-goal" className={className}>
      Part of{' '}
      <Link to={`/goals/${task.goalId}`} className="relative z-10 font-mono text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
        {task.goalId}
      </Link>
      {task.goalCriteria?.length ? `, covers ${criteriaWords(task.goalCriteria)}` : ''}
    </span>
  );
}

/** How a task in the same split stands: merged, or its status, or what it still waits for. */
function standing(t: CardTask, all: Map<string, CardTask>): string {
  if (t.status === 'done') return 'merged';
  const open = waitsFor(t, all);
  return open.length ? `waits for ${open.join(', ')}` : t.status.replace('_', ' ');
}

/** What the card's foot says about time: how long it has waited for you, how long the live run has gone, or when it last moved. */
function when(card: TaskCardData, live: boolean): string {
  if (card.task.status === 'awaiting_approval') return `Waiting ${age(card.lastEventAt)}`;
  if (live && card.lastRun) return `Running ${age(card.lastRun.startedAt)}`;
  return `Updated ${age(card.lastEventAt)} ago`;
}

/** The card's one label. Merged and stopped-for-you say so; a building task with no run going waits rather than runs, so it never claims work is happening. */
function MainStatus({ card, live, asks }: { card: TaskCardData; live: boolean; asks: boolean }) {
  const { status } = card.task;
  if (status === 'done') return <StatusChip status="done" label="merged" />;
  if (asks) return <StatusChip status={status} label="asks permission" tone="warn" />;
  if (stoppedForYou(card)) return <StatusChip status={status} label="needs you" tone="warn" />;
  if (status === 'building' && !live) return <StatusChip status="building" tone="neutral" shape="waiting" />;
  return <StatusChip status={status} />;
}

export function TaskCard({ card, all, asks }: { card: TaskCardData; all?: Map<string, CardTask>; asks?: PendingPermission | undefined }) {
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
  const needsYou = gate || task.status === 'rejected' || stoppedForYou(card) || !!asks;
  const summary = modelSummary ?? card.summary;
  const tests = card.verification ?? null;
  const blocked = task.status === 'planned' ? waitsFor(task, tasks) : [];
  // a task that never ran claims no cost; a priced zero after a run is real, and an unpriced one says unpriced
  const showCost = !!lastRun || card.cost.usd !== 0;
  // one line under the label: what holds the task up, else what was last said about it, labelled as such, else its goal
  const line = asks ? (
    <p className="stint-task-description" data-testid="card-blocker">
      An agent waits for your permission to use {asks.tool}
      {asks.title ? `: ${asks.title}` : ''}. Open the task to answer.
    </p>
  ) : stoppedForYou(card) && card.autopilot?.reason ? (
    <p className="stint-task-description" data-testid="card-blocker">
      Autopilot stopped: {card.autopilot.reason}
    </p>
  ) : blocked.length ? (
    <p className="stint-task-description" data-testid="card-blocker">
      Waits for <span className="font-mono">{blocked.join(', ')}</span> to be merged before it starts.
    </p>
  ) : card.autopilot?.on && card.autopilot.queued && card.autopilot.reason ? (
    <p className="stint-task-description" data-testid="card-blocker">
      Autopilot: {card.autopilot.reason}
    </p>
  ) : summary ? (
    <p className="stint-task-description line-clamp-2" data-testid="card-summary" data-source={modelSummary ? 'model' : 'agent.message'}>
      <span className="font-medium">{modelSummary ? 'Summary: ' : 'Last message: '}</span>
      {summary}
    </p>
  ) : (
    <p className="stint-task-description line-clamp-2">{task.goal}</p>
  );
  return (
    <article data-testid="task-card" data-task={task.id} className={cx('stint-task-card', needsYou && 'stint-task-card--attention')}>
      <h3 className="stint-task-heading">
        <span className="stint-task-id">{task.id}</span>
        {/* the title's link covers the card, so the whole card opens the task; the controls on it sit above */}
        <Link to={`/t/${task.id}`} className="no-underline hover:underline after:absolute after:inset-0 after:rounded-[5px]">
          {task.title}
        </Link>
      </h3>
      <MainStatus card={card} live={live} asks={!!asks} />
      {line}
      {task.parent || task.dependsOn?.length || task.goalId ? (
        <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-3" data-testid="task-family">
          <GoalOf task={task} />
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
              <span className="font-mono text-ink-3 shrink-0">{c.id}</span>
              <span className="truncate">{c.title}</span>
              <span className="ml-auto shrink-0 text-ink-3">{standing(c, tasks)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {tests ? (
        <p className={cx('stint-task-evidence flex items-center gap-1.5 tabular', tests.status !== 'green' && 'text-red')} data-testid="card-tests">
          <StateMark shape={tests.status === 'green' ? 'verified' : 'failed'} />
          {testsLine(tests)}
        </p>
      ) : null}
      <div className="stint-task-footer">
        <span className="flex flex-wrap items-center gap-x-1.5 min-w-0" data-testid="card-agents">
          {latest ? (
            <>
              <Who agent={latest} live={live} className={live ? 'font-semibold text-ink' : 'text-ink-2'} />
              {others ? <span>and {others} more</span> : null}
            </>
          ) : (
            <span>{CLOSED.includes(task.status) ? 'No runs recorded' : 'No run yet'}</span>
          )}
          {card.autopilot?.on ? <span>, on autopilot</span> : null}
        </span>
        <span className="flex items-baseline gap-3">
          <span>{when(card, live)}</span>
          {showCost ? <CostMeter cost={card.cost} className={card.cost.usd ? 'text-ink-2' : undefined} /> : null}
        </span>
      </div>
      {gate ? (
        <Link to={`/t/${task.id}`} className="stint-button stint-button--primary relative z-10 self-start min-h-8 no-underline">
          Review and approve
        </Link>
      ) : null}
    </article>
  );
}
