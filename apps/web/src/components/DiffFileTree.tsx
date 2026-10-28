import { Button, cx } from './ui';

export type DiffFileEntry = { path: string; added: number; removed: number };

/** The changed files grouped by directory; the narrow width keeps the names, the wide one keeps the counts. */
export function DiffFileTree({
  files,
  selected,
  viewed,
  narrow,
  onSelect,
  onToggleWidth,
  later,
}: {
  files: DiffFileEntry[];
  selected: string | null;
  viewed: Set<string>;
  narrow: boolean;
  onSelect: (path: string) => void;
  onToggleWidth: () => void;
  /** Files not written yet at the moment the clock is on. */
  later?: Set<string>;
}) {
  const groups = new Map<string, DiffFileEntry[]>();
  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const dir = slash >= 0 ? f.path.slice(0, slash) : '';
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return (
    <nav
      aria-label="Changed files"
      data-testid="diff-tree"
      className="shrink-0 flex flex-col gap-2 rounded-[5px] border border-rule bg-panel p-2 self-start"
      style={{ width: narrow ? 172 : 236 }}
    >
      <div className="flex items-center gap-2 px-1">
        <h3 className="font-semibold">Changed files</h3>
        <Button className="h-7 px-2 text-small ml-auto" onClick={onToggleWidth} aria-expanded={!narrow} data-testid="diff-tree-width">
          {narrow ? 'Widen' : 'Narrow'}
        </Button>
      </div>
      <p className="px-1 text-small text-ink-3 tabular" data-testid="viewed-count">
        {files.filter((f) => viewed.has(f.path)).length} of {files.length} viewed
      </p>
      {[...groups.entries()].map(([dir, inDir]) => (
        <div key={dir || '.'}>
          {dir ? <p className="px-1 pb-1 font-mono text-small text-ink-3 truncate">{dir}/</p> : null}
          <ul className="flex flex-col">
            {inDir.map((f) => {
              const name = dir ? f.path.slice(dir.length + 1) : f.path;
              const isViewed = viewed.has(f.path);
              const notYet = later?.has(f.path) ?? false;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    data-testid="diff-tree-file"
                    data-path={f.path}
                    aria-current={f.path === selected ? 'true' : undefined}
                    onClick={() => onSelect(f.path)}
                    className={cx('w-full flex items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-small hover:bg-panel-2', f.path === selected && 'bg-panel-2 font-medium', notYet && 'opacity-50')}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-small">{name}</span>
                    {notYet ? <span className="sr-only">, not written yet at this moment</span> : null}
                    {isViewed ? (
                      <span className="shrink-0 text-small text-ink-2" data-testid="viewed-mark">
                        viewed
                      </span>
                    ) : null}
                    {!narrow ? (
                      <span className="shrink-0 tabular text-small">
                        <span className="text-ink-2">+{f.added}</span> <span className="text-ink-2">-{f.removed}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
