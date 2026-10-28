import { Workspace } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { type Adapter, type RunContext, type RunResult, createApp } from '../src/index';

export { withFixtureRepo, tempDir } from '../../core/test/fixture';

export const TOKEN = 'test-token-0123456789abcdef';
export const auth = { Authorization: `Bearer ${TOKEN}` };

export async function makeApp(root: string, adapters: Adapter[] = [], extra: Record<string, unknown> = {}) {
  const ws = await Workspace.open(root);
  const app = createApp(ws, adapters, { token: TOKEN, quiet: true, webDist: null, heartbeatMs: 60_000, pollMs: 50, ...extra });
  return { ws, app };
}

export const post = (app: Hono, path: string, body: unknown, headers: Record<string, string> = auth) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const newTask = { title: 'Rate-limit incoming webhooks', goal: 'Answer 429 when a tenant is over the limit.', acceptance: ['429 with Retry-After'], testCommand: 'bun run test' };

export type SSEFrame = { event: string; id?: string; data: string };

/** Reads SSE frames from a streaming response until `done` says stop or the timeout passes. */
export async function readSSE(res: Response, done: (frames: SSEFrame[]) => boolean, timeoutMs = 2000): Promise<SSEFrame[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const frames: SSEFrame[] = [];
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (!done(frames) && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(() => ({ done: true, value: undefined })),
      ]);
      if (chunk.done || !chunk.value) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let i = buf.indexOf('\n\n');
      while (i >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f: SSEFrame = { event: 'message', data: '' };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) f.event = line.slice(7);
          else if (line.startsWith('id: ')) f.id = line.slice(4);
          else if (line.startsWith('data: ')) f.data += line.slice(6);
        }
        frames.push(f);
        i = buf.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return frames;
}


export type FakeBehaviour = 'sleep' | 'edit';

/** An adapter that needs no model: it sleeps until stopped, or writes a file and completes. */
export function fakeAdapter(behaviour: FakeBehaviour, roles: Array<'planner' | 'implementer' | 'reviewer'> = ['implementer']): Adapter & { seen: RunContext[] } {
  const seen: RunContext[] = [];
  return {
    id: 'fake',
    vendor: 'local',
    roles,
    capabilities: { editsFiles: true, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
    available: async () => ({ ok: true, version: 'fake 1' }),
    gate: () => 'none',
    seen,
    async run(ctx): Promise<RunResult> {
      seen.push(ctx);
      await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: 'src/lib/limiter.ts' }, callId: 'c1' } });
      if (behaviour === 'sleep') {
        // a stop can land before the listener is attached; an already aborted signal never fires again
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) resolve();
          else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { endedBy: 'killed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 }, inFlight: 'write_file src/lib/limiter.ts' };
      }
      await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
      await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'write_file', callId: 'c1', ok: true, summary: 'wrote 1 line' } });
      await ctx.emit({ type: 'agent.message', payload: { text: 'Added the limiter constant.' } });
      return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 40, outputTokens: 20, usd: 0.001 } };
    },
  };
}

/** A task the fake agent built on its branch, with a green verification on record: ready to approve. */
export async function builtTask(repo: string, verification: 'green' | 'red' = 'green') {
  const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
  const t = await ws.createTask(newTask);
  await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
  for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran'); i++) await Bun.sleep(50);
  for (let i = 0; i < 200 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(25);
  const green = verification === 'green';
  // the commit the tests ran on: approve merges only that commit
  const commit = (await ws.verification(t.id).latest())?.commit;
  await ws.verification(t.id).write({ run: 'r1', command: 'bun run test', exitCode: green ? 0 : 1, passed: green ? 33 : 30, failed: green ? 0 : 3, durationMs: 1700, runBy: 'daemon', status: verification, outputRef: 'verification/r1.out.txt', at: new Date().toISOString(), ...(commit ? { commit } : {}) });
  await ws.writeTask(t.id, { status: 'awaiting_approval' });
  return { app, ws, t };
}
