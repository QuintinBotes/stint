import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DaemonError, type TaskFiles, api } from '../api';
import { Button, EmptyState, cx } from './ui';

const said = (e: unknown) => (e instanceof DaemonError ? `${e.error.message}${typeof e.error.hint === 'string' ? `: ${e.error.hint}` : ''}` : String(e));

/** The task's files, read-only here; the change's files first, and anything opens in the person's own editor. */
export function FilesTab({ taskId }: { taskId: string }) {
  const [data, setData] = useState<TaskFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [filter, setFilter] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState<{ path: string; content: string | null; reason?: string } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .files(taskId)
      .then((d) => {
        if (!live) return;
        setData(d);
        setOnlyChanged(d.changed.length > 0);
        setPath((p) => p ?? d.changed[0]?.path ?? null);
      })
      .catch((e: unknown) => live && setError(said(e)));
    return () => {
      live = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setContent(null);
    api
      .fileContent(taskId, path)
      .then((c) => live && setContent(c))
      .catch((e: unknown) => live && setContent({ path, content: null, reason: said(e) }));
    return () => {
      live = false;
    };
  }, [taskId, path]);

  const changed = useMemo(() => new Map((data?.changed ?? []).map((c) => [c.path, c])), [data]);
  const shown = useMemo(() => {
    const all = onlyChanged ? (data?.changed ?? []).map((c) => c.path).filter((p) => data?.files.includes(p) ?? false) : (data?.files ?? []);
    const q = filter.trim().toLowerCase();
    return q ? all.filter((p) => p.toLowerCase().includes(q)) : all;
  }, [data, onlyChanged, filter]);

  const open = (p?: string) => {
    api.openInEditor(taskId, p).then((r) => toast.success(`Opened ${p ?? 'the worktree'} in ${r.with}`)).catch((e: unknown) => toast.error(said(e)));
  };

  if (error) return <EmptyState testId="files-error">{error}</EmptyState>;
  if (!data) return <EmptyState testId="files-loading">Reading the task's files.</EmptyState>;
  const where = data.editable ? `the worktree ${data.worktree}` : `branch ${data.ref}, read-only: the worktree is gone after merge or before the first run`;

  return (
    <section data-testid="files" className="flex flex-col gap-3 min-h-0">
      <header className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted">Showing {where}.</span>
        <Button className="ml-auto" disabled={!data.editable} title={data.editable ? undefined : 'There is no worktree to open'} onClick={() => open()} data-testid="open-worktree">
          Open the worktree in your editor
        </Button>
      </header>
      <div className="grid md:grid-cols-[minmax(220px,300px)_1fr] gap-3 min-h-0">
        <nav aria-label="Files" className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files"
              aria-label="Filter files"
              className="flex-1 min-w-0 h-8 rounded-md border border-line bg-surface px-2 text-[13px] focus-visible:border-accent outline-none"
            />
            <Button aria-pressed={onlyChanged} onClick={() => setOnlyChanged((v) => !v)} className={cx('h-8', onlyChanged && 'border-accent text-accent')} disabled={data.changed.length === 0}>
              Changed ({data.changed.length})
            </Button>
          </div>
          {shown.length === 0 ? (
            <EmptyState testId="files-empty">{onlyChanged ? 'The change touches no files yet.' : 'No file matches.'}</EmptyState>
          ) : (
            <ul className="flex flex-col overflow-y-auto max-h-[60vh] text-[13px]" data-testid="file-list">
              {shown.map((p) => {
                const c = changed.get(p);
                const slash = p.lastIndexOf('/');
                return (
                  <li key={p}>
                    <button
                      type="button"
                      data-testid="file-row"
                      data-path={p}
                      aria-current={p === path ? 'true' : undefined}
                      onClick={() => setPath(p)}
                      className={cx('w-full flex items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-sunken', p === path && 'bg-sunken')}
                    >
                      <span className="min-w-0 truncate">
                        {slash >= 0 ? <span className="text-faint">{p.slice(0, slash + 1)}</span> : null}
                        {p.slice(slash + 1)}
                      </span>
                      {c ? (
                        <span className="ml-auto shrink-0 tabular text-[12px]">
                          <span className="text-good">+{c.added}</span> <span className="text-bad">-{c.removed}</span>
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <article className="min-w-0 flex flex-col gap-2" data-testid="file-view">
          {path ? (
            <>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[12px] truncate">{path}</code>
                <Button className="ml-auto" disabled={!data.editable} onClick={() => open(path)} data-testid="open-file">
                  Open in your editor
                </Button>
              </div>
              {content === null ? (
                <p className="text-faint text-[12px]">Reading {path}.</p>
              ) : content.content === null ? (
                <EmptyState testId="file-unreadable">{`Not shown here: ${content.reason ?? 'unreadable'}.`}</EmptyState>
              ) : (
                <pre className="overflow-auto max-h-[60vh] rounded-md border border-line bg-sunken p-3 text-[12px] leading-[18px] font-mono" data-testid="file-content">
                  {content.content.split('\n').map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines of one file, in order
                    <div key={i} className="flex">
                      <span className="select-none text-faint w-10 shrink-0 text-right pr-3 tabular">{i + 1}</span>
                      <span className="whitespace-pre">{line}</span>
                    </div>
                  ))}
                </pre>
              )}
            </>
          ) : (
            <EmptyState testId="file-none">Pick a file to read it here.</EmptyState>
          )}
        </article>
      </div>
    </section>
  );
}
