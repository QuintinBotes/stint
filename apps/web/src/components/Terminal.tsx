import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { api, ptyUrl } from '../api';
import { Button, EmptyState } from './ui';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type State = { kind: 'connecting' } | { kind: 'open'; cwd: string } | { kind: 'closed'; reason: string };

/** A shell in the task's worktree. What the person types is recorded beside what the agents did. */
export function Terminal({ taskId, liveRun }: { taskId: string; liveRun: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: 'connecting' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const term = new XTerm({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      theme: { background: token('--terminal-ground'), foreground: token('--terminal-ink'), cursor: token('--terminal-ink') },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();

    const ws = new WebSocket(ptyUrl(taskId));
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
    <div className="flex flex-col gap-2 h-full min-h-[360px]" data-testid="terminal">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="font-mono truncate" data-testid="terminal-cwd">
          {state.kind === 'open' ? state.cwd : state.kind === 'connecting' ? 'Opening a shell in the worktree.' : state.reason}
        </span>
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
          {liveRun ? (
            <Button tone="danger" className="h-7" onClick={() => void api.stopRun(taskId, liveRun).catch(() => undefined)} data-testid="kill-run">
              Kill {liveRun}
            </Button>
          ) : null}
        </span>
      </div>
      {state.kind === 'closed' && state.reason.startsWith('No worktree') ? <EmptyState testId="empty-terminal">{state.reason}</EmptyState> : null}
      <div ref={host} className="flex-1 min-h-[320px] rounded-md overflow-hidden border border-line p-2" style={{ background: 'var(--terminal-ground)', display: state.kind === 'closed' && !state.reason.startsWith('The shell') ? 'none' : undefined }} />
    </div>
  );
}
