import type { TaskStatus } from '@stint-dev/core';
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type PendingItem, type TaskCardData, api, daemonMessage } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard } from '../components/TaskCard';
import { Button, EmptyState, Explain, Kbd, cx } from '../components/ui';
import { useTasks } from '../hooks';

type Lane = { id: string; title: string; verb: [string, string]; empty: string; statuses: TaskStatus[]; hideEmpty?: boolean };

/**
 * The lanes in the order a task moves, Needs you first. `verb` says the lane in the board's sentence, one task then
 * several; `empty` says what will appear in an empty lane; `hideEmpty` drops the lane while it is empty (pull request mode only).
 */
const LANES: Lane[] = [
  { id: 'needs-you', title: 'Needs you', verb: ['needs you', 'need you'], empty: 'A task waits here for your approval, or after you send it back.', statuses: ['awaiting_approval', 'rejected'] },
  { id: 'planned', title: 'Planned', verb: ['is planned', 'are planned'], empty: 'A new task waits here for an agent.', statuses: ['planned'] },
  { id: 'building', title: 'Building', verb: ['is being built', 'are being built'], empty: 'A task is here while an agent works on it.', statuses: ['building'] },
  { id: 'verifying', title: 'Verifying', verb: ['is being tested', 'are being tested'], empty: 'A task is here while Stint runs its tests.', statuses: ['verifying'] },
  { id: 'reviewing', title: 'Reviewing', verb: ['is being reviewed', 'are being reviewed'], empty: 'A task is here while a second model reviews it.', statuses: ['reviewing'] },
  { id: 'in-review', title: 'In review', verb: ['waits on its pull request', 'wait on their pull requests'], empty: '', statuses: ['in_review'], hideEmpty: true },
  { id: 'done', title: 'Done', verb: ['is done', 'are done'], empty: 'A task lands here once you approve and merge it.', statuses: ['approved', 'done', 'abandoned'] },
];

/** Task ids as links, joined as a sentence says them; past three, the first and a count, so the next one is still one click away. */
function Ids({ ids }: { ids: string[] }) {
  const link = (id: string) => (
    <Link key={id} to={`/t/${id}`} className="font-mono text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
      {id}
    </Link>
  );
  if (ids.length > 3) return <>{link(ids[0] as string)} and {ids.length - 1} more tasks</>;
  return ids.map((id, i) => (
    <Fragment key={id}>
      {i === 0 ? '' : i === ids.length - 1 ? ' and ' : ', '}
      {link(id)}
    </Fragment>
  ));
}

/** One sentence that says where the tasks stand, lane by lane; the decisions that wait on a task come right after what needs you. */
function BoardSentence({ cards, decisions }: { cards: TaskCardData[]; decisions: PendingItem[] }) {
  if (cards.length === 0) return <>No tasks yet.</>;
  const parts = LANES.flatMap((l) => {
    const ids = cards.filter((c) => l.statuses.includes(c.task.status)).map((c) => c.task.id);
    return ids.length ? [<Fragment key={l.id}><Ids ids={ids} /> {l.verb[ids.length === 1 ? 0 : 1]}.{' '}</Fragment>] : [];
  });
  const on = [...new Set(decisions.map((d) => d.task))];
  if (on.length) {
    const decided = <Fragment key="decisions">{decisions.length} decision{decisions.length === 1 ? ' waits' : 's wait'} on <Ids ids={on} />.{' '}</Fragment>;
    parts.splice(parts[0]?.key === 'needs-you' ? 1 : 0, 0, decided);
  }
  return <>{parts}</>;
}

/** Decisions that wait on a task, read from the memory queue: a finding that contradicts a decision, or a rename to follow. */
function useDecisions(): PendingItem[] {
  const [items, setItems] = useState<PendingItem[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .pending()
        .then((p) => live && setItems(p.filter((x) => x.kind !== 'skill')))
        .catch(() => live && setItems([]));
    load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return items;
}

export function Board({ onNewTask }: { onNewTask?: () => void }) {
  const { data, error } = useTasks();
  const decisions = useDecisions();
  if (error) return <p className="p-6 text-red">Stint did not answer: {error}. Check that stint up is running, then reload.</p>;
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const planned = cards.filter((c) => c.task.status === 'planned').length;
  // a lane with tasks takes the room; a run of empty lanes folds into one narrow column, still in the order a task moves
  const columns: Array<{ lane: Lane; cards: TaskCardData[] } | { empty: Lane[] }> = [];
  for (const lane of LANES) {
    const inLane = cards.filter((c) => lane.statuses.includes(c.task.status));
    const last = columns.at(-1);
    if (inLane.length) columns.push({ lane, cards: inLane });
    else if (lane.hideEmpty) continue;
    else if (last && 'empty' in last) last.empty.push(lane);
    else columns.push({ empty: [lane] });
  }
  return (
    <main className="relative flex-1 min-h-0 overflow-auto">
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-5 pb-8 md:pt-7 md:pb-10 flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-[75ch] min-w-0">
            <h1 className="text-title">Board</h1>
            <p data-testid="board-sentence">{data ? <BoardSentence cards={cards} decisions={decisions} /> : 'Reading the tasks.'}</p>
            <p className="text-small text-ink-2">A task moves through these lanes in order: an agent builds it, Stint runs its tests, a second model reviews it, then it waits for you.</p>
            <Explain word="task" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              disabled={planned === 0}
              aria-describedby={planned ? undefined : 'run-all-why'}
              onClick={() => void api.autopilotAll(true).then((r) => toast.success(`${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'} on autopilot`)).catch((e: unknown) => toast.error(`Autopilot did not start: ${daemonMessage(e)}`))}
              data-testid="run-all"
            >
              Run all planned
            </Button>
            {onNewTask ? (
              <Button tone="primary" onClick={onNewTask} aria-keyshortcuts="n" data-testid="new-task">
                New task <Kbd>n</Kbd>
              </Button>
            ) : null}
            {planned ? null : (
              <span id="run-all-why" className="basis-full text-right text-small text-ink-2">
                No planned tasks to run.
              </span>
            )}
          </div>
        </header>
        <IntakePanel tasks={cards} />
        <ul data-testid="board" aria-label="Tasks by state" className="flex flex-wrap items-start gap-4">
          {columns.map((col) =>
            'empty' in col ? (
              <li key={col.empty[0]?.id} className="flex-[1_1_200px] sm:max-w-[220px] min-w-0">
                <ul className="flex flex-col gap-3">
                  {col.empty.map((lane) => (
                    <li key={lane.id} data-testid={`lane-${lane.id}`}>
                      <h2 className="flex items-center min-h-9 border-b border-rule font-semibold text-ink-2">{lane.title}</h2>
                      <p className="pt-1.5 text-small text-ink-3">{lane.empty}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ) : (
              <li key={col.lane.id} data-testid={`lane-${col.lane.id}`} className="flex-[1_1_260px] max-w-[560px] flex flex-col gap-2.5 min-w-0">
                <div className={cx('flex items-center justify-between gap-2 min-h-9 border-b', col.lane.id === 'needs-you' ? 'border-amber' : 'border-rule-strong')}>
                  <h2 className={cx('font-semibold', col.lane.id === 'needs-you' && 'text-amber')}>{col.lane.title}</h2>
                  <span className="text-small text-ink-3 tabular">
                    {col.cards.length} task{col.cards.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ol className="flex flex-col gap-2.5">
                  {col.cards.map((c) => (
                    <li key={c.task.id}>
                      <TaskCard card={c} all={all} />
                    </li>
                  ))}
                </ol>
              </li>
            ),
          )}
        </ul>
        {data && data.length === 0 ? <EmptyState>Your tasks appear in these lanes once you create one: press n, or run stint demo to replay a recorded one.</EmptyState> : null}
      </div>
    </main>
  );
}
