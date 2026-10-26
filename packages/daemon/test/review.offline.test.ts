import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG, ReviewSchema, type HostConfig } from '@stint-dev/core';
import { makeHost } from '@stint-dev/adapter-openai-compatible';

const modelReview = {
  version: 'stint.review/1',
  verdict: 'request_changes',
  summary: 'One hard-coded limit.',
  findings: [
    { id: 'F1', severity: 'major', file: 'src/lib/limiter.ts', line: 4, text: 'The limit of 60 per minute is hard-coded; read it from config.' },
  ],
  blockers: [],
};

const reviewInput = {
  packetPrompt: 'Task T-0042. A limiter was added for webhooks.',
  diff: 'diff --git a/src/lib/limiter.ts b/src/lib/limiter.ts\n@@ -0,0 +1 @@\n+export const LIMIT = 60;',
  decisions: [{ id: 'D3', text: 'Use a sliding window counter per tenant' }],
};

test('The `ollama` host returns `offline: true` and `cost.usd: 0`', async () => {
  const seen: { format?: unknown; stream?: unknown } = {};
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'muse-glimmer:30b-mlx', model: 'muse-glimmer:30b-mlx' }] });
      if (url.pathname === '/api/chat') {
        const body = (await req.json()) as { format?: unknown; stream?: unknown };
        seen.format = body.format;
        seen.stream = body.stream;
        return Response.json({
          model: 'muse-glimmer:30b-mlx',
          message: { role: 'assistant', content: JSON.stringify(modelReview) },
          done: true,
          prompt_eval_count: 120,
          eval_count: 40,
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const hostConfig: HostConfig = {
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      models: { 'muse-glimmer:30b-mlx': 'muse-glimmer:30b-mlx' },
      offline: true,
      structuredOutput: 'enforced',
      cachedInput: false,
    };
    const host = makeHost('ollama', hostConfig, {});
    expect(host.offline).toBe(true);
    expect(await host.available()).toMatchObject({ ok: true });

    const review = await host.review({ ...reviewInput, model: 'muse-glimmer:30b-mlx' });
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(review.offline).toBe(true);
    expect(review.model).toBe('ollama/muse-glimmer:30b-mlx');
    expect(review.cost).toEqual({ inputTokens: 120, cachedTokens: 0, outputTokens: 40, usd: 0 });
    expect(seen.stream).toBe(false);
    const format = seen.format as { properties: Record<string, unknown> };
    expect(format.properties.cost).toBeUndefined();
    expect(format.properties.offline).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test('ollama availability names the pull command when the model is not listed', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ models: [{ name: 'some-other-model', model: 'some-other-model' }] }),
  });
  try {
    const host = makeHost(
      'ollama',
      {
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        models: { 'muse-glimmer:30b-mlx': 'muse-glimmer:30b-mlx' },
        offline: true,
        structuredOutput: 'enforced',
        cachedInput: false,
      },
      {},
    );
    const result = await host.available();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ollama pull muse-glimmer:30b-mlx');
  } finally {
    server.stop(true);
  }
});

test('an ollama runner answering 501 for the format schema gets one prompt-only retry on the native endpoint', async () => {
  let chats = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'muse-glimmer:30b-mlx' }] });
      if (url.pathname === '/api/chat') {
        chats++;
        const body = (await req.json()) as { format?: unknown };
        if (body.format) return Response.json({ error: 'structured output is not implemented for this runner' }, { status: 501 });
        return Response.json({
          model: 'muse-glimmer:30b-mlx',
          message: { role: 'assistant', content: JSON.stringify(modelReview) },
          done: true,
          prompt_eval_count: 90,
          eval_count: 30,
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const host = makeHost(
      'ollama',
      {
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        models: { 'muse-glimmer:30b-mlx': 'muse-glimmer:30b-mlx' },
        offline: true,
        structuredOutput: 'enforced',
        cachedInput: false,
      },
      {},
    );
    const review = await host.review({ ...reviewInput, model: 'muse-glimmer:30b-mlx' });
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(review.offline).toBe(true);
    expect(review.cost?.usd).toBe(0);
    expect(chats).toBe(2);
  } finally {
    server.stop(true);
  }
});

const live = process.env.STINT_LIVE === '1';
const liveTest = live ? test : test.skip;

liveTest(
  `one real review against local Glimmer validates${live ? '' : ' (skipped: STINT_LIVE is not 1)'}`,
  async () => {
    const host = makeHost('ollama', DEFAULT_CONFIG.hosts.ollama as HostConfig, process.env, { prices: DEFAULT_CONFIG.prices });
    expect(await host.available()).toMatchObject({ ok: true });
    const review = await host.review({ ...reviewInput, model: 'muse-glimmer:30b-mlx', timeoutMs: 540_000 });
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(review.offline).toBe(true);
    expect(review.cost?.usd).toBe(0);
  },
  1_200_000,
);
