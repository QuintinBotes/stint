import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { fakeModels, setup, stopped, task, until } from './autopilot.fixtures';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';
import { plan } from './plan.fixtures';

/** A working local model host (ollama shape) that answers a plan. */
function workingLocal() {
  let chats = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        chats++;
        return Response.json({ message: { content: JSON.stringify(plan()) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, chats: () => chats, stop: () => server.stop(true) };
}

/** A local host (OpenAI shape) whose chat endpoint always fails, so a chain naming only it cannot plan. */
function failingLocal() {
  let chats = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      if (url.pathname === '/v1/chat/completions') {
        chats++;
        return Response.json({ error: { message: 'down' } }, { status: 500 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, chats: () => chats, stop: () => server.stop(true) };
}

test('Acceptance 1: a task route overrides the config planner chain', async () => {
  const good = workingLocal();
  const bad = failingLocal();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<typeof config.hosts.ollama>), baseURL: good.url, models: { fake: 'fake' } };
      config.hosts.lmstudio = { ...(config.hosts.lmstudio as NonNullable<typeof config.hosts.lmstudio>), baseURL: bad.url, models: { fake: 'fake' } };
      config.routes.planner = ['lmstudio/fake'];
      config.routes.reviewer = ['ollama/fake'];
      config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const { app, ws } = await makeApp(repo, []);
      const t = await ws.createTask(newTask);
      await ws.writeTask(t.id, { routes: { planner: ['ollama/fake'] } });
      expect((await ws.readTask(t.id)).routes).toEqual({ planner: ['ollama/fake'] });
      const res = await post(app, `/api/tasks/${t.id}/plan`, {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { model: string };
      expect(body.model).toBe('ollama/fake');
      expect(good.chats()).toBeGreaterThan(0);
      expect(bad.chats()).toBe(0);
      // a route entry that is not host/model is rejected the same way as in config
      await expect(ws.writeTask(t.id, { routes: { planner: ['no-slash-here'] } })).rejects.toThrow();
    });
  } finally {
    good.stop();
    bad.stop();
  }
}, 90_000);

test('Req 11: the autopilot routes return step beside on, running and queued', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
      const t = await ws.createTask(task('true'));
      const off = (await (await post(app, `/api/tasks/${t.id}/autopilot`, { on: false })).json()) as { on: boolean; step: string; running: string[]; queued: string[] };
      expect(off).toMatchObject({ on: false, step: 'idle' });
      expect(off.running).toBeArray();
      expect(off.queued).toBeArray();
      const on = (await (await post(app, `/api/tasks/${t.id}/autopilot`, { on: true })).json()) as typeof off;
      expect(on.on).toBe(true);
      expect(['plan', 'build', 'verify', 'review', 'approve', 'idle']).toContain(on.step);
      await until(ws, t.id, stopped);
      const done = (await (await post(app, `/api/tasks/${t.id}/autopilot`, { on: false })).json()) as typeof off;
      expect(done.step).toBe('approve');
      const all = (await (await post(app, '/api/autopilot', { on: false })).json()) as typeof off & { tasks: string[] };
      expect(['plan', 'build', 'verify', 'review', 'approve', 'idle']).toContain(all.step);
    });
  } finally {
    models.stop();
  }
}, 120_000);
