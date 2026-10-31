import { expect, test } from 'bun:test';
import type { HostConfig } from '@stint-dev/core';
import { makeHost } from '../src/index';

const plan = {
  version: 'stint.plan/1',
  steps: [{ id: 1, text: 'Sign each delivery', files: ['src/sign.ts'], test: 'test/sign.test.ts' }],
  filesToTouch: ['src/sign.ts'],
  risks: [],
  decisions: [],
  similarTasks: [],
};

async function planFromSlowHost(hostTimeoutMs: number | undefined) {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      await Bun.sleep(300);
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'muse-glimmer:30b-mlx',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(plan) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    },
  });
  const hostConfig: HostConfig = {
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    models: { 'muse-glimmer:30b-mlx': 'muse-glimmer:30b-mlx' },
    offline: true,
    structuredOutput: 'accepted',
    cachedInput: false,
    ...(hostTimeoutMs ? { timeoutMs: hostTimeoutMs } : {}),
  };
  try {
    return await makeHost('laptop', hostConfig, {})
      .plan({ task: { id: 'T-0001', title: 'Sign webhooks', goal: 'Sign each delivery', acceptance: ['A header carries the signature'] }, timeoutMs: 100 })
      .then((p) => p.steps.length, (e: Error) => e.message);
  } finally {
    server.stop(true);
  }
}

test("A host's own timeoutMs gives a slow model the time it needs where the role's limit would stop it", async () => {
  expect(await planFromSlowHost(undefined)).toBe('host laptop timed out');
  expect(await planFromSlowHost(5000)).toBe(1);
});
