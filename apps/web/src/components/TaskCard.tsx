import { Link } from 'react-router';
import { agentOf } from '../agents';
import type { TaskCardData } from '../api';
import { age } from '../format';
import { CostMeter, StatusChip, VendorMark } from './ui';

type CardTask = TaskCardData['task'];

/** How a task in the same split stands: merged, or its status, or what it still waits for. */
function standing(t: CardTask, all: Map<string, CardTask>): string {
  if (t.status === 'done') return 'merged';
  const open = (t.dependsOn ?? []).filter((d) => all.get(d)?.status !== 'done');
  return open.length ? `waits for ${open.join(', ')}` : t.status.replace('_', ' ');
}

export function TaskCard({ card, all }: { card: TaskCardData; all?: Map<string, CardTask> }) {
  const { task, lastRun } = card;
  const holder = lastRun ? agentOf(lastRun.adapter, lastRun.host, lastRun.model) : null;
  const tasks = all ?? new Map<string, CardTask>();
  // a split task lists its subtasks in order, each with what it waits for: the dependency line (R-036)
  const children = [...tasks.values()].filter((t) => t.parent === task.id).sort((a, b) => a.id.localeCompare(b.id));
  return (
    <Link
      to={`/t/${task.id}`}
      data-testid="task-card"
      data-task={task.id}
      className="block rounded-lg border border-line bg-raised p-3 hover:border-line-strong focus-visible:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold leading-[18px]">{task.title}</h3>
        <StatusChip status={task.status} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted min-w-0">
        <span className="font-mono text-faint shrink-0">{task.id}</span>
        {holder ? <VendorMark agent={holder} /> : <span className="text-faint">unassigned</span>}
        <span className="ml-auto flex items-center gap-2 shrink-0 tabular">
          <span>{age(card.lastEventAt)}</span>
          <CostMeter cost={card.cost} />
        </span>
      </div>
      {card.autopilot?.on ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] min-w-0" data-testid="autopilot-chip">
          <StatusChip label={card.autopilot.queued ? 'queued' : `autopilot: ${card.autopilot.step}`} tone={card.autopilot.queued ? 'neutral' : 'active'} />
          {card.autopilot.reason ? <span className="text-muted truncate">{card.autopilot.reason}</span> : null}
        </p>
      ) : null}
      {task.parent || task.dependsOn?.length ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted" data-testid="task-family">
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
        </p>
      ) : null}
      {children.length ? (
        <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-2 text-[12px]" data-testid="subtasks" aria-label={`${children.length} subtasks`}>
          {children.map((c) => (
            <li key={c.id} className="flex items-baseline gap-2 min-w-0" data-subtask={c.id}>
              <span className="font-mono text-faint shrink-0">{c.id}</span>
              <span className="truncate">{c.title}</span>
              <span className="ml-auto shrink-0 text-muted">{standing(c, tasks)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {card.summary ? <p className="mt-2 text-[12px] text-muted line-clamp-2">{card.summary}</p> : null}
    </Link>
  );
}
