import { describe, expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { RunRegistry, Worktrees, activePtyCount, createPty, ptyBackend, startDaemon, type RunningDaemon } from '../src/index';
import { newTask, tempDir, withFixtureRepo } from './helpers';

const hasTerminal = typeof Bun.Terminal === 'function';

type ReadyFrame = { ready: boolean; backend: string; cwd: string };

type PtyClient = {
  ws: WebSocket;
  ready: ReadyFrame;
  output: () => string;
  waitFor: (needle: string, timeoutMs: number) => Promise<void>;
  waitClosed: (timeoutMs: number) => Promise<void>;
  sendBytes: (text: string) => void;
  close: () => void;
};

/** A task `T-0001` with run `r1` started and its worktree created on the fixture. */
async function setupWorktree(repo: string): Promise<{ taskId: string; worktree: string }> {
  const ws = await Workspace.open(repo);
  const task = await ws.createTask(newTask);
  await ws.events(task.id).append({ task: task.id, run: 'r1', vendor: 'daemon', type: 'run.started', payload: { adapter: 'fake', role: 'implementer' } });
  const created = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
  return { taskId: task.id, worktree: created.path };
}

/** Runs `fn` against a real daemon on `repo`, with the login shell pinned to bash for determinism. */
async function withDaemon<T>(repo: string, fn: (daemon: RunningDaemon) => Promise<T>): Promise<T> {
  const prevShell = process.env.SHELL;
  process.env.SHELL = '/bin/bash';
  const daemon = await startDaemon({ root: repo, quiet: true });
  try {
    return await fn(daemon);
  } finally {
    await daemon.stop();
    if (prevShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = prevShell;
  }
}

async function connectPty(daemon: RunningDaemon, taskId: string): Promise<PtyClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/api/tasks/${taskId}/pty?token=${encodeURIComponent(daemon.token)}`);
  ws.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();
  let out = '';
  let ready: ReadyFrame | null = null;
  let closed = false;
  const readyPromise = new Promise<ReadyFrame>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the ready frame')), 5000);
    ws.onmessage = async (e) => {
      if (typeof e.data === 'string') {
        const frame = JSON.parse(e.data) as ReadyFrame;
        if (frame.ready && !ready) {
          ready = frame;
          clearTimeout(timer);
          resolve(frame);
        }
        return;
      }
      const buf = e.data instanceof Blob ? await e.data.arrayBuffer() : (e.data as ArrayBuffer);
      out += decoder.decode(new Uint8Array(buf), { stream: true });
    };
    ws.onerror = () => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error('the PTY socket errored before the ready frame'));
      }
    };
    ws.onclose = () => {
      closed = true;
      if (!ready) {
        clearTimeout(timer);
        reject(new Error('the PTY socket closed before the ready frame'));
      }
    };
  });
  const frame = await readyPromise;
  return {
    ws,
    ready: frame,
    output: () => out,
    waitFor: async (needle, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (out.includes(needle)) return;
        if (closed) break;
        await Bun.sleep(15);
      }
      throw new Error(`timed out waiting for ${JSON.stringify(needle)} in terminal output; got: ${JSON.stringify(out.slice(-400))}`);
    },
    waitClosed: async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (!closed && Date.now() < deadline) await Bun.sleep(15);
      if (!closed) throw new Error('timed out waiting for the PTY socket to close');
    },
    sendBytes: (text) => ws.send(new TextEncoder().encode(text)),
    close: () => ws.close(),
  };
}

/** Opens a socket without a token and reports whether it ever opened. */
function attemptWithoutToken(daemon: RunningDaemon, taskId: string): Promise<'opened' | 'refused'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/api/tasks/${taskId}/pty`);
    const timer = setTimeout(() => {
      ws.close();
      resolve('refused');
    }, 3000);
    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      resolve('opened');
    };
    ws.onclose = () => {
      clearTimeout(timer);
      resolve('refused');
    };
    ws.onerror = () => undefined;
  });
}

describe('pty route', () => {
  test.skipIf(!hasTerminal)('On macOS and Linux (CI), opening the PTY route on the fixture\'s worktree and sending `ls\\n` returns output containing `package.json` within 2 s', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId, worktree } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const client = await connectPty(daemon, taskId);
        try {
          expect(client.ready).toEqual({ ready: true, backend: ptyBackend(), cwd: worktree });
          client.sendBytes('ls\n');
          await client.waitFor('package.json', 2000);
        } finally {
          client.close();
        }
      });
    });
  });

  test.skipIf(!hasTerminal)('Sending `{ "resize": [120, 40] }` is reflected by `stty size` output', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const client = await connectPty(daemon, taskId);
        try {
          client.ws.send(JSON.stringify({ resize: [120, 40] }));
          client.sendBytes('stty size\n');
          await client.waitFor('40 120', 5000);
        } finally {
          client.close();
        }
      });
    });
  });

  test.skipIf(!hasTerminal)('Typing `echo hi` and Enter produces a `human.command` event with `payload.command: "echo hi"`', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const client = await connectPty(daemon, taskId);
        try {
          client.sendBytes('echo hi\r');
          const deadline = Date.now() + 5000;
          let events = await daemon.ws.events(taskId).read();
          while (!events.some((e) => e.type === 'human.command') && Date.now() < deadline) {
            await Bun.sleep(25);
            events = await daemon.ws.events(taskId).read();
          }
          const commands = events.filter((e) => e.type === 'human.command');
          expect(commands).toHaveLength(1);
          expect(commands[0]?.payload).toEqual({ command: 'echo hi', approximate: false });
          expect(commands[0]?.vendor).toBe('human');
          expect(commands[0]?.run).toBe('r1');
        } finally {
          client.close();
        }
      });
    });
  });

  test.skipIf(!hasTerminal)('A connection without the token is refused with 401', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const noToken = await fetch(`http://127.0.0.1:${daemon.port}/api/tasks/${taskId}/pty`);
        expect(noToken.status).toBe(401);
        expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe('unauthorized');

        const wrongToken = await fetch(`http://127.0.0.1:${daemon.port}/api/tasks/${taskId}/pty?token=wrong`);
        expect(wrongToken.status).toBe(401);

        expect(await attemptWithoutToken(daemon, taskId)).toBe('refused');
      });
    });
  });

  test.skipIf(!hasTerminal)('The token in Sec-WebSocket-Protocol opens the PTY without a query token', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/api/tasks/${taskId}/pty`, [daemon.token]);
        try {
          const frame = await new Promise<ReadyFrame>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timed out waiting for the ready frame')), 5000);
            ws.onmessage = (e) => {
              if (typeof e.data !== 'string') return;
              clearTimeout(timer);
              resolve(JSON.parse(e.data) as ReadyFrame);
            };
            ws.onclose = () => {
              clearTimeout(timer);
              reject(new Error('the PTY socket closed before the ready frame'));
            };
          });
          expect(frame.ready).toBe(true);
          expect(frame.backend).toBe(ptyBackend());
        } finally {
          ws.close();
        }
      });
    });
  });

  test.skipIf(!hasTerminal)('Backspace edits the captured line and an escape sequence marks it approximate', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const client = await connectPty(daemon, taskId);
        try {
          client.sendBytes('echo hii\x7f\r');
          client.sendBytes('echo two\x1b[D\r');
          const deadline = Date.now() + 5000;
          let events = await daemon.ws.events(taskId).read();
          while (events.filter((e) => e.type === 'human.command').length < 2 && Date.now() < deadline) {
            await Bun.sleep(25);
            events = await daemon.ws.events(taskId).read();
          }
          expect(events.filter((e) => e.type === 'human.command').map((e) => e.payload)).toEqual([
            { command: 'echo hi', approximate: false },
            { command: 'echo two', approximate: true },
          ]);
        } finally {
          client.close();
        }
      });
    });
  });

  test.skipIf(!hasTerminal)('Sending `{ "kill": true }` ends the shell and closes the socket', async () => {
    await withFixtureRepo(async (repo) => {
      const { taskId } = await setupWorktree(repo);
      await withDaemon(repo, async (daemon) => {
        const client = await connectPty(daemon, taskId);
        client.ws.send(JSON.stringify({ kill: true }));
        await client.waitClosed(5000);
        expect(activePtyCount()).toBe(0);
      });
    });
  });

  test.skipIf(!hasTerminal)('A task with no worktree is refused with 404 not_found', async () => {
    await withFixtureRepo(async (repo) => {
      await withDaemon(repo, async (daemon) => {
        const task = await daemon.ws.createTask(newTask);
        const res = await fetch(`http://127.0.0.1:${daemon.port}/api/tasks/${task.id}/pty?token=${encodeURIComponent(daemon.token)}`);
        expect(res.status).toBe(404);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found');
      });
    });
  });
});

describe('pty module', () => {
  test.skipIf(!hasTerminal)('spawn runs a login shell that answers, and kill ends it', async () => {
    const tmp = tempDir();
    try {
      const env: Record<string, string> = { TERM: 'xterm-256color' };
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      const handle = createPty().spawn({ cwd: tmp.dir, env, cols: 80, rows: 24, shell: '/bin/bash' });
      expect(handle.pid).toBeGreaterThan(0);
      const decoder = new TextDecoder();
      let out = '';
      handle.onData((d) => {
        out += decoder.decode(d, { stream: true });
      });
      const exited = new Promise<number | null>((resolve) => handle.onExit(resolve));
      handle.write(new TextEncoder().encode('echo pty-marker\n'));
      const deadline = Date.now() + 5000;
      while (!out.includes('pty-marker') && Date.now() < deadline) await Bun.sleep(15);
      expect(out).toContain('pty-marker');

      handle.kill();
      const code = await Promise.race([exited, Bun.sleep(5000).then(() => 'timeout' as const)]);
      expect(code).not.toBe('timeout');
      expect(activePtyCount()).toBe(0);
    } finally {
      tmp.cleanup();
    }
  });
});
