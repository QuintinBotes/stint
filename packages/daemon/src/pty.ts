/** A shell attached to a real pseudo terminal: spawn, write, resize, data, kill. */
export interface PtyHandle {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  onData(cb: (d: Uint8Array) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(signal?: string): void;
  pid: number;
}

export interface Pty {
  spawn(opts: { cwd: string; env: Record<string, string>; cols: number; rows: number; shell?: string }): PtyHandle;
}

export type PtyBackend = 'bun-terminal' | 'unavailable';

const UNAVAILABLE_REASON = 'Bun.Terminal is not available in this Bun runtime';

/** The backend this daemon can offer; `unavailable` is reported honestly, never papered over. */
export function ptyBackend(): PtyBackend {
  return typeof Bun !== 'undefined' && typeof Bun.Terminal === 'function' ? 'bun-terminal' : 'unavailable';
}

/** The `/api/health` shape: the backend chosen, with a reason when there is none. */
export function ptyHealth(): { backend: PtyBackend; reason?: string } {
  const backend = ptyBackend();
  return backend === 'unavailable' ? { backend, reason: UNAVAILABLE_REASON } : { backend };
}

const live = new Set<PtyHandle>();

/** Kills every live PTY; the daemon calls this when it stops so no shell outlives it. */
export function killAllPtys(): void {
  for (const handle of [...live]) handle.kill();
}

/** How many PTYs are open right now. */
export function activePtyCount(): number {
  return live.size;
}

function sizeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Spawns the shell as a login shell (`-l`). A `shell` value with spaces is
 * taken as a full argv, so a caller can pass other words when it needs them.
 */
function shellArgv(shell: string | undefined): string[] {
  const chosen = (shell ?? process.env.SHELL ?? '/bin/bash').trim();
  return chosen.includes(' ') ? chosen.split(/\s+/) : [chosen, '-l'];
}

/** A `Pty` backed by `Bun.Terminal` and `Bun.spawn`. */
export class BunTerminalPty implements Pty {
  spawn(opts: { cwd: string; env: Record<string, string>; cols: number; rows: number; shell?: string }): PtyHandle {
    if (ptyBackend() === 'unavailable') throw new Error(UNAVAILABLE_REASON);

    const dataCbs: Array<(d: Uint8Array) => void> = [];
    const exitCbs: Array<(code: number | null) => void> = [];
    const pending: Uint8Array[] = [];
    let exitCode: number | null | undefined;
    let closed = false;

    const emitData = (d: Uint8Array) => {
      const copy = new Uint8Array(d);
      if (dataCbs.length === 0) pending.push(copy);
      else for (const cb of dataCbs) cb(copy);
    };
    const emitExit = (code: number | null) => {
      if (exitCode !== undefined) return;
      exitCode = code;
      live.delete(handle);
      for (const cb of exitCbs) cb(code);
    };

    const proc = Bun.spawn(shellArgv(opts.shell), {
      cwd: opts.cwd,
      env: opts.env,
      terminal: {
        cols: sizeOr(opts.cols, 80),
        rows: sizeOr(opts.rows, 24),
        name: 'xterm-256color',
        data: (_terminal, data) => emitData(data),
      },
      onExit: (_subprocess, code) => emitExit(code),
    });
    const terminal = proc.terminal;
    if (!terminal) {
      proc.kill();
      throw new Error('Bun.spawn did not attach a terminal');
    }
    void proc.exited.then((code) => emitExit(code));

    const handle: PtyHandle = {
      pid: proc.pid,
      write(data) {
        if (closed || terminal.closed) return;
        try {
          terminal.write(data);
        } catch {
          // The shell is gone; the exit callback carries the news.
        }
      },
      resize(cols, rows) {
        if (closed || terminal.closed) return;
        try {
          terminal.resize(sizeOr(cols, 80), sizeOr(rows, 24));
        } catch {
          // Same as write: a dead terminal has nothing to resize.
        }
      },
      onData(cb) {
        dataCbs.push(cb);
        for (const chunk of pending.splice(0)) cb(chunk);
      },
      onExit(cb) {
        if (exitCode !== undefined) cb(exitCode);
        else exitCbs.push(cb);
      },
      kill(signal) {
        if (closed) return;
        closed = true;
        live.delete(handle);
        try {
          proc.kill(signal as NodeJS.Signals | undefined);
        } catch {
          // Already exited.
        }
        try {
          terminal.close();
        } catch {
          // Already closed.
        }
      },
    };
    live.add(handle);
    return handle;
  }
}

/** Creates a `Pty` on the available backend. */
export function createPty(): Pty {
  return new BunTerminalPty();
}

/** The shared `Pty` the daemon routes spawn through; every handle joins the live set regardless. */
export const pty: Pty = new BunTerminalPty();
