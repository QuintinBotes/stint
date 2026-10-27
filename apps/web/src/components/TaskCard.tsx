import { Link } from 'react-router';
import { agentOf } from '../agents';
import type { TaskCardData } from '../api';
import { age } from '../format';
import { CostMeter, StatusChip, VendorMark, cx } from './ui';

type CardTask = TaskCardData['task'];

/** How a task in the same split stands: merged, or its status, or what it still waits for. */
function standing(t: CardTask, all: Map<string, CardTask>): string {
  if (t.status === 'done') return 'merged';
  const open = (t.dependsOn ?? []).filter((d) => all.get(d)?.status !== 'done');
  return open.length ? `waits for ${open.join(', ')}` : t.status.replace('_', ' ');
}

/** Who holds the task now, in the words a person uses: you at the gate, the agent that is running, or nobody yet. */
function holding(card: TaskCardData): string {
  const { task, lastRun } = card;
  if (task.status === 'awaiting_approval') return 'held by you';
  if (task.status === 'done') return '';
  if (lastRun && !lastRun.endedAt) return `${agentOf(lastRun.adapter, lastRun.host, lastRun.model).name}, ${lastRun.run}, live`;
  if (task.status === 'planned' && !lastRun) return 'no holder yet';
  return lastRun ? `last: ${agentOf(lastRun.adapter, lastRun.host, lastRun.model).name}` : 'unassigned';
}

export function TaskCard({ card, all }: { card: TaskCardData; all?: Map<string, CardTask> }) {
  const { task, lastRun } = card;
  const tasks = all ?? new Map<string, CardTask>();
  // a split task lists its subtasks in order, each with what it waits for: the dependency line (R-036)
  const children = [...tasks.values()].filter((t) => t.parent === task.id).sort((a, b) => a.id.localeCompare(b.id));
  const agents = (card.agents ?? (lastRun?.adapter ? [{ adapter: lastRun.adapter, host: lastRun.host, model: lastRun.model, role: lastRun.role }] : [])).map((a) => agentOf(a.adapter, a.host, a.model));
  const live = !!lastRun && !lastRun.endedAt;
  const gate = task.status === 'awaiting_approval';
  return (
    <Link
      to={`/t/${task.id}`}
      data-testid="task-card"
      data-task={task.id}
      className={cx('block rounded-lg border bg-raised p-3 hover:border-line-strong focus-visible:border-accent', gate ? 'border-warn/60' : live ? 'border-accent/60' : 'border-line')}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="font-mono text-faint">{task.id}</span>
        <span className="flex items-center gap-1.5 tabular">
          <span>{age(card.lastEventAt)},</span>
          <CostMeter cost={card.cost} />
        </span>
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-[20px] tracking-[-0.01em]">{task.title}</h3>
      <div className="mt-2 flex items-center gap-1 text-[12px] text-muted min-w-0" data-testid="card-agents">
        {agents.slice(0, 5).map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same agent can appear on two models, so position is the identity
          <VendorMark key={i} agent={a} showName={false} />
        ))}
        <span className={cx('truncate', agents.length ? 'ml-1' : '')}>{holding(card)}</span>
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
      {card.summary ? <p className="mt-2 text-[12px] text-muted line-clamp-3">{card.summary}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        {task.status === 'done' ? <StatusChip label="merged" tone="good" /> : <StatusChip status={task.status} />}
        {task.status === 'done' ? <span className="font-mono text-[11px] text-faint">Stint-Task: {task.id}</span> : null}
      </div>
      {live ? <div aria-hidden className="mt-2 h-0.5 rounded-full bg-accent live-spine" /> : null}
    </Link>
  );
}
