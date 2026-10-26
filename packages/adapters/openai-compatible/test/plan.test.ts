import { expect, test } from 'bun:test';
import { PlanSchema, type HostConfig } from '@stint-dev/core';
import { PLAN_JSON_SCHEMA, makeHost, renderPlanMarkdown } from '../src/index';

const modelPlan = {
  version: 'stint.plan/1',
  steps: [
    { id: 1, text: 'Add a per-tenant sliding window limiter', files: ['src/lib/limiter.ts'], test: 'test/limiter.test.ts' },
    { id: 2, text: 'Check the limiter in POST /webhooks before reading the body', files: ['src/routes/webhooks.ts'], test: 'test/ratelimit.test.ts' },
  ],
  filesToTouch: ['src/lib/limiter.ts', 'src/routes/webhooks.ts'],
  risks: [{ id: 'R1', text: 'Limiter state is in memory and resets on restart' }],
  decisions: [{ text: 'Count per tenant, not per source IP', why: 'the tenant is the unit of fairness' }],
  similarTasks: ['T-0040'],
};

function chatBody(content: string) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'muse-wonder-1.0',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 400 } },
  };
}

test('With a fake OpenAI-compatible server returning a schema-valid plan, `plan()` returns a validated `Plan` and `plan.md` renders its steps', async () => {
  const seen: { auth?: string; body?: Record<string, unknown> } = {};
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      if (url.pathname === '/v1/chat/completions') {
        seen.auth = req.headers.get('authorization') ?? undefined;
        seen.body = (await req.json()) as Record<string, unknown>;
        return Response.json(chatBody(JSON.stringify(modelPlan)));
      }
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const hostConfig: HostConfig = {
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      keyEnv: 'META_API_KEY',
      models: { 'muse-wonder-1.0': 'muse-wonder-1.0' },
      offline: false,
      structuredOutput: 'enforced',
      cachedInput: true,
    };
    const host = makeHost('meta-api', hostConfig, { META_API_KEY: 'test-key' });
    expect(await host.available()).toMatchObject({ ok: true });

    const plan = await host.plan({
      task: { id: 'T-0042', title: 'Rate limit webhooks', goal: 'Limit webhook posts per tenant', acceptance: ['Excess posts get 429'] },
      similarTasks: [{ id: 'T-0040', title: 'Cap upload size', summary: 'Added a size cap in config' }],
      skills: [{ name: 'limits-from-config', description: 'Read limits from config' }],
      model: 'muse-wonder-1.0',
    });

    expect(PlanSchema.parse(plan)).toEqual(plan);
    expect(plan.model).toBe('meta-api/muse-wonder-1.0');
    expect(plan.offline).toBe(false);

    const markdown = renderPlanMarkdown(plan);
    expect(markdown).toContain('1. Add a per-tenant sliding window limiter');
    expect(markdown).toContain('Files: src/lib/limiter.ts');
    expect(markdown).toContain('Test: test/limiter.test.ts');
    expect(markdown).toContain('## Files to touch');
    expect(markdown).toContain('- R1: Limiter state is in memory and resets on restart');

    // The key travels in the Authorization header only, and the request carries no strict flag.
    expect(seen.auth).toBe('Bearer test-key');
    const responseFormat = seen.body?.response_format as { type: string; json_schema: { schema: Record<string, unknown>; strict?: unknown } };
    expect(responseFormat.type).toBe('json_schema');
    expect(responseFormat.json_schema.strict).toBeUndefined();
    const sentSchema = responseFormat.json_schema.schema as { properties: Record<string, unknown>; required: string[] };
    expect(sentSchema.properties.model).toBeUndefined();
    expect(sentSchema.properties.offline).toBeUndefined();
    expect(sentSchema.required).not.toContain('model');
    const messages = seen.body?.messages as Array<{ content: string }>;
    expect(messages[0]?.content).toContain('Return only JSON that matches this JSON Schema');
    expect(messages[0]?.content).toContain('## Ask');

    // complete() prices cached tokens at the cached rate from the same usage shape.
    const completed = await host.complete(PlanSchema, PLAN_JSON_SCHEMA, 'Plan this task.', { model: 'muse-wonder-1.0' });
    expect(completed.host).toBe('meta-api');
    expect(completed.retries).toBe(0);
    expect(completed.cost).toEqual({ inputTokens: 1000, cachedTokens: 400, outputTokens: 200, usd: 0.0065 });
  } finally {
    server.stop(true);
  }
});

test('available() reports a missing key without any network call', async () => {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      hits++;
      return Response.json({ object: 'list', data: [] });
    },
  });
  try {
    const host = makeHost(
      'fireworks',
      {
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        keyEnv: 'FIREWORKS_API_KEY',
        models: { 'muse-spark-open': 'accounts/fireworks/models/muse-spark-open' },
        offline: false,
        structuredOutput: 'enforced',
        cachedInput: true,
      },
      {},
    );
    expect(await host.available()).toEqual({ ok: false, reason: 'FIREWORKS_API_KEY not set' });
    expect(hits).toBe(0);
  } finally {
    server.stop(true);
  }
});
