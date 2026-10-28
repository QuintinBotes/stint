import { cx } from './ui';

export type DiffFileEntry = { path: string; added: number; removed: number };

/** The changed files grouped by directory, with how many you have viewed. */
export function DiffFileTree({
  files,
  selected,
  viewed,
  onSelect,
  later,
}: {
  files: DiffFileEntry[];
  selected: string | null;
  viewed: Set<string>;
  onSelect: (path: string) => void;
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
      className="shrink-0 flex flex-col gap-2 self-start w-full sm:w-[220px]"
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h3 className="font-semibold">Changed files</h3>
        <span className="text-small text-ink-2 tabular" data-testid="viewed-count">
          {files.filter((f) => viewed.has(f.path)).length} of {files.length} viewed
        </span>
      </div>
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
                    <span className="shrink-0 tabular text-small text-ink-2">
                      +{f.added} -{f.removed}
                    </span>
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
