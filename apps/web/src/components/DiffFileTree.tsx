import { type Agent, markColor } from '../agents';
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
  writers,
  later,
}: {
  files: DiffFileEntry[];
  selected: string | null;
  viewed: Set<string>;
  narrow: boolean;
  onSelect: (path: string) => void;
  onToggleWidth: () => void;
  /** The driver who first wrote each file, so its row carries that team's livery. */
  writers?: Map<string, Agent>;
  /** Files not written yet at the moment the race clock is on. */
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
      className="shrink-0 flex flex-col gap-2 rounded-[4px] border border-rule p-2 self-start"
      style={{ width: narrow ? 172 : 236 }}
    >
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[14px] font-bold">Changed files</h3>
        <Button className="h-6 px-2 text-[12px] ml-auto" onClick={onToggleWidth} aria-expanded={!narrow} data-testid="diff-tree-width">
          {narrow ? 'Widen' : 'Narrow'}
        </Button>
      </div>
      <p className="px-1 text-[12px] text-ink-3 tabular" data-testid="viewed-count">
        {files.filter((f) => viewed.has(f.path)).length} of {files.length} viewed
      </p>
      {[...groups.entries()].map(([dir, inDir]) => (
        <div key={dir || '.'}>
          {dir ? <p className="px-1 pb-1 font-mono text-[12px] text-ink-3 truncate">{dir}/</p> : null}
          <ul className="flex flex-col">
            {inDir.map((f) => {
              const name = dir ? f.path.slice(dir.length + 1) : f.path;
              const isViewed = viewed.has(f.path);
              const writer = writers?.get(f.path);
              const notYet = later?.has(f.path) ?? false;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    data-testid="diff-tree-file"
                    data-path={f.path}
                    aria-current={f.path === selected ? 'true' : undefined}
                    onClick={() => onSelect(f.path)}
                    className={cx('w-full flex items-center gap-2 rounded-[3px] px-2 py-1 text-left text-[12px] hover:bg-panel', f.path === selected && 'bg-panel font-bold shadow-[inset_2px_0_0_var(--ink)]', notYet && 'opacity-50')}
                  >
                    <span aria-hidden="true" className="shrink-0 w-1 h-3.5 rounded-[1px]" style={{ background: writer ? markColor[writer.mark] : 'var(--rule-strong)' }} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{name}</span>
                    {writer && !narrow ? <span className="shrink-0 text-[12px] font-extrabold stretch-75 text-ink-2" title={`${writer.name} wrote it`}>{writer.code}</span> : null}
                    {notYet ? <span className="sr-only">, not written yet at this moment</span> : null}
                    {isViewed ? (
                      <span className="shrink-0 text-[12px] text-green" data-testid="viewed-mark">
                        viewed
                      </span>
                    ) : null}
                    {!narrow ? (
                      <span className="shrink-0 tabular text-[12px]">
                        <span className="text-green">+{f.added}</span> <span className="text-ink-2">-{f.removed}</span>
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
