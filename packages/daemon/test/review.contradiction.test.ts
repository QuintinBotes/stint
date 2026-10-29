import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '../src/index';
import { gitOk } from '../src/git';
import { TOKEN, auth, builtTask, newTask, post, withFixtureRepo } from './helpers';

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
      // superseding it records D4 over D3 and the item leaves the queue
      const settle = await app.request(`/api/graph/pending/contradiction-${t.id}-F2`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'supersede' }) });
      expect(settle.status).toBe(200);
      expect((await ws.decisions(t.id).validAt()).map((d) => d.id)).toEqual(['D1', 'D2', 'D4']);
      expect(await (await app.request('/api/graph/pending')).json()).toEqual([]);
    });
  } finally {
    ollama.stop();
  }
}, 60_000);

test('approve refuses with decision_pending while a review finding would reverse a decision, names the decision, merges nothing, and merges once the decision is kept', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const d = await ws.decisions(t.id).append({ text: 'Limits come from config, never the environment', by: 'you' });
    await ws.events(t.id).append({ task: t.id, run: 'r1', adapter: 'openai-compatible', vendor: 'meta', type: 'review.recorded', payload: { verdict: 'approve', contradictions: 1, review: { model: 'ollama/fake', findings: [{ id: 'F2', severity: 'note', text: 'Read the limit from the environment', contradictsDecision: d.id }] } } });
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const refused = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: 'decision_pending', message: 'F2 in the review would reverse D1 ("Limits come from config, never the environment"); keep D1 or supersede it before you approve', hint: { queue: [`contradiction-${t.id}-F2`] } } });
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);

    expect((await post(app, `/api/graph/pending/contradiction-${t.id}-F2`, { action: 'keep' })).status).toBe(200);
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    expect((await ws.readTask(t.id)).status).toBe('done');
  });
}, 120_000);
