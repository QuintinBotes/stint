import type { TaskStatus } from '@stint-dev/core';
import type { TaskCardData } from '../api';
import { IntakePanel } from '../components/Intake';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/ui';
import { useTasks } from '../hooks';

const LANES: Array<{ id: string; title: string; statuses: TaskStatus[]; empty: string }> = [
  { id: 'needs-you', title: 'Needs you', statuses: ['awaiting_approval', 'rejected'], empty: 'Nothing waits for you.' },
  { id: 'planned', title: 'Planned', statuses: ['planned'], empty: 'No planned tasks.' },
  { id: 'building', title: 'Building', statuses: ['building'], empty: 'No agent is building.' },
  { id: 'verifying', title: 'Verifying', statuses: ['verifying'], empty: 'Nothing is being verified.' },
  { id: 'reviewing', title: 'Reviewing', statuses: ['reviewing'], empty: 'Nothing is in review.' },
  { id: 'in-review', title: 'In review', statuses: ['in_review'], empty: 'Nothing is in pull request review.' },
  { id: 'done', title: 'Done', statuses: ['approved', 'done', 'abandoned'], empty: 'Nothing merged yet.' },
];

export function Board() {
  const { data, error } = useTasks();
  if (error) return <p className="p-4 text-bad">The daemon did not answer: {error}</p>;
  const cards: TaskCardData[] = data ?? [];
  const all = new Map(cards.map((c) => [c.task.id, c.task]));
  return (
    <main className="flex-1 min-h-0 overflow-auto">
      <IntakePanel tasks={cards} />
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4 p-4" data-testid="board">
        {LANES.map((lane) => {
          const inLane = cards.filter((c) => lane.statuses.includes(c.task.status));
          return (
            <section key={lane.id} data-testid={`lane-${lane.id}`} aria-label={lane.title} className="min-w-0">
              <h2 className="flex items-baseline justify-between text-[13px] font-semibold mb-2">
                {lane.title}
                <span className="tabular text-faint font-normal">{inLane.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {inLane.length === 0 ? <p className="text-faint text-[12px] py-2">{lane.empty}</p> : inLane.map((c) => <TaskCard key={c.task.id} card={c} all={all} />)}
              </div>
            </section>
          );
        })}
      </div>
      {data && data.length === 0 ? (
        <div className="px-4">
          <EmptyState>No tasks yet. Press n to create one, or run stint demo to replay one.</EmptyState>
        </div>
      ) : null}
    </main>
  );
}
