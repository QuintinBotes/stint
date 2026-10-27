import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const modelReview = {
  version: 'stint.review/1',
  verdict: 'approve',
  summary: 'Looks right.',
  findings: [],
  blockers: [],
};

/** A hosted-shape fake host whose model has no price anywhere; it records the token cap it was sent. */
function unpricedHost() {
  const caps: Array<number | undefined> = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      if (url.pathname === '/v1/chat/completions') {
        const body = (await req.json()) as { max_tokens?: number };
        caps.push(body.max_tokens);
        return Response.json({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'unpriced-model',
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(modelReview) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, prompt_tokens_details: { cached_tokens: 0 } },
        });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, caps, stop: () => server.stop(true) };
}

test('Acceptance 4: an unpriced review emits cost.unpriced, and the review call carries the reviewer budget', async () => {
  const host = unpricedHost();
  const prevKey = process.env.FIREWORKS_API_KEY;
  process.env.FIREWORKS_API_KEY = 'test-key';
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.fireworks = { ...(config.hosts.fireworks as NonNullable<typeof config.hosts.fireworks>), baseURL: host.url, models: { 'unpriced-model': 'unpriced-model' } };
      config.routes.reviewer = ['fireworks/unpriced-model'];
      delete config.prices['fireworks/unpriced-model'];
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
      const t = await ws.createTask({ ...newTask, budgets: { reviewer: 777 } });
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);
      await ws.verification(t.id).write({ run: 'r1', command: 'bun run test', exitCode: 0, passed: 33, failed: 0, durationMs: 10, runBy: 'daemon', status: 'green', outputRef: 'verification/r1.out.txt', at: new Date().toISOString() });
      const res = await post(app, `/api/tasks/${t.id}/review`, {});
      expect(res.status).toBe(200);
      const events = await ws.events(t.id).read();
      const unpriced = events.filter((e) => e.type === 'cost.unpriced');
      expect(unpriced.length).toBeGreaterThan(0);
      expect(unpriced.some((e) => String(e.payload.key ?? '') === 'fireworks/unpriced-model')).toBe(true);
      const reviewRun = events.find((e) => e.type === 'run.finished' && e.payload.host === 'fireworks');
      expect((reviewRun?.payload.cost as { usd: unknown } | undefined)?.usd).toBeNull();
      expect(host.caps.length).toBeGreaterThan(0);
      expect(host.caps.every((c) => c === 777)).toBe(true);
    });
  } finally {
    if (prevKey === undefined) delete process.env.FIREWORKS_API_KEY;
    else process.env.FIREWORKS_API_KEY = prevKey;
    host.stop();
  }
}, 120_000);
