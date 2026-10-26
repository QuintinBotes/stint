import { Link } from 'react-router';
import { agentOf } from '../agents';
import type { TaskCardData } from '../api';
import { age } from '../format';
import { CostMeter, StatusChip, VendorMark } from './ui';

export function TaskCard({ card }: { card: TaskCardData }) {
  const { task, lastRun } = card;
  const holder = lastRun ? agentOf(lastRun.adapter, lastRun.host, lastRun.model) : null;
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
      {card.summary ? <p className="mt-2 text-[12px] text-muted line-clamp-2">{card.summary}</p> : null}
    </Link>
  );
}
