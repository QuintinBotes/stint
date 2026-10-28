import type { TaskStatus } from '@stint-dev/core';
import { toast } from 'sonner';
import { type TaskCardData, api, daemonMessage } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard } from '../components/TaskCard';
import { Button, EmptyState, Kbd, cx } from '../components/ui';
import { useTasks } from '../hooks';

/**
 * The lanes in the order a task moves, Needs you first. `verb` says the lane in the board's sentence, one task then
 * several; `empty` says what will appear in an empty lane; `hideEmpty` drops the lane while it is empty (pull request mode only).
 */
const LANES: Array<{ id: string; title: string; verb: [string, string]; empty: string; statuses: TaskStatus[]; hideEmpty?: boolean }> = [
  { id: 'needs-you', title: 'Needs you', verb: ['needs you', 'need you'], empty: 'Nothing needs you. A task comes here when it waits for your approval or is sent back.', statuses: ['awaiting_approval', 'rejected'] },
  { id: 'planned', title: 'Planned', verb: ['is planned', 'are planned'], empty: 'Nothing planned. A new task waits here until an agent takes it.', statuses: ['planned'] },
  { id: 'building', title: 'Building', verb: ['is building', 'are building'], empty: 'Nothing building. A task moves here when an agent starts a run.', statuses: ['building'] },
  { id: 'verifying', title: 'Verifying', verb: ['is verifying', 'are verifying'], empty: "Nothing verifying. The daemon runs each task's tests here when a run ends.", statuses: ['verifying'] },
  { id: 'reviewing', title: 'Reviewing', verb: ['is being reviewed', 'are being reviewed'], empty: 'Nothing in review. A review starts only after a green verification.', statuses: ['reviewing'] },
  { id: 'in-review', title: 'In review', verb: ['waits on its pull request', 'wait on their pull requests'], empty: '', statuses: ['in_review'], hideEmpty: true },
  { id: 'done', title: 'Done', verb: ['is done', 'are done'], empty: 'Nothing done yet. A task lands here once you approve and merge it.', statuses: ['approved', 'done', 'abandoned'] },
];

const named = (ids: string[]) => (ids.length > 3 ? `${ids.length} tasks` : ids.length === 1 ? ids[0] : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`);

/** One sentence that says where the tasks stand, lane by lane. */
export function boardSentence(cards: TaskCardData[]): string {
  if (cards.length === 0) return 'No tasks yet. Press n to create one.';
  return LANES.flatMap((l) => {
    const ids = cards.filter((c) => l.statuses.includes(c.task.status)).map((c) => c.task.id);
    return ids.length ? [`${named(ids)} ${l.verb[ids.length === 1 ? 0 : 1]}.`] : [];
  }).join(' ');
}

export function Board({ onNewTask }: { onNewTask?: () => void }) {
  const { data, error } = useTasks();
  if (error) return <p className="p-6 text-red">The daemon did not answer: {error}. Check that stint up is running, then reload.</p>;
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const lanes = LANES.filter((l) => !l.hideEmpty || cards.some((c) => l.statuses.includes(c.task.status)));
  const planned = cards.filter((c) => c.task.status === 'planned').length;
  return (
    <main className="relative flex-1 min-h-0 overflow-auto">
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 pt-5 pb-8 md:pt-7 md:pb-10 flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-[900px] min-w-0">
            <h1 className="text-title">Board</h1>
            <p className="text-ink-2">{data ? boardSentence(cards) : 'Reading the tasks from the daemon.'}</p>
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
              <Button tone="primary" onClick={onNewTask} data-testid="new-task">
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
        <ul data-testid="board" aria-label="Tasks by state" className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4 items-start">
          {lanes.map((lane) => {
            const inLane = cards.filter((c) => lane.statuses.includes(c.task.status));
            const gate = lane.id === 'needs-you';
            return (
              <li key={lane.id} data-testid={`lane-${lane.id}`} className="flex flex-col gap-2.5 min-w-0">
                <div className={cx('flex items-center justify-between gap-2 min-h-9 px-0.5 border-b', gate ? 'border-amber' : 'border-rule-strong')}>
                  <h2 className={cx('font-semibold', gate && 'text-amber')}>{lane.title}</h2>
                  <span className="text-ink-3">{inLane.length}</span>
                </div>
                {inLane.length ? (
                  <ol className="flex flex-col gap-2.5">
                    {inLane.map((c) => (
                      <li key={c.task.id}>
                        <TaskCard card={c} all={all} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="p-3.5 rounded-[5px] border border-dashed border-rule-strong text-small text-ink-2">{lane.empty}</p>
                )}
              </li>
            );
          })}
        </ul>
        {data && data.length === 0 ? <EmptyState>Press n to create a task, or run stint demo to replay one.</EmptyState> : null}
      </div>
    </main>
  );
}
