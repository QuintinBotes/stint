import type { StintEvent } from '@stint-dev/core';
import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { type Agent, agentOf } from '../agents';
import { type DiffBlameFile, type LineComment, type RunSummary, api } from '../api';
import { type CommentAnnotation, CommentEditor, CommentNote } from './DiffComments';
import { type DiffFileEntry, DiffFileTree } from './DiffFileTree';
import { Button, EmptyState, Who } from './ui';

export type DiffLayout = 'split' | 'stacked';

const LAYOUT_KEY = 'stint:diff-layout';

function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'stacked';
  } catch {
    return 'stacked';
  }
}

function writeLayout(layout: DiffLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* private window: the layout lasts for this tab only */
  }
}

/** Files a person has marked as read on this task, kept in the browser. */
export function readViewedFiles(taskId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`stint:viewed:${taskId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeViewedFiles(taskId: string, viewed: Set<string>): void {
  try {
    localStorage.setItem(`stint:viewed:${taskId}`, JSON.stringify([...viewed]));
  } catch {
    /* private window: viewed marks last for this tab only */
  }
}

type FilePatch = { path: string; patch: string; added: number; removed: number };

/** One patch per file, headers kept, in the order git wrote them. */
function splitPatch(unified: string): FilePatch[] {
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let inHunk = false;
  for (const line of unified.split('\n')) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (m) {
      cur = { path: m[2] ?? '', patch: '', added: 0, removed: 0 };
      files.push(cur);
      inHunk = false;
    }
    if (!cur) continue;
    cur.patch += `${line}\n`;
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+')) cur.added++;
    else if (inHunk && line.startsWith('-')) cur.removed++;
  }
  return files;
}

/** The new-file line numbers a patch shows, in order: the lines a comment anchors to. */
function additionLineNumbers(patch: string): number[] {
  const out: number[] = [];
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let next = 0;
  for (const line of lines) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) next = Number(hunk[1]);
    else if (next > 0 && (line.startsWith('+') || line.startsWith(' ') || line === '')) {
      out.push(next);
      next++;
    }
  }
  return out;
}

type LineClick = { lineNumber: number; annotationSide?: 'additions' | 'deletions' };
type Annotation = { side: 'additions' | 'deletions'; lineNumber: number; metadata: CommentAnnotation };
// the viewer and its highlighter are imported on use, so the main bundle stays small
type PatchDiffComponent = ComponentType<{
  patch: string;
  options: Record<string, unknown>;
  disableWorkerPool: boolean;
  lineAnnotations: Annotation[];
  selectedLines: { start: number; end: number; side: 'additions' } | null;
  renderAnnotation: (annotation: Annotation) => ReactNode;
}>;

export type DiffViewProps = {
  taskId: string;
  /** Refetch trigger: the count of finished runs. */
  version: number;
  files: DiffFileEntry[];
  file: string | null;
  onFile: (path: string) => void;
  events: StintEvent[];
  runs: RunSummary[];
  viewed: Set<string>;
  onToggleViewed: (path: string) => void;
  /** The files written by the moment the clock is on; null when the view shows now. */
  writtenBy?: Set<string> | null;
  /** That moment, as the clock reads it. */
  asOfLabel?: string | null;
};

/**
 * The task diff: a changed-file tree beside one file rendered with @pierre/diffs, what the latest packet
 * left out, who wrote the file, and line comments the next hand carries in its ask.
 */
export function DiffView({ taskId, version, files, file, onFile, events, runs, viewed, onToggleViewed, writtenBy = null, asOfLabel = null }: DiffViewProps) {
  const [patches, setPatches] = useState<FilePatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<DiffLayout>(readLayout);
  const [narrow, setNarrow] = useState(false);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [comments, setComments] = useState<LineComment[]>([]);
  const [PatchDiff, setPatchDiff] = useState<PatchDiffComponent | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [blame, setBlame] = useState<Map<string, NonNullable<DiffBlameFile['hunks']>> | null>(null);
  const [hover, setHover] = useState<{ line: number; side: 'additions' | 'deletions' } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ line: number; side: 'additions' | 'deletions' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    import('@pierre/diffs/react')
      .then((m) => live && setPatchDiff(() => m.PatchDiff as unknown as PatchDiffComponent))
      .catch((e: unknown) => live && setViewerError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  // version is the refetch trigger
  useEffect(() => {
    let live = true;
    api
      .diff(taskId)
      .then((d) => live && setPatches(splitPatch(d)))
      .catch((e: unknown) => live && setError(String(e)));
    // per-hunk attribution from git blame; when it cannot answer the per-file writers below stand in
    api
      .diffBlame(taskId)
      .then((files) => live && setBlame(new Map(files.filter((f) => f.hunks?.length).map((f) => [f.path, f.hunks as NonNullable<DiffBlameFile['hunks']>]))))
      .catch(() => live && setBlame(null));
    api
      .comments(taskId)
      .then((c) => live && setComments(c))
      .catch(() => undefined);
    void (async () => {
      try {
        const names = await api.handoffNames(taskId);
        const latest = names.at(-1);
        if (!latest) return;
        const r = await api.handoff(taskId, latest);
        if (live) setLeftOut(r.packet.leftOut);
      } catch {
        if (live) setLeftOut([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [taskId, version]);

  const treeFiles = useMemo<DiffFileEntry[]>(() => {
    if (files.length > 0) return files;
    return (patches ?? []).map((p) => ({ path: p.path, added: p.added, removed: p.removed }));
  }, [files, patches]);
  const selectedPatch = useMemo(() => {
    if (!patches) return null;
    return patches.find((p) => p.path === file) ?? patches[0] ?? null;
  }, [patches, file]);
  const selected = selectedPatch?.path ?? treeFiles[0]?.path ?? null;
  const additionLines = useMemo(() => (selectedPatch ? additionLineNumbers(selectedPatch.patch) : []), [selectedPatch]);

  useEffect(() => {
    setEditing(null);
    setSaveError(null);
    setHover(null);
    setCursor(null);
  }, [selected]);

  // Per-file attribution (the runs whose file.changed named it, in order): the fallback when blame has no range for a line.
  const writers = useMemo(() => {
    const byPath = new Map<string, string[]>();
    for (const e of events) {
      if (e.type !== 'file.changed' || typeof e.payload.path !== 'string') continue;
      const run = typeof e.payload.run === 'string' ? e.payload.run : e.run;
      if (!run) continue;
      const list = byPath.get(e.payload.path) ?? [];
      if (!list.includes(run)) list.push(run);
      byPath.set(e.payload.path, list);
    }
    return byPath;
  }, [events]);
  const runName = useCallback(
    (run: string) => {
      const summary = runs.find((r) => r.run === run);
      return `${agentOf(summary?.adapter, summary?.host, summary?.model).name} ${run}`;
    },
    [runs],
  );
  // who first wrote each changed file, named with their vendor's ink in the file's head
  const firstWriter = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const [path, list] of writers) {
      const summary = runs.find((r) => r.run === list[0]);
      if (summary) m.set(path, agentOf(summary.adapter, summary.host, summary.model));
    }
    return m;
  }, [writers, runs]);
  const attribution = useMemo(() => {
    if (!selected) return null;
    const list = writers.get(selected) ?? [];
    if (list.length === 0) return null;
    return list.map(runName).join(', ');
  }, [writers, selected, runName]);
  // The run whose commit last wrote the hovered new-side line, from blame where it answered (R-052).
  const blameRanges = selected ? blame?.get(selected) : undefined;
  const hoverRun = hover && hover.side === 'additions' && blameRanges ? blameRanges.find((r) => hover.line >= r.start && hover.line <= r.end)?.run : undefined;

  const pickLayout = (next: DiffLayout) => {
    setLayout(next);
    writeLayout(next);
  };

  const openEditor = useCallback((line: number, side: 'additions' | 'deletions' = 'additions') => {
    setSaveError(null);
    setCursor(line);
    setEditing({ line, side });
  }, []);

  const onLineClick = useCallback(
    (props: LineClick) => openEditor(props.lineNumber, props.annotationSide ?? 'additions'),
    [openEditor],
  );
  const onLineEnter = useCallback((props: LineClick) => setHover({ line: props.lineNumber, side: props.annotationSide ?? 'additions' }), []);
  const onLineLeave = useCallback(() => setHover(null), []);

  const saveComment = (text: string) => {
    if (!selected || !editing) return;
    setSaving(true);
    setSaveError(null);
    api
      .addComment(taskId, { file: selected, line: editing.line, text })
      .then((all) => {
        setComments(all);
        setEditing(null);
      })
      .catch((e: unknown) => setSaveError(`The comment was not saved: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setSaving(false));
  };

  const annotations = useMemo<Annotation[]>(() => {
    if (!selected) return [];
    const stored = comments
      .filter((c) => c.file === selected)
      .map<Annotation>((c) => ({ side: 'additions', lineNumber: c.line, metadata: { kind: 'comment', comment: c } }));
    return editing ? [...stored, { side: editing.side, lineNumber: editing.line, metadata: { kind: 'editor' } }] : stored;
  }, [comments, selected, editing]);

  const renderAnnotation = useCallback(
    (a: Annotation) => {
      if (a.metadata.kind === 'comment') return <CommentNote comment={a.metadata.comment} />;
      if (!selected || !editing) return null;
      return (
        <CommentEditor
          file={selected}
          line={editing.line}
          busy={saving}
          error={saveError}
          onSave={saveComment}
          onCancel={() => setEditing(null)}
        />
      );
    },
    // saveComment reads the state above; the editor re-renders with it
    [selected, editing, saving, saveError],
  );

  const moveCursor = (dir: 1 | -1) => {
    if (additionLines.length === 0) return;
    const i = cursor === null ? -1 : additionLines.indexOf(cursor);
    const next = dir === 1 ? additionLines[Math.min(additionLines.length - 1, i + 1)] : additionLines[Math.max(0, i < 0 ? additionLines.length - 1 : i - 1)];
    if (next !== undefined) setCursor(next);
  };

  if (error) return <p className="text-red">The diff could not be read: {error}</p>;
  if (!patches) return <p className="text-ink-3">Reading the diff.</p>;
  if (patches.length === 0 && treeFiles.length === 0) {
    return <EmptyState testId="empty-diff">The diff appears here once a run commits to the task branch.</EmptyState>;
  }
  const selectedEntry = treeFiles.find((f) => f.path === selected);
  const isViewed = !!selected && viewed.has(selected);
  return (
    <div className="flex flex-col gap-3" data-testid="diff">
      <div className="flex flex-wrap items-center gap-2 text-body">
        <span className="text-ink-2">
          {treeFiles.length} changed file{treeFiles.length === 1 ? '' : 's'}. Click a line to comment on it.
        </span>
        <div role="group" aria-label="Diff layout" className="ml-auto flex gap-1">
          {(['split', 'stacked'] as const).map((l) => (
            <Button
              key={l}
              className="h-8 px-2.5 text-small"
              aria-pressed={layout === l}
              data-testid={`diff-layout-${l}`}
              onClick={() => pickLayout(l)}
            >
              {l === 'split' ? 'Split' : 'Stacked'}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 items-start">
        <div className="flex flex-col gap-3">
          <DiffFileTree
            files={treeFiles}
            selected={selected}
            viewed={viewed}
            narrow={narrow}
            onSelect={onFile}
            onToggleWidth={() => setNarrow((n) => !n)}
            later={writtenBy ? new Set(treeFiles.map((f) => f.path).filter((p) => !writtenBy.has(p))) : undefined}
          />
          {leftOut.length > 0 ? (
            <section
              data-testid="left-out"
              aria-label="Left out"
              className="rounded-[5px] border border-rule bg-panel p-2"
              style={{ width: narrow ? 172 : 236 }}
            >
              <h3 className="px-1 font-semibold">Left out</h3>
              <ul className="mt-1 px-1 flex flex-col gap-1 text-small text-ink-2">
                {leftOut.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <section data-testid="diff-file" className="flex-1 min-w-[260px] rounded-[5px] border border-rule overflow-hidden scroll-mt-4">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-panel border-b border-rule">
            <h3 className="font-mono text-small truncate">{selected}</h3>
            {selectedEntry ? (
              <span className="tabular text-small text-ink-2">
                +{selectedEntry.added} -{selectedEntry.removed}
              </span>
            ) : null}
            {selected && firstWriter.get(selected) ? (
              <span className="inline-flex items-center gap-1.5 text-small text-ink-2">
                Written by <Who agent={firstWriter.get(selected) as Agent} className="font-medium text-ink" />
              </span>
            ) : null}
            <Button
              className="h-7 px-2 text-small ml-auto"
              aria-pressed={isViewed}
              data-testid="mark-viewed"
              disabled={!selected}
              onClick={() => selected && onToggleViewed(selected)}
            >
              {isViewed ? 'Viewed' : 'Mark as viewed'}
            </Button>
          </div>
          <p aria-live="polite" data-testid="diff-attribution" className="px-3 py-1 min-h-6 border-b border-rule text-small text-ink-2">
            {hover !== null
              ? hoverRun
                ? `Written by ${runName(hoverRun)}`
                : blameRanges && hover.side === 'additions'
                  ? 'This line was already here before the task branch.'
                  : attribution
                    ? `Written by ${attribution}`
                    : 'No run is recorded as writing this file.'
              : cursor !== null
                ? `Line ${cursor} selected. Press Enter to comment.`
                : writtenBy && selected && !writtenBy.has(selected)
                  ? `At ${asOfLabel ?? 'that moment'} this file was not written yet. It shows as the task branch has it now.`
                  : blameRanges
                  ? 'Hover a line to see which run wrote it.'
                  : 'Hover a line to see which run wrote this file.'}
          </p>
          <div
            data-testid="diff-pane"
            role="region"
            aria-label={`Diff of ${selected ?? 'no file'}. Use the up and down arrow keys to choose a line, then press Enter to comment on it.`}
            tabIndex={0}
            title={attribution ? `Written by ${attribution}` : undefined}
            className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && editing) {
                setEditing(null);
                return;
              }
              if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveCursor(1);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveCursor(-1);
              } else if (e.key === 'Enter' && cursor !== null && !editing) {
                e.preventDefault();
                openEditor(cursor);
              }
            }}
          >
            {viewerError ? (
              <p className="p-3 text-red text-small">The diff viewer could not start: {viewerError}</p>
            ) : !PatchDiff || !selectedPatch ? (
              <p className="p-3 text-ink-3 text-small">Reading the diff viewer.</p>
            ) : (
              <PatchDiff
                patch={selectedPatch.patch}
                disableWorkerPool
                options={{
                  diffStyle: layout === 'split' ? 'split' : 'unified',
                  // the high-contrast highlight themes keep every token at 4.5:1 on its line, added and removed lines included
                  theme: { dark: 'github-dark-high-contrast', light: 'github-light-high-contrast' },
                  themeType: 'dark',
                  // wrapped lines keep the code out of a scrollable region a keyboard cannot reach
                  overflow: 'wrap',
                  disableFileHeader: true,
                  onLineClick,
                  onLineEnter,
                  onLineLeave,
                }}
                lineAnnotations={annotations}
                selectedLines={cursor !== null ? { start: cursor, end: cursor, side: 'additions' } : null}
                renderAnnotation={renderAnnotation}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
