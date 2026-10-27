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
}: {
  files: DiffFileEntry[];
  selected: string | null;
  viewed: Set<string>;
  narrow: boolean;
  onSelect: (path: string) => void;
  onToggleWidth: () => void;
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
      className="shrink-0 flex flex-col gap-2 rounded-md border border-line bg-raised p-2 self-start"
      style={{ width: narrow ? 172 : 236 }}
    >
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[12px] font-semibold">Changed files</h3>
        <Button className="h-6 px-2 text-[11px] ml-auto" onClick={onToggleWidth} aria-expanded={!narrow} data-testid="diff-tree-width">
          {narrow ? 'Widen' : 'Narrow'}
        </Button>
      </div>
      <p className="px-1 text-[11px] text-faint tabular" data-testid="viewed-count">
        {files.filter((f) => viewed.has(f.path)).length} of {files.length} viewed
      </p>
      {[...groups.entries()].map(([dir, inDir]) => (
        <div key={dir || '.'}>
          {dir ? <p className="px-1 pb-0.5 font-mono text-[11px] text-faint truncate">{dir}/</p> : null}
          <ul className="flex flex-col">
            {inDir.map((f) => {
              const name = dir ? f.path.slice(dir.length + 1) : f.path;
              const isViewed = viewed.has(f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    data-testid="diff-tree-file"
                    data-path={f.path}
                    aria-current={f.path === selected ? 'true' : undefined}
                    onClick={() => onSelect(f.path)}
                    className={cx('w-full flex items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-sunken', f.path === selected && 'bg-sunken font-medium')}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                    {isViewed ? (
                      <span className="shrink-0 text-[10px] text-good" data-testid="viewed-mark">
                        viewed
                      </span>
                    ) : null}
                    {!narrow ? (
                      <span className="shrink-0 tabular text-[11px]">
                        <span className="text-good">+{f.added}</span> <span className="text-bad">-{f.removed}</span>
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
