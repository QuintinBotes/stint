import type { TaskStatus } from '@stint-dev/core';
import { Fragment, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type Health, type PendingItem, type TaskCardData, api, daemonMessage } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard, stoppedForYou, waitsFor } from '../components/TaskCard';
import { Button, EmptyState, Explain, Kbd, StateMark, cx } from '../components/ui';
import { type Loadable, useDecisions, useTasks } from '../hooks';

type Group = { id: string; title: string; empty: string; statuses: TaskStatus[] };

/** The four groups in order, Needs you first. The backend statuses stay as they are; a group only gathers them. `empty` says what will appear in an empty group. */
const GROUPS: Group[] = [
  { id: 'needs-you', title: 'Needs you', empty: 'A task waits here for your approval, after you send it back, or when autopilot stops to ask you.', statuses: ['awaiting_approval', 'rejected'] },
  { id: 'planned', title: 'Planned', empty: 'A new task waits here until an agent takes it or autopilot starts it.', statuses: ['planned'] },
  { id: 'in-progress', title: 'In progress', empty: 'A task is here while an agent builds it, Stint tests it, a second model reviews it, or its pull request waits.', statuses: ['building', 'verifying', 'reviewing', 'in_review'] },
  { id: 'closed', title: 'Closed', empty: 'A task lands here once it is merged, approved or abandoned.', statuses: ['approved', 'done', 'abandoned'] },
];

const inGroup = (g: Group, c: TaskCardData) => (stoppedForYou(c) ? g.id === 'needs-you' : g.statuses.includes(c.task.status));
const groupOf = (cards: TaskCardData[], id: string) => cards.filter((c) => inGroup(GROUPS.find((g) => g.id === id) as Group, c));

/** Something executes for the task: a run with no end, or Stint verifying or reviewing it. A building task with no live run, or a pull request waiting, is not running. */
const running = (c: TaskCardData) => (!!c.lastRun && !c.lastRun.endedAt) || c.task.status === 'verifying' || c.task.status === 'reviewing';

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
function Summary({ cards, decisions }: { cards: TaskCardData[]; decisions: Loadable<PendingItem[]> }) {
  const items = decisions.data;
  const on = [...new Set((items ?? []).map((d) => d.task))];
  return (
    <ul data-testid="board-summary" aria-label="Summary" className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-small text-ink-2">
      <Count id="needs-you" label="Needs you" n={groupOf(cards, 'needs-you').length} shape="attention" alert />
      <Count id="running" label="Running" n={cards.filter(running).length} shape="running" />
      <Count id="planned" label="Planned" n={groupOf(cards, 'planned').length} shape="waiting" />
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

/** The one next action, filled: review the task that has waited longest, else run what is planned, else make a task. */
function Actions({ cards, health, onNewTask }: { cards: TaskCardData[]; health: Health | null; onNewTask?: () => void }) {
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const review = cards.filter((c) => c.task.status === 'awaiting_approval').sort((a, b) => a.lastEventAt.localeCompare(b.lastEventAt))[0];
  const planned = groupOf(cards, 'planned');
  const ready = planned.filter((c) => waitsFor(c.task, all).length === 0).length;
  const replay = health?.mode === 'replay';
  const canRun = !replay && ready > 0;
  const why = replay ? 'Not in the replay: nothing runs here.' : ready ? null : 'Each planned task waits on another that is not merged yet.';
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
      });
  };
  return (
    <div className="flex flex-col gap-2 lg:items-end lg:max-w-[46ch]">
      <div className="stint-actions lg:justify-end">
        {review ? (
          <Link to={`/t/${review.task.id}`} className="stint-button stint-button--primary" data-testid="review-next">
            Review {review.task.id}
          </Link>
        ) : null}
        {planned.length ? (
          <Button tone={!review && canRun ? 'primary' : 'quiet'} aria-disabled={!canRun || starting} aria-busy={starting} aria-describedby="run-all-what" onClick={runAll} data-testid="run-all">
            {starting ? 'Starting autopilot' : 'Run all planned'}
          </Button>
        ) : null}
        {onNewTask ? (
          <Button tone={!review && !canRun ? 'primary' : 'quiet'} onClick={onNewTask} aria-keyshortcuts="n" data-testid="new-task">
            New task <Kbd>n</Kbd>
          </Button>
        ) : null}
      </div>
      {planned.length ? (
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
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  return (
    <main className="relative flex-1 min-h-0 overflow-auto">
      <div className="stint-page">
        <header className="stint-page-header">
          <div className="stint-page-heading">
            <h1 className="stint-page-title">Board</h1>
            {data ? <Summary cards={cards} decisions={decisions} /> : null}
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
                const here = cards.filter((c) => inGroup(g, c));
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
                            <TaskCard card={c} all={all} />
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="stint-lane-empty">{g.empty}</p>
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
