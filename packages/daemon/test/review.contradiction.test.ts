import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '../src/index';
import { TOKEN, auth, newTask, withFixtureRepo } from './helpers';

const review = {
  version: 'stint.review/1',
  verdict: 'approve',
  findings: [
    { id: 'F1', severity: 'minor', file: 'src/lib/limiter.ts', text: 'The limit is hard-coded; read it through loadConfig().' },
    { id: 'F2', severity: 'note', file: 'src/lib/limiter.ts', text: 'A fixed window counter would use less memory than the sliding window.', contradictsDecision: 'D3' },
  ],
  blockers: [],
};

function fakeOllama() {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'muse-glimmer:30b-mlx', model: 'muse-glimmer:30b-mlx' }] });
      if (url.pathname === '/api/chat') return Response.json({ message: { content: JSON.stringify(review) }, prompt_eval_count: 3420, eval_count: 610 });
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

test('A review fixture with one finding contradictsDecision D3 leaves decisions.md unchanged, writes a queue file naming the agent, and review.recorded.payload.contradictions is 1', async () => {
  const ollama = fakeOllama();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      (config.hosts.ollama as { baseURL: string }).baseURL = ollama.url;
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const ws = await Workspace.open(repo);
      const app = createApp(ws, [], { token: TOKEN, quiet: true, webDist: null });
      const t = await ws.createTask(newTask);
      for (const text of ['Count per tenant', 'Answer 429 with Retry-After', 'Sliding window over fixed window']) await ws.decisions(t.id).append({ text, by: 'muse-code r1' });
      await ws.verification(t.id).write({ run: 'r1', command: 'bun run test', exitCode: 0, passed: 33, failed: 0, durationMs: 1700, runBy: 'daemon', status: 'green', outputRef: 'verification/r1.out.txt', at: new Date().toISOString() });
      const decisionsBefore = readFileSync(join(await ws.taskDir(t.id), 'decisions.md'), 'utf8');

      const res = await app.request(`/api/tasks/${t.id}/review`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ host: 'ollama' }) });
      expect(res.status).toBe(200);
      expect(readFileSync(join(await ws.taskDir(t.id), 'decisions.md'), 'utf8')).toBe(decisionsBefore);
      const queueFile = join(ws.cacheDir, 'queue', `contradiction-${t.id}-F2.json`);
      expect(existsSync(queueFile)).toBe(true);
      expect(JSON.parse(readFileSync(queueFile, 'utf8'))).toMatchObject({ agent: 'ollama/muse-glimmer:30b-mlx', decision: { id: 'D3' }, finding: { id: 'F2' } });
      const recorded = (await ws.events(t.id).read()).find((e) => e.type === 'review.recorded');
      expect(recorded?.payload).toMatchObject({ contradictions: 1, offline: true, verdict: 'approve' });
      const finished = (await ws.events(t.id).read()).find((e) => e.type === 'run.finished');
      expect(finished?.payload).toMatchObject({ endedBy: 'completed', host: 'ollama', cost: { usd: 0, inputTokens: 3420 } });
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
      const pending = (await (await app.request('/api/graph/pending')).json()) as Array<{ id: string }>;
      expect(pending.map((p) => p.id)).toEqual([`contradiction-${t.id}-F2`]);
    });
  } finally {
    ollama.stop();
  }
}, 60_000);
