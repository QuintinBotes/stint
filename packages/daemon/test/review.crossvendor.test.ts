import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { APPROVE } from './autopilot.fixtures';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

/** Two model hosts on one fake server: the reviewer answers from whichever model it is asked for, and the test sees which. */
function reviewers() {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'spark', model: 'spark' }, { name: 'other', model: 'other' }] });
      if (url.pathname === '/api/chat') {
        asked.push(((await req.json()) as { model: string }).model);
        return Response.json({ message: { content: JSON.stringify(APPROVE) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, stop: () => server.stop(true) };
}

async function app(repo: string, url: string, reviewer: string[], crossVendor = true) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: url, models: { spark: 'spark', other: 'other' } };
  config.routes.reviewer = reviewer;
  config.routes.agent = ['ollama/spark'];
  config.prices['ollama/spark'] = { input: 0, cached: 0, output: 0 };
  config.prices['ollama/other'] = { input: 0, cached: 0, output: 0 };
  if (!crossVendor) config.review = { lenses: ['general'], bestOf: 1, crossVendor: false };
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  const made = await makeApp(repo, [{ ...fakeAdapter('edit'), id: 'stint-agent' }, { ...fakeAdapter('edit'), id: 'muse-code' }]);
  return made;
}

async function built(made: Awaited<ReturnType<typeof app>>, adapter: string, model?: string) {
  const t = await made.ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 over the limit.', acceptance: ['429'], testCommand: 'true' });
  await post(made.app, `/api/tasks/${t.id}/assign`, { adapter, role: 'implementer', ...(model ? { model } : {}) });
  for (let i = 0; i < 600 && !(await made.ws.events(t.id).read()).some((e) => e.type === 'verification.ran'); i++) await Bun.sleep(50);
  return t;
}

test('A reviewer equal to the implementer is refused and the next one is used', async () => {
  const models = reviewers();
  try {
    await withFixtureRepo(async (repo) => {
      const made = await app(repo, models.url, ['ollama/spark', 'ollama/other']);
      const t = await built(made, 'stint-agent', 'ollama/spark');
      const res = await post(made.app, `/api/tasks/${t.id}/review`, {});
      expect(res.status).toBe(200);
      expect(models.asked).toEqual(['other']);
      const started = (await made.ws.events(t.id).read()).filter((e) => e.type === 'run.started' && e.payload.role === 'reviewer').at(-1);
      expect(started?.payload).toMatchObject({ host: 'ollama', model: 'other', skipped: ['ollama/spark'] });
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('When every reviewer is the implementer, the review is refused with review_blocked and a reason', async () => {
  const models = reviewers();
  try {
    await withFixtureRepo(async (repo) => {
      const made = await app(repo, models.url, ['ollama/spark']);
      // no model named: the Stint agent runs the first model of routes.agent, and that is the one compared
      const t = await built(made, 'stint-agent');
      const res = await post(made.app, `/api/tasks/${t.id}/review`, {});
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('review_blocked');
      expect(body.error.message).toContain('ollama/spark');
      expect(models.asked).toEqual([]);
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('Another harness on the same model may review, and crossVendor false turns the rule off', async () => {
  const models = reviewers();
  try {
    await withFixtureRepo(async (repo) => {
      const made = await app(repo, models.url, ['ollama/spark']);
      const t = await built(made, 'muse-code', 'spark');
      expect((await post(made.app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
    });
    await withFixtureRepo(async (repo) => {
      const made = await app(repo, models.url, ['ollama/spark'], false);
      const t = await built(made, 'stint-agent', 'ollama/spark');
      expect((await post(made.app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
    });
    expect(models.asked).toEqual(['spark', 'spark']);
  } finally {
    models.stop();
  }
}, 120_000);
