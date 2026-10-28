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
    <section className="flex flex-col gap-2" aria-label="Intake" data-testid="intake">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-[19px] font-bold stretch-112">
        Intake <span className="text-ink-3 font-normal tabular text-[12px]">{items.length}</span>
        <span className="text-ink-2 font-normal text-[12px] [font-stretch:100%]">Issues from GitHub and Linear, triaged. None is a car on the grid until you accept it.</span>
      </h2>
      <ul className="flex flex-col border-t-2 border-ink">
        {items.map((i) => (
          <li key={i.id} className="border-b border-rule px-3 py-3 text-[14px]" data-testid="intake-row" data-item={i.id}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={`${i.source === 'github' ? 'GitHub' : 'Linear'} ${i.ref}`} tone="neutral" />
              {i.url ? (
                <a href={i.url} target="_blank" rel="noreferrer" className="font-bold underline-offset-2 hover:underline min-w-0 truncate">
                  {i.triage?.title ?? i.title}
                </a>
              ) : (
                <span className="font-bold min-w-0 truncate">{i.triage?.title ?? i.title}</span>
              )}
              {i.triage ? <StatusChip label={`size ${i.triage.size}`} tone="neutral" /> : null}
              {i.triage ? <StatusChip label={`${i.triage.risk} risk`} tone={i.triage.risk === 'high' ? 'bad' : i.triage.risk === 'medium' ? 'warn' : 'neutral'} /> : null}
            </div>
            <p className="text-[12px] text-ink-2 mt-1">
              {i.triage ? i.triage.reason : `Not triaged: ${i.triageError ?? 'no planner answered'}. You can still accept it as written.`}
              {i.triage?.duplicates.length ? (
                <>
                  {' '}
                  May duplicate{' '}
                  {i.triage.duplicates.map((d, n) => (
                    <span key={d}>
                      {n ? ', ' : ''}
                      <Link to={`/t/${d}`} className="underline underline-offset-2 font-mono">
                        {d}
                      </Link>
                    </span>
                  ))}
                  .
                </>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button tone="primary" className="h-7" data-testid="intake-accept" onClick={() => void act(api.acceptIntake(i.id), `${i.source} ${i.ref} is now a task`)}>
                Accept as a task
              </Button>
              <select
                aria-label="Merge into"
                className="h-7 rounded-[3px] border border-rule-strong bg-ground px-2 text-[12px] text-ink"
                value={merging[i.id] ?? i.triage?.duplicates[0] ?? ''}
                onChange={(e) => setMerging((m) => ({ ...m, [i.id]: e.target.value }))}
              >
                <option value="">Merge into a task</option>
                {open.map((c) => (
                  <option key={c.task.id} value={c.task.id}>
                    {c.task.id} {c.task.title.slice(0, 40)}
                  </option>
                ))}
              </select>
              <Button
                className="h-7"
                data-testid="intake-merge"
                disabled={!(merging[i.id] ?? i.triage?.duplicates[0])}
                onClick={() => {
                  const into = merging[i.id] ?? i.triage?.duplicates[0];
                  if (into) void act(api.mergeIntake(i.id, into), `${i.source} ${i.ref} merged into ${into}`);
                }}
              >
                Merge
              </Button>
              <Button className="h-7 ml-auto" data-testid="intake-dismiss" onClick={() => void act(api.dismissIntake(i.id), `${i.source} ${i.ref} dismissed; it will not be pulled again`)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
