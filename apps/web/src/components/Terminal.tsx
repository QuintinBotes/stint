import { useEffect, useRef, useState } from 'react';
import { ptyUrl } from '../api';
import { Button, EmptyState, Kbd } from './ui';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type State = { kind: 'connecting' } | { kind: 'open'; cwd: string } | { kind: 'closed'; reason: string };

/** A shell in the task's worktree. What the person types is recorded beside what the agents did. */
/** This tab, to the daemon: opening the terminal again replaces its shell rather than adding one. */
const CLIENT = crypto.randomUUID();

/** `onStop` stops the live run; the task view owns it, so Cmd+. works on the whole view, not only in this tab. */
export function Terminal({ taskId, liveRun, onStop }: { taskId: string; liveRun: string | null; onStop?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: 'connecting' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let gone = false;
    let close: (() => void) | undefined;
    // xterm loads with the tab, not with the app, so it stays out of the entry chunk
    Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-webgl'), import('@xterm/xterm/css/xterm.css')])
      .then(([{ Terminal: XTerm }, { FitAddon }, { WebglAddon }]) => {
        if (gone) return;
        const term = new XTerm({
          fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
          fontSize: 13,
          cursorBlink: true,
          // the WebGL renderer draws to a canvas; this keeps the rows readable by screen readers
          screenReaderMode: true,
          theme: { background: token('--term'), foreground: token('--term-ink'), cursor: token('--term-ink') },
          // xterm shifts any colour a program prints until it reads at 4.5:1 on the terminal ground
          minimumContrastRatio: 4.5,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(el);
        // WebGL draws faster; without it (no context, or the context is lost) xterm keeps its DOM renderer
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl);
        } catch {
          // the DOM renderer stays
        }
        fit.fit();

        const ws = new WebSocket(ptyUrl(taskId, CLIENT));
        ws.binaryType = 'arraybuffer';
        const encoder = new TextEncoder();
        let ready = false;
        const sendSize = () => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ resize: [term.cols, term.rows] }));
        };
        ws.onmessage = (m) => {
          if (typeof m.data === 'string') {
            try {
              const msg = JSON.parse(m.data) as { ready?: boolean; cwd?: string };
              if (msg.ready) {
                ready = true;
                setState({ kind: 'open', cwd: msg.cwd ?? '' });
                sendSize();
                term.focus();
              }
            } catch {
              term.write(m.data);
            }
            return;
          }
          term.write(new Uint8Array(m.data as ArrayBuffer));
        };
        ws.onclose = () =>
          !gone &&
          setState({
            kind: 'closed',
            reason: ready ? 'The terminal session ended.' : 'No copy of the code to open a terminal in. A run makes one, and a merge removes it.',
          });
        const typed = term.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(d));
        });
        const resized = new ResizeObserver(() => {
          fit.fit();
          sendSize();
        });
        resized.observe(el);
        close = () => {
          resized.disconnect();
          typed.dispose();
          ws.close();
          term.dispose();
        };
      })
      .catch(() => !gone && setState({ kind: 'closed', reason: 'The terminal could not load. Reload the page to try again.' }));
    return () => {
      gone = true;
      close?.();
    };
  }, [taskId]);

  const noWorktree = state.kind === 'closed' && state.reason.startsWith('No worktree');
  return (
    <div className="flex flex-col gap-2 h-[min(70vh,640px)] min-h-[360px]" data-testid="terminal">
      <div className="flex flex-wrap items-center gap-2 text-small text-ink-2">
        <span className="text-body font-semibold text-ink">Terminal in the task's copy of the code</span>
        {noWorktree ? null : (
          <span className="font-mono truncate rounded-[3px] border border-rule bg-panel px-2 py-1 max-w-[48ch]" data-testid="terminal-cwd">
            {state.kind === 'open' ? state.cwd : state.kind === 'connecting' ? 'Opening the terminal.' : state.reason}
          </span>
        )}
        <span className="ml-auto flex gap-2 shrink-0">
          {state.kind === 'open' ? (
            <Button
              className="h-8 px-2.5 text-small"
              onClick={() => {
                void navigator.clipboard.writeText(`cd ${state.cwd}`).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy the cd command'}
            </Button>
          ) : null}
          {liveRun && onStop ? (
            <Button tone="danger" className="h-8 px-2.5 text-small" title={`Kill ${liveRun}`} aria-keyshortcuts="Meta+Period" onClick={onStop} data-testid="kill-run">
              Kill run <Kbd>⌘.</Kbd>
            </Button>
          ) : null}
        </span>
      </div>
      {noWorktree ? <EmptyState testId="empty-terminal">{state.reason}</EmptyState> : null}
      <div ref={host} className="flex-1 min-h-[320px] rounded-[5px] overflow-hidden border border-rule p-2" style={{ background: 'var(--term)', display: state.kind === 'closed' && !state.reason.startsWith('The terminal session') ? 'none' : undefined }} />
      {state.kind === 'open' ? <p className="text-small text-ink-2">What you type here is recorded on the run rail, next to what the agents did.</p> : null}
    </div>
  );
}
