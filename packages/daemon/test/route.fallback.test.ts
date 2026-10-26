import { expect, test } from 'bun:test';
import { PlanSchema, ReviewSchema, type HostConfig } from '@stint-dev/core';
import { makeHost, type Host } from '@stint-dev/adapter-openai-compatible';
import { ChainExhaustedError, walkChain, type RouteEvent } from '../src/route';

const modelPlan = {
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Add a per-tenant sliding window limiter', files: ['src/lib/limiter.ts'], test: 'test/limiter.test.ts' }],
  filesToTouch: ['src/lib/limiter.ts'],
  risks: [{ id: 'R1', text: 'Limiter state is in memory and resets on restart' }],
  similarTasks: [],
};

const modelReview = {
  version: 'stint.review/1',
  verdict: 'request_changes',
  summary: 'One hard-coded limit.',
  findings: [
    { id: 'F1', severity: 'major', file: 'src/lib/limiter.ts', line: 4, text: 'The limit of 60 per minute is hard-coded; read it from config.' },
  ],
  blockers: [],
};

type ChatHandler = (call: number) => { status?: number; content: string };

function fakeHost(id: string, model: string, keyEnv: string, chat: ChatHandler): { host: Host; stop: () => void; calls: () => number } {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      if (url.pathname === '/v1/chat/completions') {
        calls++;
        const answer = chat(calls);
        if (answer.status && answer.status !== 200) return Response.json({ error: { message: 'rate limited' } }, { status: answer.status });
        return Response.json({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model,
          choices: [{ index: 0, message: { role: 'assistant', content: answer.content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 10 } },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const hostConfig: HostConfig = {
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    keyEnv,
    models: { [model]: model },
    offline: false,
    structuredOutput: id === 'baseten' ? 'accepted' : 'enforced',
    cachedInput: true,
  };
  return { host: makeHost(id, hostConfig, { [keyEnv]: 'test-key' }), stop: () => server.stop(true), calls: () => calls };
}

const task = { id: 'T-0042', title: 'Rate limit webhooks', goal: 'Limit webhook posts per tenant', acceptance: ['Excess posts get 429'] };
const reviewInput = {
  packetPrompt: 'Task T-0042. A limiter was added.',
  diff: 'diff --git a/src/lib/limiter.ts b/src/lib/limiter.ts\n@@ -0,0 +1 @@\n+export const LIMIT = 60;',
  decisions: [{ id: 'D3', text: 'Use a sliding window counter per tenant' }],
};

test("A fake `meta-api` answering 429 makes the planner chain fall to `fireworks`, emits `provider.fallback { from: 'meta-api', to: 'fireworks', reason: '429' }`, and the run's `from.host` is `fireworks`", async () => {
  const meta = fakeHost('meta-api', 'muse-wonder-1.0', 'META_API_KEY', () => ({ status: 429, content: '' }));
  const fireworks = fakeHost('fireworks', 'muse-spark-open', 'FIREWORKS_API_KEY', () => ({ content: JSON.stringify(modelPlan) }));
  const events: RouteEvent[] = [];
  try {
    const result = await walkChain({
      role: 'planner',
      chain: ['meta-api/muse-wonder-1.0', 'fireworks/muse-spark-open'],
      hosts: { 'meta-api': meta.host, fireworks: fireworks.host },
      emit: (event) => {
        events.push(event);
      },
      call: (host, model, ctx) => host.plan({ task, model, timeoutMs: ctx.timeoutMs, emit: ctx.emit }),
    });
    expect(result.host).toBe('fireworks');
    expect(result.model).toBe('muse-spark-open');
    expect(PlanSchema.parse(result.value as never)).toBeDefined();
    expect((result.value as { model: string }).model).toBe('fireworks/muse-spark-open');
    expect(events).toContainEqual({
      type: 'provider.fallback',
      payload: { role: 'planner', from: 'meta-api', to: 'fireworks', reason: '429' },
    });
  } finally {
    meta.stop();
    fireworks.stop();
  }
});

test('A fake `baseten` answering invalid JSON once and valid JSON on the retry yields a validated review with one `provider.retry` note in the payload; invalid twice falls to the next host', async () => {
  const baseten = fakeHost('baseten', 'muse-spark-open', 'BASETEN_API_KEY', (call) => ({
    content: call === 1 ? 'this is not json' : JSON.stringify(modelReview),
  }));
  const fireworks = fakeHost('fireworks', 'muse-spark-open', 'FIREWORKS_API_KEY', () => ({ content: JSON.stringify(modelReview) }));
  const events: RouteEvent[] = [];
  try {
    const result = await walkChain({
      role: 'reviewer',
      chain: ['baseten/muse-spark-open', 'fireworks/muse-spark-open'],
      hosts: { baseten: baseten.host, fireworks: fireworks.host },
      emit: (event) => {
        events.push(event);
      },
      call: (host, model, ctx) => host.review({ ...reviewInput, model, timeoutMs: ctx.timeoutMs, emit: ctx.emit }),
    });
    expect(result.host).toBe('baseten');
    expect(ReviewSchema.parse(result.value as never)).toBeDefined();
    expect((result.value as { model: string }).model).toBe('baseten/muse-spark-open');
    const retries = events.filter((event) => event.type === 'provider.retry');
    expect(retries).toHaveLength(1);
    expect(retries[0]?.payload).toMatchObject({ role: 'reviewer', host: 'baseten' });
    expect(String(retries[0]?.payload.errors)).toContain('invalid JSON');
    expect(events.filter((event) => event.type === 'provider.fallback')).toHaveLength(0);
    expect(baseten.calls()).toBe(2);
  } finally {
    baseten.stop();
    fireworks.stop();
  }

  const badBaseten = fakeHost('baseten', 'muse-spark-open', 'BASETEN_API_KEY', () => ({ content: 'still not json' }));
  const goodFireworks = fakeHost('fireworks', 'muse-spark-open', 'FIREWORKS_API_KEY', () => ({ content: JSON.stringify(modelReview) }));
  const secondEvents: RouteEvent[] = [];
  try {
    const result = await walkChain({
      role: 'reviewer',
      chain: ['baseten/muse-spark-open', 'fireworks/muse-spark-open'],
      hosts: { baseten: badBaseten.host, fireworks: goodFireworks.host },
      emit: (event) => {
        secondEvents.push(event);
      },
      call: (host, model, ctx) => host.review({ ...reviewInput, model, timeoutMs: ctx.timeoutMs, emit: ctx.emit }),
    });
    expect(result.host).toBe('fireworks');
    expect(badBaseten.calls()).toBe(2);
    expect(secondEvents).toContainEqual({
      type: 'provider.fallback',
      payload: { role: 'reviewer', from: 'baseten', to: 'fireworks', reason: 'invalid_output' },
    });
  } finally {
    badBaseten.stop();
    goodFireworks.stop();
  }
});

test('walkChain skips an unavailable host and throws ChainExhaustedError listing every attempt', async () => {
  const down = fakeHost('meta-api', 'muse-wonder-1.0', 'META_API_KEY', () => ({ status: 500, content: '' }));
  try {
    const missingKey = makeHost(
      'fireworks',
      {
        baseURL: 'http://127.0.0.1:9/v1',
        keyEnv: 'FIREWORKS_API_KEY',
        models: { 'muse-spark-open': 'muse-spark-open' },
        offline: false,
        structuredOutput: 'enforced',
        cachedInput: true,
      },
      {},
    );
    const events: RouteEvent[] = [];
    let thrown: unknown;
    try {
      await walkChain({
        role: 'planner',
        chain: ['fireworks/muse-spark-open', 'meta-api/muse-wonder-1.0'],
        hosts: { fireworks: missingKey, 'meta-api': down.host },
        emit: (event) => {
          events.push(event);
        },
        call: (host, model, ctx) => host.plan({ task, model, timeoutMs: ctx.timeoutMs, emit: ctx.emit }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChainExhaustedError);
    expect((thrown as ChainExhaustedError).attempts).toEqual([
      { host: 'fireworks', model: 'muse-spark-open', reason: 'no_key', detail: 'FIREWORKS_API_KEY not set' },
      { host: 'meta-api', model: 'muse-wonder-1.0', reason: '5xx', detail: 'host meta-api answered HTTP 500' },
    ]);
    expect(events).toContainEqual({
      type: 'provider.fallback',
      payload: { role: 'planner', from: 'fireworks', to: 'meta-api', reason: 'no_key' },
    });
  } finally {
    down.stop();
  }
});

test('walkChain timeouts default to 60s for planner and 120s for reviewer', async () => {
  const stub = {
    id: 'meta-api',
    vendor: 'meta',
    offline: false,
    structuredOutput: 'enforced',
    available: async () => ({ ok: true }),
  } as unknown as Host;
  const seen: number[] = [];
  for (const role of ['planner', 'reviewer']) {
    await walkChain({
      role,
      chain: ['meta-api/muse-wonder-1.0'],
      hosts: { 'meta-api': stub },
      call: async (_host, _model, ctx) => {
        seen.push(ctx.timeoutMs);
        return { model: 'meta-api/muse-wonder-1.0' };
      },
    });
  }
  expect(seen).toEqual([60_000, 120_000]);
});
