import { expect, test } from 'bun:test';
import { type HostConfig, priceUsage } from '@stint-dev/core';
import { makeHost } from '@stint-dev/adapter-openai-compatible';
import { z } from 'zod';
import { ChainExhaustedError, walkChain } from '../src/route';
import { makeApp, newTask, post, withFixtureRepo } from './helpers';
import { writeConfig } from './plan.fixtures';

const PRICE = { input: 1, cached: 0.1, output: 2 };
const Answer = z.strictObject({ ok: z.boolean() });

/** An OpenAI-compatible host that answers each call with the content `answer` gives, and 100 in, 10 cached, 50 out. */
function host(id: string, answer: () => string, priced = true) {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname !== '/v1/chat/completions') return Response.json({ object: 'list', data: [] });
      return Response.json({
        id: 'c',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: answer() }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 10 } },
      });
    },
  });
  const config: HostConfig = { baseURL: `http://127.0.0.1:${server.port}/v1`, keyEnv: 'K', models: { m: 'm' }, offline: false, structuredOutput: 'enforced', cachedInput: true };
  return { host: makeHost(id, config, { K: 'fake-key' }, { prices: priced ? { [`${id}/m`]: PRICE } : {} }), stop: () => server.stop(true) };
}

const usd = (calls: number) => priceUsage(PRICE, { inputTokens: 100 * calls, cachedTokens: 10 * calls, outputTokens: 50 * calls }) as number;

test('host A answering invalid JSON twice and host B succeeding costs A plus B', async () => {
  const a = host('a', () => 'not json');
  const b = host('b', () => JSON.stringify({ ok: true }));
  try {
    const r = await walkChain({ role: 'planner', chain: ['a/m', 'b/m'], hosts: { a: a.host, b: b.host }, call: (h, model, c) => h.complete(Answer, 'answer', { model, timeoutMs: c.timeoutMs }) });
    expect(r.host).toBe('b');
    expect(r.cost).toMatchObject({ inputTokens: 300, cachedTokens: 30, outputTokens: 150 });
    expect(r.cost.usd).toBeCloseTo(usd(2) + usd(1), 4);
  } finally {
    a.stop();
    b.stop();
  }
});

test('a chain that ends in invalid answers carries their summed cost, unpriced when a part has no price', async () => {
  const a = host('a', () => 'not json');
  const b = host('b', () => 'still not json', false);
  try {
    let thrown: unknown;
    await walkChain({ role: 'planner', chain: ['a/m', 'b/m'], hosts: { a: a.host, b: b.host }, call: (h, model, c) => h.complete(Answer, 'answer', { model, timeoutMs: c.timeoutMs }) }).catch((err) => {
      thrown = err;
    });
    expect(thrown).toBeInstanceOf(ChainExhaustedError);
    expect((thrown as ChainExhaustedError).cost).toEqual({ inputTokens: 400, cachedTokens: 40, outputTokens: 200, usd: null, estimated: true });
  } finally {
    a.stop();
    b.stop();
  }
});

test('a plan whose every answer is invalid records the spend on the failed run, not zeros', async () => {
  const local = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      return Response.json({ message: { content: 'not json' }, prompt_eval_count: 100, eval_count: 20 });
    },
  });
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, `http://127.0.0.1:${local.port}/v1`);
      const { app, ws } = await makeApp(repo, []);
      const t = await ws.createTask(newTask);
      expect((await post(app, `/api/tasks/${t.id}/plan`, {})).status).toBe(503);
      const finished = (await ws.events(t.id).read()).find((e) => e.type === 'run.finished');
      expect(finished?.payload).toMatchObject({ endedBy: 'failed', cost: { inputTokens: 200, outputTokens: 40, usd: 0 } });
    });
  } finally {
    local.stop(true);
  }
}, 90_000);
