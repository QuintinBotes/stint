import type { Limits, TaskStatus } from '@stint-dev/core';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { type Health, type PendingItem, type PendingPermission, type TaskCardData, api, daemonMessage } from '../api';
import { money } from '../format';
import { IntakePanel } from '../components/Intake';
import { TaskCard, stoppedForYou, waitsFor } from '../components/TaskCard';
import { Button, EmptyState, Explain, Kbd, StateMark, cx } from '../components/ui';
import { type Loadable, useDecisions, usePermissions, useTasks } from '../hooks';

type Group = { id: string; title: string; none: string; empty: string; statuses: TaskStatus[] };

/** The four groups in order, Needs you first. The backend statuses stay as they are; a group only gathers them. An empty group says it is empty (`none`), then what will appear in it (`empty`). */
const GROUPS: Group[] = [
  { id: 'needs-you', title: 'Needs you', none: 'Nothing needs you.', empty: 'A task waits here for your approval, after you send it back, or when autopilot stops to ask you.', statuses: ['awaiting_approval', 'rejected'] },
  { id: 'planned', title: 'Planned', none: 'Nothing planned.', empty: 'A new task waits here until an agent takes it or autopilot starts it.', statuses: ['planned'] },
  { id: 'in-progress', title: 'In progress', none: 'Nothing in progress.', empty: 'A task is here while an agent builds it, Stint tests it, a second model reviews it, or its pull request waits.', statuses: ['building', 'verifying', 'reviewing', 'in_review'] },
  { id: 'closed', title: 'Closed', none: 'Nothing closed yet.', empty: 'A task lands here once it is merged, approved or abandoned.', statuses: ['approved', 'done', 'abandoned'] },
];

/** Each task an agent's permission question waits on, by task id: its run is blocked until you answer. */
type Asks = Map<string, PendingPermission>;
const askedBy = (permissions: PendingPermission[] | null): Asks => new Map((permissions ?? []).map((p) => [p.task, p]));
const needsYouNow = (c: TaskCardData, asks: Asks) => stoppedForYou(c) || asks.has(c.task.id);
const inGroup = (g: Group, c: TaskCardData, asks: Asks) => (needsYouNow(c, asks) ? g.id === 'needs-you' : g.statuses.includes(c.task.status));
const groupOf = (cards: TaskCardData[], id: string, asks: Asks) => cards.filter((c) => inGroup(GROUPS.find((g) => g.id === id) as Group, c, asks));

/** Something executes for the task: a run with no end, or Stint verifying or reviewing it. A building task with no live run, or a pull request waiting, is not running. */
const running = (c: TaskCardData) => (!!c.lastRun && !c.lastRun.endedAt) || c.task.status === 'verifying' || c.task.status === 'reviewing';

/** Why a task in Needs you is there, in words: the reasons the group gathers. */
function needsYouFor(c: TaskCardData, asks: Asks): string {
  const ask = asks.get(c.task.id);
  if (ask) return `has an agent waiting for your permission to use ${ask.tool}`;
  if (stoppedForYou(c)) return 'autopilot stopped and asks you';
  return c.task.status === 'rejected' ? 'was rejected and waits for you to hand it on or leave it' : 'waits for your approval';
}

/** What needs you now, as one sentence: each task and its reason, the first three by name. */
export function attentionLine(cards: TaskCardData[], asks: Asks): string {
  const here = groupOf(cards, 'needs-you', asks);
  if (!here.length) return 'Nothing needs you right now.';
  const named = here.slice(0, 3).map((c) => `${c.task.id} ${needsYouFor(c, asks)}`);
  const more = here.length - named.length;
  return `${named.join('; ')}${more ? `; and ${more} more` : ''}.`;
}

function Count({ id, label, n, shape, alert = false }: { id: string; label: string; n: number; shape: 'attention' | 'running' | 'waiting'; alert?: boolean }) {
  return (
    <li data-count={id} className="inline-flex items-center gap-2">
      <StateMark shape={shape} className={alert && n ? 'text-amber' : 'text-ink-3'} />
      <span>{label}</span>
      <b className="font-semibold text-ink tabular">{n}</b>
    </li>
  );
}

/** Where the tasks stand in counts, and apart from them the decisions that wait: a decision is not a task, so it is never in a task count. */
function Summary({ cards, decisions, asks }: { cards: TaskCardData[]; decisions: Loadable<PendingItem[]>; asks: Asks }) {
  const items = decisions.data;
  const on = [...new Set((items ?? []).map((d) => d.task))];
  return (
    <ul data-testid="board-summary" aria-label="Summary" className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-small text-ink-2">
      <Count id="needs-you" label="Needs you" n={groupOf(cards, 'needs-you', asks).length} shape="attention" alert />
      <Count id="running" label="Running" n={cards.filter(running).length} shape="running" />
      <Count id="planned" label="Planned" n={groupOf(cards, 'planned', asks).length} shape="waiting" />
      <li data-count="decisions" className="inline-flex flex-wrap items-center gap-x-2 sm:pl-6 sm:border-l sm:border-rule">
        {items ? (
          <>
            <span>Decisions waiting</span>
            <b className="font-semibold text-ink tabular">{items.length}</b>
            {on.length ? (
              <span>
                on{' '}
                {on.map((id, i) => (
                  <Fragment key={id}>
                    {i ? ', ' : ''}
                    <Link to={`/t/${id}`} className="font-mono text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
                      {id}
                    </Link>
                  </Fragment>
                ))}
              </span>
            ) : null}
          </>
        ) : (
          <span title={decisions.error ?? undefined}>{decisions.error ? 'Decisions could not be read' : 'Reading decisions'}</span>
        )}
      </li>
    </ul>
  );
}

/**
 * What the planned tasks' limits allow, for the Run all confirmation: the most builds any may use and which have no
 * spend limit, so their model calls are not capped. Null limits are no limit.
 */
export function limitsLine(limits: Limits[]): string {
  const n = limits.length;
  const builds = limits.map((l) => l.builds);
  const most = builds.every((b) => b !== null) ? Math.max(...(builds as number[])) : null;
  const buildWords = most === null ? 'Some have no build limit.' : `Each stops after at most ${most} build${most === 1 ? '' : 's'}.`;
  const open = limits.filter((l) => l.usd === null).length;
  const spend =
    open === n
      ? n === 1
        ? 'It has no spend limit, so its model calls are not capped.'
        : 'None has a spend limit, so their model calls are not capped.'
      : open
        ? `${open} of ${n} have no spend limit, so their model calls are not capped.`
        : `Spend is capped at ${money({ usd: limits.reduce((sum, l) => sum + (l.usd ?? 0), 0) })} across them.`;
  return `${buildWords} ${spend}`;
}

const list = (ids: string[]) => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : (ids[0] ?? ''));

/**
 * The one next action, filled: review the task that has waited longest, else run what is planned, else make a task.
 * Run all starts paid work on every planned task at once, so the first press says what it would start and under which
 * limits, and only Start does it. The palette's Run all opens the same question here (`?run=all`).
 */
function Actions({ cards, health, onNewTask }: { cards: TaskCardData[]; health: Health | null; onNewTask?: () => void }) {
  // no run has started on a planned task, so no permission question can wait on one
  const none: Asks = new Map();
  const [starting, setStarting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [limits, setLimits] = useState<Limits[] | 'error' | null>(null);
  const busy = useRef(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // closing the question puts focus back on Run all, as the gate's forms do
  const close = () => {
    setAsking(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const [params, setParams] = useSearchParams();
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const review = cards.filter((c) => c.task.status === 'awaiting_approval').sort((a, b) => a.lastEventAt.localeCompare(b.lastEventAt))[0];
  const planned = groupOf(cards, 'planned', none);
  const now = planned.filter((c) => waitsFor(c.task, all).length === 0).map((c) => c.task.id);
  const later = planned.filter((c) => waitsFor(c.task, all).length > 0).map((c) => c.task.id);
  const replay = health?.mode === 'replay';
  const canRun = !replay && now.length > 0;
  const why = replay ? 'Not in the replay: nothing runs here.' : now.length ? null : 'Each planned task waits on another that is not merged yet.';
  const ids = planned.map((c) => c.task.id).join(',');
  const ask = () => {
    if (!canRun) return;
    setAsking(true);
    setLimits(null);
    requestAnimationFrame(() => confirm.current?.focus());
    void Promise.all(planned.map((c) => api.limits(c.task.id).then((m) => m.limits)))
      .then(setLimits)
      .catch(() => setLimits('error'));
  };
  // the palette's Run all lands here and asks, once
  const fromPalette = params.get('run') === 'all';
  useEffect(() => {
    if (!fromPalette || !ids) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('run');
      return next;
    }, { replace: true });
    ask();
  }, [fromPalette, ids]);
  const runAll = () => {
    if (busy.current) return;
    busy.current = true;
    setStarting(true);
    void api
      .autopilotAll(true)
      .then((r) => toast.success(`${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'} on autopilot`))
      .catch((e: unknown) => toast.error(`Autopilot did not start: ${daemonMessage(e)}`))
      .finally(() => {
        busy.current = false;
        setStarting(false);
        close();
      });
  };
  const n = planned.length;
  const tasks = `${n} task${n === 1 ? '' : 's'}`;
  return (
    <div
      className="flex flex-col gap-2 lg:items-end lg:max-w-[46ch]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && asking && !starting) close();
      }}
    >
      <div className="stint-actions lg:justify-end">
        {review ? (
          <Link to={`/t/${review.task.id}`} className="stint-button stint-button--primary" data-testid="review-next">
            Review {review.task.id}
          </Link>
        ) : null}
        {n && asking ? (
          <>
            <Button ref={confirm} tone="primary" aria-busy={starting} aria-disabled={starting} aria-describedby="run-all-what" onClick={runAll} data-testid="run-all-confirm">
              {starting ? 'Starting autopilot' : `Start ${tasks}`}
            </Button>
            <Button tone="ghost" disabled={starting} onClick={close} data-testid="run-all-cancel">
              Cancel
            </Button>
          </>
        ) : n ? (
          <Button ref={opener} tone={!review && canRun ? 'primary' : 'quiet'} aria-disabled={!canRun} aria-describedby="run-all-what" onClick={ask} data-testid="run-all">
            Run {n === 1 ? 'the planned task' : `all ${n} planned`}
          </Button>
        ) : null}
        {onNewTask && !asking ? (
          <Button tone={!review && !canRun ? 'primary' : 'quiet'} onClick={onNewTask} aria-keyshortcuts="n" data-testid="new-task">
            New task <Kbd>n</Kbd>
          </Button>
        ) : null}
      </div>
      {n && asking ? (
        <p id="run-all-what" role="status" className="stint-field-help max-w-[60ch] text-ink lg:text-right" data-testid="run-all-ask">
          Autopilot plans, builds, tests and reviews {now.length === n ? (n === 1 ? 'it' : `all ${n}`) : `${list(now)} now, and ${list(later)} once the tasks ${later.length === 1 ? 'it waits' : 'they wait'} on are merged`}, then stops for your approval. Nothing is merged without you.{' '}
          <span data-testid="run-all-limits">{limits === null ? 'Reading their limits.' : limits === 'error' ? 'Their limits could not be read; each keeps the limits it has.' : limitsLine(limits)}</span>
        </p>
      ) : n ? (
        <p id="run-all-what" className="stint-field-help max-w-[60ch] lg:text-right">
          Puts every planned task on autopilot, which plans, builds, tests and reviews it, then stops for your approval. A task that waits on another starts only once that one is merged.
          {why ? <span className="block mt-1 text-ink-2">{why}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function Board({ onNewTask, health }: { onNewTask?: () => void; health: Health | null }) {
  const { data, error, reload } = useTasks();
  const decisions = useDecisions();
  const asks = askedBy(usePermissions().data);
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  return (
    <main className="relative flex-1 min-h-0 overflow-auto">
      <div className="stint-page">
        <header className="stint-page-header">
          <div className="stint-page-heading">
            <h1 className="stint-page-title">Board</h1>
            {data ? (
              <>
                {/* the answer to "does anything need me?" in words, before the counts */}
                <p data-testid="board-attention" className="mt-2 flex items-start gap-2 text-ink max-w-[70ch]">
                  {groupOf(cards, 'needs-you', asks).length ? <StateMark shape="attention" className="mt-[5px] text-amber" /> : null}
                  <span>{attentionLine(cards, asks)}</span>
                </p>
                <Summary cards={cards} decisions={decisions} asks={asks} />
              </>
            ) : null}
            <Explain word="task" className="mt-3" />
          </div>
          <Actions cards={cards} health={health} onNewTask={onNewTask} />
        </header>
        {error ? (
          // the first read failed: say so, never an empty board; a later one failed: keep the tasks and say they may be old
          <div role="alert" className={cx('stint-notice', data ? 'stint-notice--attention' : 'stint-notice--error')} data-testid={data ? 'board-stale' : 'board-error'}>
            <p className="flex items-start gap-2">
              <StateMark shape={data ? 'attention' : 'failed'} className={cx('mt-1', data ? 'text-amber' : 'text-red')} />
              <span>{data ? `This board may be out of date: the last refresh failed (${error}). It shows the tasks as Stint last reported them.` : `Stint did not answer: ${error}. Check that stint up is running.`}</span>
            </p>
            <Button onClick={reload}>Try again</Button>
          </div>
        ) : null}
        <IntakePanel tasks={cards} />
        {data ? (
          <>
            {data.length === 0 ? <EmptyState>No tasks yet. Press n to make one, or run stint demo to replay a recorded one.</EmptyState> : null}
            <ul data-testid="board" aria-label="Tasks by state" className="stint-board">
              {GROUPS.map((g) => {
                const here = cards.filter((c) => inGroup(g, c, asks));
                return (
                  <li key={g.id} data-testid={`lane-${g.id}`} className={cx('stint-lane', g.id === 'needs-you' && here.length > 0 && 'stint-lane--attention')}>
                    <div className="stint-lane-header">
                      <h2 className="stint-lane-title">{g.title}</h2>
                      <span className="stint-lane-count">
                        {here.length} task{here.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {here.length ? (
                      <ol className="stint-lane-items">
                        {here.map((c) => (
                          <li key={c.task.id}>
                            <TaskCard card={c} all={all} asks={asks.get(c.task.id)} />
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="stint-lane-empty">
                        <span className="block text-ink-2">{g.none}</span>
                        {g.empty}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : error ? null : (
          <p role="status" className="text-ink-2" data-testid="board-loading">
            Reading the tasks.
          </p>
        )}
      </div>
    </main>
  );
}
