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
  // one action at a time per issue: the row's buttons wait until the daemon answers
  const [busy, setBusy] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api
      .intake()
      .then((all) => setItems(all.filter((i) => i.state === 'open')))
      // a failed read keeps the issues already shown rather than hiding them
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  if (items.length === 0) return null;
  const act = (id: string, what: string, call: () => Promise<unknown>, done: string) => {
    if (busy[id]) return;
    setBusy((b) => ({ ...b, [id]: what }));
    void call()
      .then(() => {
        toast.success(done);
        load();
      })
      .catch((e: unknown) => toast.error(said(e)))
      .finally(() =>
        setBusy((b) => {
          const next = { ...b };
          delete next[id];
          return next;
        }),
      );
  };
  const open = tasks.filter((c) => c.task.status !== 'done' && c.task.status !== 'abandoned');
  return (
    <section className="stint-section mb-8" aria-labelledby="intake-title" data-testid="intake">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="intake-title" className="stint-section-title">
          Incoming issues
        </h2>
        <p className="text-small text-ink-3">
          {items.length} issue{items.length === 1 ? '' : 's'} from GitHub and Linear, sized and checked for duplicates. None becomes a task until you accept it.
        </p>
      </div>
      <ul className="stint-table-region">
        {items.map((i) => {
          const into = merging[i.id] ?? i.triage?.duplicates[0];
          const doing = busy[i.id];
          return (
            <li key={i.id} className="border-t border-rule first:border-t-0 px-4 py-3" data-testid="intake-row" data-item={i.id}>
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
                <Button className="min-h-8 px-2.5" aria-disabled={!!doing} aria-busy={doing === 'accept'} data-testid="intake-accept" onClick={() => act(i.id, 'accept', () => api.acceptIntake(i.id), `${i.source} ${i.ref} is now a task`)}>
                  {doing === 'accept' ? 'Accepting' : 'Accept as a task'}
                </Button>
                <select aria-label="Add to an existing task" className="stint-input w-auto min-h-8 py-1 text-small" value={into ?? ''} onChange={(e) => setMerging((m) => ({ ...m, [i.id]: e.target.value }))}>
                  <option value="">Add to an existing task</option>
                  {open.map((c) => (
                    <option key={c.task.id} value={c.task.id}>
                      {c.task.id} {c.task.title.slice(0, 40)}
                    </option>
                  ))}
                </select>
                <Button
                  className="min-h-8 px-2.5"
                  data-testid="intake-merge"
                  disabled={!into}
                  aria-disabled={!!doing}
                  aria-busy={doing === 'merge'}
                  onClick={() => {
                    if (into) act(i.id, 'merge', () => api.mergeIntake(i.id, into), `${i.source} ${i.ref} added to ${into}`);
                  }}
                >
                  {doing === 'merge' ? 'Adding' : 'Add to task'}
                </Button>
                <Button tone="ghost" className="min-h-8 px-2.5 ml-auto" aria-disabled={!!doing} aria-busy={doing === 'dismiss'} data-testid="intake-dismiss" onClick={() => act(i.id, 'dismiss', () => api.dismissIntake(i.id), `${i.source} ${i.ref} dismissed; it will not be pulled again`)}>
                  {doing === 'dismiss' ? 'Dismissing' : 'Dismiss'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
