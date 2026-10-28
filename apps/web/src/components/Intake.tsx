import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { DaemonError, type IntakeItem, type TaskCardData, api } from '../api';
import { Button, StatusChip } from './ui';

const said = (e: unknown) => (e instanceof DaemonError ? e.error.message : String(e));

/** Issues pulled from GitHub or Linear, triaged, waiting for a person: accept, merge into a task, or dismiss (R-041). */
export function IntakePanel({ tasks }: { tasks: TaskCardData[] }) {
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [merging, setMerging] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api
      .intake()
      .then((all) => setItems(all.filter((i) => i.state === 'open')))
      .catch(() => setItems([]));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  if (items.length === 0) return null;
  const act = (p: Promise<unknown>, done: string) =>
    p
      .then(() => {
        toast.success(done);
        load();
      })
      .catch((e: unknown) => toast.error(said(e)));
  const open = tasks.filter((c) => c.task.status !== 'done' && c.task.status !== 'abandoned');
  return (
    <section className="flex flex-col gap-2" aria-labelledby="intake-title" data-testid="intake">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="intake-title" className="text-section">
          Incoming issues
        </h2>
        <p className="text-small text-ink-2">
          {items.length} issue{items.length === 1 ? '' : 's'} from GitHub and Linear, sized and checked for duplicates. None becomes a task until you accept it.
        </p>
      </div>
      <ul className="flex flex-col rounded-[5px] border border-rule-strong bg-panel">
        {items.map((i) => (
          <li key={i.id} className="border-b border-rule last:border-b-0 px-3.5 py-3" data-testid="intake-row" data-item={i.id}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={`${i.source === 'github' ? 'GitHub' : 'Linear'} ${i.ref}`} tone="neutral" />
              {i.url ? (
                <a href={i.url} target="_blank" rel="noreferrer" className="font-semibold no-underline hover:underline min-w-0 truncate">
                  {i.triage?.title ?? i.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className="font-semibold min-w-0 truncate">{i.triage?.title ?? i.title}</span>
              )}
              {i.triage ? <StatusChip label={`size ${i.triage.size}`} tone="neutral" /> : null}
              {i.triage ? <StatusChip label={`${i.triage.risk} risk`} tone="neutral" /> : null}
            </div>
            <p className="text-small text-ink-2 mt-1">
              {i.triage ? i.triage.reason : `Not sized yet: ${i.triageError ?? 'no planner answered'}. You can still accept it as written.`}
              {i.triage?.duplicates.length ? (
                <>
                  {' '}
                  May duplicate{' '}
                  {i.triage.duplicates.map((d, n) => (
                    <span key={d}>
                      {n ? ', ' : ''}
                      <Link to={`/t/${d}`} className="underline decoration-rule-strong font-mono">
                        {d}
                      </Link>
                    </span>
                  ))}
                  .
                </>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button tone="primary" className="h-8 px-2.5 text-small" data-testid="intake-accept" onClick={() => void act(api.acceptIntake(i.id), `${i.source} ${i.ref} is now a task`)}>
                Accept as a task
              </Button>
              <select
                aria-label="Add to an existing task"
                className="h-8 rounded-[5px] border border-field bg-ground px-2 text-small text-ink"
                value={merging[i.id] ?? i.triage?.duplicates[0] ?? ''}
                onChange={(e) => setMerging((m) => ({ ...m, [i.id]: e.target.value }))}
              >
                <option value="">Add to an existing task</option>
                {open.map((c) => (
                  <option key={c.task.id} value={c.task.id}>
                    {c.task.id} {c.task.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <Button
                className="h-8 px-2.5 text-small"
                data-testid="intake-merge"
                disabled={!(merging[i.id] ?? i.triage?.duplicates[0])}
                onClick={() => {
                  const into = merging[i.id] ?? i.triage?.duplicates[0];
                  if (into) void act(api.mergeIntake(i.id, into), `${i.source} ${i.ref} added to ${into}`);
                }}
              >
                Add to task
              </Button>
              <Button className="h-8 px-2.5 text-small ml-auto" data-testid="intake-dismiss" onClick={() => void act(api.dismissIntake(i.id), `${i.source} ${i.ref} dismissed; it will not be pulled again`)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
