import { timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { DaemonContext } from '../app';
import { runEnv } from '../env';
import { DaemonError } from '../errors';
import { pty, ptyBackend, ptyHealth, type PtyHandle, trackTerminal } from '../pty';
import { currentWorktree } from './work';

const { upgradeWebSocket } = createBunWebSocket();

const MAX_COMMAND_BYTES = 2048;
const encoder = new TextEncoder();

function logError(message: string): void {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message })}\n`);
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The token arrives as the `token` query value or in the `Sec-WebSocket-Protocol` list. */
function tokenAccepted(query: string | undefined, protocol: string | undefined, token: string): boolean {
  if (query !== undefined && sameToken(query, token)) return true;
  return (protocol ?? '')
    .split(',')
    .map((p) => p.trim())
    .some((p) => p.length > 0 && sameToken(p, token));
}

type EscapeState = 'none' | 'esc' | 'csi' | 'osc' | 'osc-esc';

/**
 * A simple line buffer over the bytes a person sends to the terminal.
 * Enter submits the line; backspace rubs a character out. A control or escape
 * sequence marks the line approximate: the shell edited it in ways this buffer
 * cannot see, and the timeline should say so.
 */
export class LineCapture {
  private chars: string[] = [];
  private bytes = 0;
  private approximate = false;
  private escape: EscapeState = 'none';
  private skipLf = false;
  private readonly decoder = new TextDecoder();

  constructor(private readonly onLine: (command: string, approximate: boolean) => void) {}

  feed(data: Uint8Array): void {
    for (const ch of this.decoder.decode(data, { stream: true })) this.char(ch);
  }

  private char(ch: string): void {
    if (this.escape !== 'none') {
      this.escapeChar(ch);
      return;
    }
    if (this.skipLf) {
      this.skipLf = false;
      if (ch === '\n') return;
    }
    if (ch === '\r') {
      this.skipLf = true;
      this.submit();
      return;
    }
    if (ch === '\n') {
      this.submit();
      return;
    }
    if (ch === '\x1b') {
      this.approximate = true;
      this.escape = 'esc';
      return;
    }
    if (ch === '\x7f' || ch === '\b') {
      const popped = this.chars.pop();
      if (popped !== undefined) this.bytes -= encoder.encode(popped).byteLength;
      return;
    }
    if (ch === '\x03' || ch === '\x15') {
      // Ctrl-C abandons the line and Ctrl-U clears it in the shell too.
      this.approximate = true;
      this.chars = [];
      this.bytes = 0;
      return;
    }
    if ((ch.codePointAt(0) ?? 0) < 0x20) {
      // Tab completion and friends change the line before our eyes.
      this.approximate = true;
      return;
    }
    if (ch === '\uFFFD') this.approximate = true;
    const len = encoder.encode(ch).byteLength;
    if (this.bytes + len > MAX_COMMAND_BYTES) {
      this.approximate = true;
      return;
    }
    this.chars.push(ch);
    this.bytes += len;
  }

  private escapeChar(ch: string): void {
    const code = ch.codePointAt(0) ?? 0;
    if (this.escape === 'esc') {
      if (ch === '[') this.escape = 'csi';
      else if (ch === ']') this.escape = 'osc';
      else this.escape = 'none';
    } else if (this.escape === 'csi') {
      if (code >= 0x40 && code <= 0x7e) this.escape = 'none';
    } else if (this.escape === 'osc') {
      if (ch === '\x07') this.escape = 'none';
      else if (ch === '\x1b') this.escape = 'osc-esc';
    } else {
      this.escape = 'none';
    }
  }

  private submit(): void {
    const command = this.chars.join('').trim();
    const approximate = this.approximate;
    this.chars = [];
    this.bytes = 0;
    this.approximate = false;
    if (command.length > 0) this.onLine(command, approximate);
  }
}

function clampSize(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 1 ? Math.min(n, 1000) : null;
}

/**
 * `GET /api/tasks/:id/pty`: a login shell in the task's worktree.
 * Binary frames carry terminal bytes both ways and are never JSON-wrapped;
 * a text frame is JSON control, `{ "resize": [cols, rows] }` or `{ "kill": true }`.
 * A text frame that is not a control object is typed input, as a client may
 * have no binary send; control objects are never typed into the shell.
 */
export function ptyRoutes(app: Hono, ctx: DaemonContext): void {
  app.get(
    '/api/tasks/:id/pty',
    async (c, next) => {
      if (!tokenAccepted(c.req.query('token'), c.req.header('sec-websocket-protocol'), ctx.opts.token)) {
        throw new DaemonError('unauthorized', 'the PTY route needs the daemon token', 'send the token in Sec-WebSocket-Protocol or as the token query parameter');
      }
      const id = c.req.param('id');
      await ctx.ws.readTask(id);
      await currentWorktree(ctx, id);
      if (ptyBackend() === 'unavailable') {
        throw new DaemonError('adapter_unavailable', 'no PTY backend is available', ptyHealth().reason);
      }
      await next();
    },
    upgradeWebSocket(async (c) => {
      const taskId = c.req.param('id');
      if (!taskId) throw new DaemonError('not_found', 'no task on this route');
      const wt = await currentWorktree(ctx, taskId);
      // a tab sends its client id, so opening the terminal again replaces its old shell instead of adding one
      const client = c.req.query('client') || crypto.randomUUID();
      let untrack: (() => void) | undefined;
      let handle: PtyHandle | undefined;
      let cols = 80;
      let rows = 24;
      let closed = false;

      const capture = new LineCapture((command, approximate) => {
        void ctx.ws
          .events(taskId)
          .append({ task: taskId, run: wt.run, vendor: 'human', type: 'human.command', payload: { command, approximate } })
          .catch((err: unknown) => logError(`human.command append failed: ${err instanceof Error ? err.message : String(err)}`));
      });
      const feed = (bytes: Uint8Array) => {
        capture.feed(bytes);
        handle?.write(bytes);
      };
      const shutdown = () => {
        closed = true;
        handle?.kill();
      };
      /** Returns true when the text frame was a control object. */
      const control = (text: string): boolean => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return false;
        }
        if (parsed === null || typeof parsed !== 'object') return false;
        const obj = parsed as { resize?: unknown; kill?: unknown };
        if ('kill' in obj) {
          if (obj.kill === true) handle?.kill();
          return true;
        }
        if ('resize' in obj) {
          const pair = Array.isArray(obj.resize) ? obj.resize : [];
          const nextCols = clampSize(pair[0]);
          const nextRows = clampSize(pair[1]);
          if (nextCols !== null && nextRows !== null) {
            cols = nextCols;
            rows = nextRows;
            handle?.resize(cols, rows);
          }
          return true;
        }
        return false;
      };

      return {
        onOpen(_evt, ws) {
          ws.send(JSON.stringify({ ready: true, backend: ptyBackend(), cwd: wt.path }));
          // the person's own terminal: their credentials stay, as in any shell they open
          const env = { ...runEnv(taskId, wt.run, wt.path, { credentials: true }), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
          try {
            handle = pty.spawn({ cwd: wt.path, env, cols, rows, shell: process.env.SHELL ?? '/bin/bash' });
          } catch (err) {
            logError(`pty spawn failed for ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
            ws.close(1011, 'pty unavailable');
            return;
          }
          untrack = trackTerminal(wt.path, client, () => {
            shutdown();
            try {
              ws.close(1000, 'replaced or the worktree is gone');
            } catch {
              // The client is already gone.
            }
          });
          handle.onData((d) => {
            try {
              ws.send(new Uint8Array(d));
            } catch {
              shutdown();
            }
          });
          handle.onExit(() => {
            if (closed) return;
            closed = true;
            try {
              ws.close();
            } catch {
              // The client is already gone.
            }
          });
        },
        onMessage(evt) {
          const data = evt.data;
          if (typeof data === 'string') {
            if (!control(data)) feed(encoder.encode(data));
          } else if (data instanceof Blob) {
            void data.arrayBuffer().then((buf) => feed(new Uint8Array(buf)));
          } else {
            feed(new Uint8Array(data as ArrayBuffer));
          }
        },
        onClose() {
          shutdown();
          untrack?.();
        },
        onError() {
          shutdown();
          untrack?.();
        },
      };
    }),
  );
}
