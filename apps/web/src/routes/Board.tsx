import type { TaskStatus } from '@stint-dev/core';
import { type TaskCardData, api } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard } from '../components/TaskCard';
import { toast } from 'sonner';
import { Button, EmptyState, Kbd, cx } from '../components/ui';
import { useTasks } from '../hooks';

const LANES: Array<{ id: string; title: string; statuses: TaskStatus[]; empty: string; hideEmpty?: boolean }> = [
  { id: 'needs-you', title: 'Needs you', statuses: ['awaiting_approval', 'rejected'], empty: 'Nothing waits for you.' },
  { id: 'planned', title: 'Planned', statuses: ['planned'], empty: 'No planned tasks. Press n to add one.' },
  { id: 'building', title: 'Building', statuses: ['building'], empty: 'No agent is building.' },
  { id: 'verifying', title: 'Verifying', statuses: ['verifying'], empty: "The daemon runs each task's tests here when a run ends." },
  { id: 'reviewing', title: 'Reviewing', statuses: ['reviewing'], empty: 'Review is offered only after a green verify.' },
  // only in pull request mode, so it stays out of the way until something is in it
  { id: 'in-review', title: 'In review', statuses: ['in_review'], empty: 'Nothing is in pull request review.', hideEmpty: true },
  { id: 'done', title: 'Done', statuses: ['approved', 'done', 'abandoned'], empty: 'Nothing merged yet.' },
];

const startOfWeek = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
};

export function Board({ onNewTask }: { onNewTask?: () => void }) {
  const { data, error } = useTasks();
  if (error) return <p className="p-4 text-bad">The daemon did not answer: {error}</p>;
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  const lanes = LANES.filter((l) => !l.hideEmpty || cards.some((c) => l.statuses.includes(c.task.status)));
  const week = cards.filter((c) => c.lastEventAt >= startOfWeek());
  const spent = week.reduce((s, c) => s + (c.cost.usd ?? 0), 0);
  const planned = cards.filter((c) => c.task.status === 'planned').length;
  return (
    <main className="flex-1 min-h-0 overflow-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5">
        <div>
          <p className="text-[12px] text-muted">This week, Monday to today</p>
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em] tabular" data-testid="board-total">
            ${spent.toFixed(2)} across {week.length} task{week.length === 1 ? '' : 's'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden md:inline text-[12px] text-muted">
            Each card is a folder in <span className="font-mono">.stint/tasks/</span>
          </span>
          {onNewTask ? (
            <Button tone="primary" onClick={onNewTask} data-testid="new-task">
              New task <Kbd>n</Kbd>
            </Button>
          ) : null}
          <Button
            disabled={planned === 0}
            title={planned ? `Put the ${planned} planned task${planned === 1 ? '' : 's'} on autopilot; each stops at your approval` : 'No planned tasks'}
            onClick={() => void api.autopilotAll(true).then((r) => toast.success(`${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'} on autopilot`)).catch((e: unknown) => toast.error(String(e)))}
            data-testid="run-all"
          >
            Run all planned
          </Button>
        </div>
      </header>
      <IntakePanel tasks={cards} />
      <div className={cx('grid grid-cols-1 md:grid-cols-3 gap-3 p-4', lanes.length === 7 ? 'xl:grid-cols-7' : 'xl:grid-cols-6')} data-testid="board">
        {lanes.map((lane) => {
          const inLane = cards.filter((c) => lane.statuses.includes(c.task.status));
          const needs = lane.id === 'needs-you' && inLane.length > 0;
          return (
            <section key={lane.id} data-testid={`lane-${lane.id}`} aria-label={lane.title} className="min-w-0 flex flex-col gap-2">
              <h2 className={cx('flex items-baseline justify-between rounded-md border px-2.5 h-8 items-center text-[13px] font-semibold', needs ? 'border-warn/50 bg-warn-tint text-warn' : 'border-line bg-raised')}>
                {lane.title}
                <span className={cx('tabular font-normal', needs ? 'text-warn' : 'text-faint')}>{inLane.length}</span>
              </h2>
              {inLane.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12px] text-muted">{lane.empty}</p>
              ) : (
                inLane.map((c) => <TaskCard key={c.task.id} card={c} all={all} />)
              )}
            </section>
          );
        })}
      </div>
      {data && data.length === 0 ? (
        <div className="px-4">
          <EmptyState>No tasks yet. Press n to create one, or run stint demo to replay one.</EmptyState>
        </div>
      ) : null}
      <footer className="mx-4 mt-2 mb-6 pt-3 border-t border-line flex flex-wrap justify-between gap-2 text-[12px] text-faint">
        <span>Every figure here is the daemon's, from each task's events.jsonl.</span>
        <span>Built on Meta's Muse models</span>
      </footer>
    </main>
  );
}
