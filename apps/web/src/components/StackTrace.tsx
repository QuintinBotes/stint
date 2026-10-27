import { useState } from 'react';
import { Link } from 'react-router';
import { Button, cx } from './ui';

export type StackFrame = { fn: string | null; file: string; line: number; col: number; library: boolean };
export type Failure = { name: string; message: string; frames: StackFrame[] };

const ANSI = /\x1b\[[0-9;]*m/g;

/** A frame in a dependency or the runtime itself, not in the project's own code. */
function isLibrary(file: string): boolean {
  return file.startsWith('node:') || file.includes('node_modules/') || file.includes('/node_modules/');
}

/**
 * One frame from a line, in the shapes Vitest and the runtime print:
 * a marker line naming a file and place, or an "at" line with an optional function.
 */
function frameFrom(line: string): StackFrame | null {
  const text = line.trim().replace(/^❯\s*/, '');
  const at = /^at\s+(?:(.+?)\s+\()?\(?([^\s()]+):(\d+):(\d+)\)?$/.exec(text);
  const bare = at ?? /^(?:(.+?)\s+)?([^\s()]+):(\d+):(\d+)\s*$/.exec(text);
  if (!bare) return null;
  const file = bare[2] as string;
  if (!file.includes('/') && !file.startsWith('node:')) return null;
  const fn = bare[1]?.trim() || null;
  // a code snippet line from Vitest also ends in numbers; a frame file has a suffix or is a runtime path
  if (!/\.[a-z]+$/i.test(file) && !file.startsWith('node:')) return null;
  return { fn, file, line: Number(bare[3]), col: Number(bare[4]), library: isLibrary(file) };
}

/** The heading of a failing test, as Vitest and bun print it; null for any other line. */
function failingName(line: string): string | null {
  const fail = /^\s*FAIL\s+(.+?)\s*$/.exec(line);
  if (fail) return (fail[1] as string).replace(/\s+\[\d+\/\d+\]\s*$/, '').trim();
  const bun = /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(line);
  if (bun) return (bun[1] as string).trim();
  const marked = /^\s*[×✗]\s+(.+?)(?:\s+\d+m?s)?\s*$/.exec(line);
  if (marked) return (marked[1] as string).trim();
  return null;
}

/**
 * The failing tests in a verification's output, one block each: its name, the error it
 * raised, and the frames it printed. Vitest prints each failure twice, so blocks are
 * merged by name and the fuller block wins.
 */
export function parseFailures(output: string): Failure[] {
  const lines = output.replace(ANSI, '').split('\n');
  const byName = new Map<string, Failure>();
  let current: Failure | null = null;
  const finish = () => {
    if (!current) return;
    const done: Failure = current;
    const seen = byName.get(done.name);
    if (!seen || done.frames.length > seen.frames.length || (!seen.message && done.message)) byName.set(done.name, done);
    current = null;
  };
  for (const line of lines) {
    const name = failingName(line);
    if (name) {
      finish();
      current = { name, message: '', frames: [] };
      continue;
    }
    if (!current) continue;
    if (/^\s*(Test Files|Tests\s+\d|Start at|Duration)\b/.test(line)) {
      finish();
      continue;
    }
    const frame = frameFrom(line);
    if (frame) {
      const key = `${frame.file}:${frame.line}:${frame.col}`;
      if (!current.frames.some((f) => `${f.file}:${f.line}:${f.col}` === key)) current.frames.push(frame);
      continue;
    }
    if (!current.message) {
      const text = line.trim();
      if (!text || /^\d+\s*\|/.test(text) || /^[⎯\-_=\s]+$/.test(text)) continue;
      const error = /^((?:[A-Za-z]+Error|AssertionError|Error|error):.*)$/.exec(text) ?? /^(expected\s.+)$/i.exec(text);
      if (error) current.message = (error[1] as string).trim();
    }
  }
  finish();
  return [...byName.values()];
}

/** The changed file a frame names, when the run touched it; a frame may carry an absolute path. */
function changedPath(frame: StackFrame, changedFiles: string[]): string | null {
  const file = frame.file.replace(/^\.\//, '');
  return changedFiles.find((f) => file === f || file.endsWith(`/${f}`)) ?? null;
}

function FrameLine({ frame, taskId, changedFiles, first }: { frame: StackFrame; taskId: string; changedFiles: string[]; first: boolean }) {
  const place = `${frame.file}:${frame.line}:${frame.col}`;
  const changed = changedPath(frame, changedFiles);
  return (
    <li
      data-testid={first ? 'stack-first-frame' : 'stack-frame'}
      className={cx('font-mono text-[11.5px] leading-[16px]', first ? 'font-semibold text-ink' : frame.library ? 'text-faint' : 'text-muted')}
    >
      {frame.fn ? <span>{frame.fn} </span> : null}
      {changed ? (
        <Link to={`/t/${taskId}?tab=diff&file=${encodeURIComponent(changed)}`} className="text-accent hover:underline" data-testid="stack-diff-link">
          {place}
        </Link>
      ) : (
        <span>{place}</span>
      )}
      {first ? <span className="ml-2 font-sans text-[11px] font-normal text-muted">first frame in this project</span> : null}
    </li>
  );
}

/**
 * The failures of a red verification, as Stack Trace cards: project frames first in
 * reading order with the first one emphasised, library frames behind a toggle.
 */
export function StackTrace({ taskId, output, changedFiles }: { taskId: string; output: string; changedFiles: string[] }) {
  const failures = parseFailures(output);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (failures.length === 0) return null;
  return (
    <section aria-label="Failing tests" data-testid="stack-trace" className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold">Stack trace</h3>
      {failures.map((failure) => {
        const project = failure.frames.filter((f) => !f.library);
        const library = failure.frames.filter((f) => f.library);
        const first = project[0] ?? null;
        const shown = open[failure.name] ? failure.frames : project;
        return (
          <article key={failure.name} data-testid="stack-failure" className="rounded-md border border-bad/50 bg-raised px-3 py-2.5">
            <p className="font-mono text-[12px] font-semibold text-bad" data-testid="stack-name">
              {failure.name}
            </p>
            {failure.message ? (
              <p className="mt-1 text-[12.5px] text-ink" data-testid="stack-message">
                {failure.message}
              </p>
            ) : null}
            {shown.length ? (
              <ol className="mt-2 flex flex-col gap-0.5">
                {shown.map((frame) => (
                  <FrameLine key={`${frame.file}:${frame.line}:${frame.col}:${frame.fn ?? ''}`} frame={frame} taskId={taskId} changedFiles={changedFiles} first={frame === first} />
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-[12px] text-faint">No stack frames were printed for this failure.</p>
            )}
            {library.length ? (
              <Button
                className="mt-2 h-7"
                onClick={() => setOpen((s) => ({ ...s, [failure.name]: !s[failure.name] }))}
                aria-expanded={!!open[failure.name]}
                data-testid="stack-library-toggle"
              >
                {open[failure.name] ? 'Hide library frames' : `Show ${library.length} library frame${library.length === 1 ? '' : 's'}`}
              </Button>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
