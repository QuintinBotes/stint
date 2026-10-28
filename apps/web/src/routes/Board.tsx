import type { TaskStatus } from '@stint-dev/core';
import { toast } from 'sonner';
import { carNumber } from '../agents';
import { type TaskCardData, api, daemonMessage } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard } from '../components/TaskCard';
import { Button, type ChipTone, EmptyState, Kbd, Swatch, cx } from '../components/ui';
import { useTasks } from '../hooks';

/** The timing tower's groups, in the order a car goes round: the gate first, then the grid, the track, and the flag. */
/**
 * `short` names an empty lane in the one muted line that stands for every empty lane in a row; `hideEmpty` drops the lane
 * altogether while it is empty (pull request mode only).
 */
const LANES: Array<{ id: string; title: string; short: string; flag: ChipTone | null; ink: string; statuses: TaskStatus[]; hideEmpty?: boolean }> = [
  { id: 'needs-you', title: 'Needs you', short: 'waiting for you', flag: 'warn', ink: 'text-yellow', statuses: ['awaiting_approval', 'rejected'] },
  { id: 'planned', title: 'On the grid, planned', short: 'on the grid', flag: null, ink: 'text-ink-2', statuses: ['planned'] },
  { id: 'building', title: 'On track, building', short: 'on track', flag: 'good', ink: 'text-green', statuses: ['building'] },
  { id: 'verifying', title: 'Verifying', short: 'verifying', flag: 'good', ink: 'text-green', statuses: ['verifying'] },
  { id: 'reviewing', title: 'Reviewing', short: 'reviewing', flag: 'good', ink: 'text-green', statuses: ['reviewing'] },
  // only in pull request mode, so it stays out of the way until something is in it
  { id: 'in-review', title: 'In review, a pull request', short: 'in pull request review', flag: 'warn', ink: 'text-yellow', statuses: ['in_review'], hideEmpty: true },
  { id: 'done', title: 'Took the flag, merged', short: 'merged', flag: 'merged', ink: 'text-ink', statuses: ['approved', 'done', 'abandoned'] },
];



const cars = (ids: string[]) => {
  const n = ids.map(carNumber);
  if (n.length === 1) return `Car ${n[0]}`;
  if (n.length <= 3) return `Cars ${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
  return `${n.length} cars`;
};

/** One sentence that says what is going on, from the cars' states. */
export function raceSentence(cards: TaskCardData[]): string {
  if (cards.length === 0) return 'No cars yet. Press n to put a task on the grid.';
  const ids = (statuses: string[]) => cards.filter((c) => statuses.includes(c.task.status)).map((c) => c.task.id);
  const parts: string[] = [];
  const needs = ids(['awaiting_approval', 'rejected']);
  const track = ids(['building', 'verifying', 'reviewing', 'in_review']);
  const grid = ids(['planned']);
  const flag = ids(['done', 'approved']);
  if (needs.length) parts.push(`${cars(needs)} ${needs.length === 1 ? 'needs' : 'need'} your call.`);
  if (track.length) parts.push(`${cars(track)} ${track.length === 1 ? 'is' : 'are'} on track.`);
  if (grid.length) parts.push(`${cars(grid)} ${grid.length === 1 ? 'waits' : 'wait'} on the grid.`);
  if (flag.length) parts.push(`${cars(flag)} took the flag.`);
  return parts.join(' ') || 'Every car is parked.';
}

const COLUMNS = 'lg:grid-cols-[56px_minmax(0,1fr)_160px_200px_88px_72px]';

export function Board({ onNewTask, repo }: { onNewTask?: () => void; repo?: string }) {
  const { data, error } = useTasks();
  if (error) return <p className="p-6 text-red">The daemon did not answer: {error}. Check that stint up is running, then reload.</p>;
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const lanes = LANES.filter((l) => !l.hideEmpty || cards.some((c) => l.statuses.includes(c.task.status)));
  const planned = cards.filter((c) => c.task.status === 'planned').length;
  // runs of empty lanes fold into one muted line each, in their place in the order
  const groups: Array<{ empty: boolean; lanes: typeof lanes }> = [];
  for (const lane of lanes) {
    const empty = !cards.some((c) => lane.statuses.includes(c.task.status));
    const last = groups.at(-1);
    if (empty && last?.empty) last.lanes.push(lane);
    else groups.push({ empty, lanes: [lane] });
  }
  return (
    <main className="relative flex-1 min-h-0 overflow-auto">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-8 pb-8 flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2 max-w-[900px] min-w-0">
            <h1 className="text-[19px] leading-6 sm:text-[34px] sm:leading-10 font-bold stretch-112 tracking-[-0.02em] [text-wrap:balance]">{data ? raceSentence(cards) : 'Reading the timing.'}</h1>
            {repo ? (
              <p className="text-[14px] text-ink-2">
                Timing for <span data-testid="repo-name">{repo}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {onNewTask ? (
              <Button tone="primary" className="h-9 px-4" onClick={onNewTask} data-testid="new-task">
                New task <Kbd>n</Kbd>
              </Button>
            ) : null}
            <Button
              className="h-9 px-4"
              disabled={planned === 0}
              aria-describedby={planned ? undefined : 'run-all-why'}
              onClick={() => void api.autopilotAll(true).then((r) => toast.success(`${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'} on autopilot`)).catch((e: unknown) => toast.error(`Autopilot did not start: ${daemonMessage(e)}`))}
              data-testid="run-all"
            >
              Run all planned
            </Button>
            {planned ? null : (
              <span id="run-all-why" className="basis-full text-right text-[12px] text-ink-2">
                No planned tasks to run.
              </span>
            )}
          </div>
        </header>
        <IntakePanel tasks={cards} />
        <div className="border-t border-rule-strong" data-testid="board" aria-label="Timing tower">
          <div aria-hidden="true" className={cx('hidden lg:grid gap-x-3 px-3 py-3 border-b border-rule text-[12px] font-semibold text-ink-2', COLUMNS)}>
            <span>Car</span>
            <span>Task</span>
            <span>On track</span>
            <span>Drivers so far</span>
            <span>Updated</span>
            <span className="text-right">Spend</span>
          </div>
          {groups.map((g) =>
            g.empty ? (
              <p key={g.lanes[0]?.id} className="px-3 py-3 border-b border-rule text-[12px] text-ink-2">
                Nothing{' '}
                {g.lanes.map((lane, i) => (
                  <span key={lane.id}>
                    {i === 0 ? '' : i === g.lanes.length - 1 ? ' or ' : ', '}
                    <span data-testid={`lane-${lane.id}`}>{lane.short}</span>
                  </span>
                ))}
                .
              </p>
            ) : (
              g.lanes.map((lane) => {
                const inLane = cards.filter((c) => lane.statuses.includes(c.task.status));
                return (
                  <section key={lane.id} data-testid={`lane-${lane.id}`} aria-label={lane.title}>
                    <h2 className={cx('flex items-center gap-2 px-3 pt-4 pb-2 text-[12px] font-bold', lane.ink)}>
                      {lane.flag ? <Swatch tone={lane.flag} /> : null}
                      {lane.title}
                      <span className="tabular font-normal text-ink-2">{inLane.length}</span>
                    </h2>
                    <ol>
                      {inLane.map((c) => (
                        <li key={c.task.id}>
                          <TaskCard card={c} all={all} lane={lane.id} />
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })
            ),
          )}
        </div>
        {data && data.length === 0 ? <EmptyState>No tasks yet. Press n to create one, or run stint demo to replay one.</EmptyState> : null}
      </div>
    </main>
  );
}
