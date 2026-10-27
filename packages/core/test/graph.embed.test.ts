import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { Workspace, project, similar } from '../src/node';
import { withFixtureRepo } from './fixture';

/** A fake embedding host: webhook texts point one way, billing texts another, everything else a third. */
function fakeEmbedHost() {
  let requests = 0;
  const paths: string[] = [];
  const vector = (text: string) => (text.toLowerCase().includes('webhook') ? [1, 0, 0] : text.toLowerCase().includes('billing') ? [0, 1, 0] : [0, 0, 1]);
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests += 1;
      const { pathname } = new URL(req.url);
      paths.push(pathname);
      const body = (await req.json()) as { input: string[] };
      if (pathname === '/api/embed') return Response.json({ embeddings: body.input.map(vector) });
      return Response.json({ data: body.input.map((t, i) => ({ index: i, embedding: vector(t) })) });
    },
  });
  return { server, requests: () => requests, paths: () => paths };
}

async function threeTasks(ws: Workspace) {
  const a = await ws.createTask({ title: 'Rate limit webhooks', goal: 'Answer 429 when a tenant is over the webhook limit.', acceptance: ['429 returned'] });
  const b = await ws.createTask({ title: 'Webhook retries', goal: 'Retry failed webhook deliveries with backoff.', acceptance: ['retries happen'] });
  const c = await ws.createTask({ title: 'Billing export', goal: 'Export billing rows as CSV.', acceptance: ['CSV written'] });
  return { a, b, c };
}

const hostConfig = (baseURL: string) => ({ baseURL, models: {}, offline: false, structuredOutput: 'accepted' as const, cachedInput: false });

describe('graph embedding similarity (R-052)', () => {
  test('With a fake embeddings host, similarity uses it and marks the edges derived; without one nothing changes', async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await Workspace.open(repo);
      const { a, b, c } = await threeTasks(ws);

      // No routes.embed: the shared-files score has nothing to share, so there are no edges to mark.
      const plain = await project(ws, { cache: false });
      expect(plain.edges.filter((e) => e.type === 'similar_to')).toEqual([]);
      expect(await similar(ws, a.id, { cache: false })).toEqual([]);

      const fake = fakeEmbedHost();
      try {
        ws.config.hosts['fake-embed'] = hostConfig(`http://127.0.0.1:${fake.server.port}/v1`);
        ws.config.routes.embed = ['fake-embed/test-embed'];
        const graph = await project(ws, { cache: false });
        const edges = graph.edges.filter((e) => e.type === 'similar_to');
        expect(edges).toHaveLength(1);
        const edge = edges[0];
        expect([edge?.from, edge?.to].sort()).toEqual([`task:${a.id}`, `task:${b.id}`].sort());
        expect(edge?.data.derived).toBe(true);
        expect(edge?.data.cosine).toBe(1);
        expect(fake.paths()).toContain('/v1/embeddings');
        expect((await similar(ws, a.id, { cache: false })).map((r) => r.task)).toEqual([b.id]);
        expect(await similar(ws, c.id, { cache: false })).toEqual([]);

        // The vectors are cached by text hash: a rebuild asks the host for nothing new.
        expect(existsSync(`${repo}/.stint/cache/embeddings.json`)).toBe(true);
        const asked = fake.requests();
        await project(ws, { cache: false });
        expect(fake.requests()).toBe(asked);
      } finally {
        void fake.server.stop(true);
      }
    });
  }, 60_000);

  test('The ollama host is asked at /api/embed', async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await Workspace.open(repo);
      const { a, b } = await threeTasks(ws);
      const fake = fakeEmbedHost();
      try {
        ws.config.hosts['ollama'] = hostConfig(`http://127.0.0.1:${fake.server.port}/v1`);
        ws.config.routes.embed = ['ollama/bge-m3'];
        const graph = await project(ws, { cache: false });
        expect(fake.paths()).toContain('/api/embed');
        const edge = graph.edges.find((e) => e.type === 'similar_to');
        expect(edge?.data.derived).toBe(true);
        expect((await similar(ws, a.id, { cache: false })).map((r) => r.task)).toEqual([b.id]);
      } finally {
        void fake.server.stop(true);
      }
    });
  }, 60_000);
});
