import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
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
    if (!host.current) return;
    const term = new XTerm({
      fontFamily: '"Martian Mono Variable", ui-monospace, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      // the WebGL renderer draws to a canvas; this keeps the rows readable by screen readers
      screenReaderMode: true,
      theme: { background: token('--term'), foreground: token('--term-ink'), cursor: token('--term-ink') },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
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
      setState({
        kind: 'closed',
        reason: ready ? 'The shell ended.' : 'No worktree to open a shell in. A run creates one; after a merge the worktree is removed and the branch stays.',
      });
    const typed = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(d));
    });
    const resized = new ResizeObserver(() => {
      fit.fit();
      sendSize();
    });
    resized.observe(host.current);
    return () => {
      resized.disconnect();
      typed.dispose();
      ws.close();
      term.dispose();
    };
  }, [taskId]);

  return (
    <div className="flex flex-col gap-2 h-[min(70vh,640px)] min-h-[360px]" data-testid="terminal">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
        <span className="text-[14px] font-semibold text-ink">Shell in the run's worktree</span>
        <span className="font-mono truncate rounded-[3px] border border-rule bg-panel px-2 py-1 max-w-[48ch]" data-testid="terminal-cwd">
          {state.kind === 'open' ? state.cwd : state.kind === 'connecting' ? 'Opening a shell in the worktree.' : state.reason.startsWith('No worktree') ? 'No worktree' : state.reason}
        </span>
        <span className="hidden lg:inline">owned by the daemon</span>
        <span className="ml-auto flex gap-2 shrink-0">
          {state.kind === 'open' ? (
            <Button
              className="h-7"
              onClick={() => {
                void navigator.clipboard.writeText(`cd ${state.cwd}`).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy cd'}
            </Button>
          ) : null}
          {liveRun && onStop ? (
            <Button tone="danger" className="h-7" title={`Kill ${liveRun}`} onClick={onStop} data-testid="kill-run">
              Kill run <Kbd>⌘.</Kbd>
            </Button>
          ) : null}
        </span>
      </div>
      {state.kind === 'closed' && state.reason.startsWith('No worktree') ? <EmptyState testId="empty-terminal">{state.reason}</EmptyState> : null}
      <div ref={host} className="flex-1 min-h-[320px] rounded-[4px] overflow-hidden border border-rule p-2" style={{ background: 'var(--term)', display: state.kind === 'closed' && !state.reason.startsWith('The shell') ? 'none' : undefined }} />
      {state.kind === 'open' ? <p className="text-[12px] text-ink-2">Lines you type here join race control as your commands, next to what the agent did.</p> : null}
    </div>
  );
}
