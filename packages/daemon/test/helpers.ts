import { Workspace } from '@stint-dev/core/node';
import type { Hono } from 'hono';
import { type Adapter, createApp } from '../src/index';

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
