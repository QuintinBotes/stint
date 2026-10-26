import { useEffect, useState } from 'react';
import { api } from '../api';
import { cx, EmptyState } from './ui';

type FileDiff = { path: string; lines: string[] };

function split(unified: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  for (const line of unified.split('\n')) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (m) {
      cur = { path: m[2] ?? '', lines: [] };
      files.push(cur);
    } else if (cur && !/^(index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line)) {
      cur.lines.push(line);
    }
  }
  return files;
}

/** A plain unified diff of the task branch against its base; the full viewer arrives in R-015. */
export function DiffView({ taskId, version }: { taskId: string; version: number }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // version is the refetch trigger
  useEffect(() => {
    let live = true;
    api
      .diff(taskId)
      .then((d) => live && setFiles(split(d)))
      .catch((e: unknown) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [taskId, version]);
  if (error) return <p className="text-bad">The diff could not be read: {error}</p>;
  if (!files) return <p className="text-faint">Reading the diff.</p>;
  if (files.length === 0) return <EmptyState testId="empty-diff">The diff appears here once a run commits to the task branch.</EmptyState>;
  return (
    <div className="flex flex-col gap-4" data-testid="diff">
      {files.map((f) => (
        <section key={f.path} data-testid="diff-file" className="rounded-md border border-line overflow-hidden">
          <h3 className="px-3 py-1.5 bg-raised border-b border-line font-mono text-[12px]">{f.path}</h3>
          <pre className="font-mono text-[12px] leading-[18px] overflow-x-auto">
            {f.lines.map((l, i) => (
              <div
                // diff lines have no identity of their own
                key={i}
                className={cx('px-3 whitespace-pre', l.startsWith('+') && 'bg-added', l.startsWith('-') && 'bg-removed', l.startsWith('@@') && 'text-faint bg-sunken')}
              >
                {l || ' '}
              </div>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
