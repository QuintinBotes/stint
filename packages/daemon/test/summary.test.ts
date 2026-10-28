import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { daemonContext, digestFrom } from '../src/index';
import { makeApp, newTask, post, withFixtureRepo } from './helpers';

type SummaryAnswer = { summary: string; seq: number; source: string; host?: string; model?: string };

/** A local model server in Ollama's shape that counts every ask it gets; with `loaded` it also says which models are in memory. */
function fakeModels(answer = 'The limiter work is under way.', loaded: string[] | null = null) {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      asked.push(url.pathname);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake' }] });
      if (url.pathname === '/api/ps' && loaded) return Response.json({ models: loaded.map((name) => ({ name, model: name })) });
      if (url.pathname === '/api/chat') return Response.json({ message: { content: JSON.stringify({ summary: answer }) }, prompt_eval_count: 40, eval_count: 8 });
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, origin: `http://127.0.0.1:${server.port}`, asked, chats: () => asked.filter((p) => p === '/api/chat').length, stop: () => server.stop(true) };
}

function writeConfig(repo: string, edit: (config: Config) => void): void {
  const config = structuredClone(DEFAULT_CONFIG);
  edit(config);
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

const pointOllamaAt = (url: string) => (config: Config) => {
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: url, models: { fake: 'fake' } };
};

test('A card summary comes from the local model and is cached by event seq', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, (config) => {
        pointOllamaAt(models.url)(config);
        config.routes.summary = ['ollama/fake', 'meta-api/muse-spark-1.3'];
      });
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'Added the limiter constant.' } });
      const seq = (await ws.events(t.id).read()).at(-1)?.seq;

      const first = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(first).toMatchObject({ summary: 'The limiter work is under way.', source: 'model', host: 'ollama', model: 'fake', seq });
      expect(models.chats()).toBe(1);

      const cachedPath = join(await ws.taskDir(t.id), 'summary.json');
      expect(existsSync(cachedPath)).toBe(true);
      expect(JSON.parse(readFileSync(cachedPath, 'utf8'))).toMatchObject({ summary: 'The limiter work is under way.', seq, source: 'model' });

      // the call's cost is in the workspace log, so the task's log, and with it the card's cache key, is unchanged
      expect((await ws.events(t.id).read()).at(-1)?.seq).toBe(seq);
      const spent = (await ws.workspaceEvents().read()).filter((e) => e.type === 'cost.recorded');
      expect(spent.map((e) => e.payload)).toEqual([{ for: 'summary', task: t.id, host: 'ollama', model: 'fake', cost: { inputTokens: 40, cachedTokens: 0, outputTokens: 8, usd: 0 } }]);

      const second = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(second).toEqual(first);
      expect(models.chats()).toBe(1);
      expect((await ws.workspaceEvents().read()).filter((e) => e.type === 'cost.recorded')).toHaveLength(1);

      await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'Wired the limiter in.' } });
      const third = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(third.seq).toBeGreaterThan(seq as number);
      expect(models.chats()).toBe(2);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('A hosted host is never used for a card summary, even when it would answer', async () => {
  const hosted = fakeModels('A hosted answer that must never be used.');
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, (config) => {
        config.hosts['meta-api'] = { ...(config.hosts['meta-api'] as NonNullable<Config['hosts']['meta-api']>), baseURL: hosted.url };
        config.routes.summary = ['meta-api/muse-spark-1.3'];
      });
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'Added the limiter constant.' } });

      const got = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(got).toMatchObject({ summary: 'Added the limiter constant.', source: 'agent.message' });
      expect(got.host).toBeUndefined();
      expect(hosted.asked).toEqual([]);
      expect(existsSync(join(await ws.taskDir(t.id), 'summary.json'))).toBe(false);
    });
  } finally {
    hosted.stop();
  }
}, 60_000);

test('With no local model pulled, the summary is the last agent message and no model is called', async () => {
  const empty = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [] });
      return new Response('not found', { status: 404 });
    },
  });
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, (config) => {
        pointOllamaAt(`http://127.0.0.1:${empty.port}/v1`)(config);
        config.routes.summary = ['ollama/fake'];
      });
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      const none = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(none).toMatchObject({ summary: '', source: 'none' });

      await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'Added the limiter constant.' } });
      const got = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
      expect(got).toMatchObject({ summary: 'Added the limiter constant.', source: 'agent.message' });
    });
  } finally {
    empty.stop(true);
  }
}, 60_000);

test('A pulled model that is not loaded is never loaded for a card: the summary falls back, and once loaded the model answers', async () => {
  for (const [loaded, source, chats] of [[[], 'agent.message', 0], [['fake'], 'model', 1]] as const) {
    const models = fakeModels('Loaded and answering.', [...loaded]);
    try {
      await withFixtureRepo(async (repo) => {
        writeConfig(repo, (config) => {
          pointOllamaAt(models.url)(config);
          config.routes.summary = ['ollama/fake'];
        });
        const { app, ws } = await makeApp(repo);
        const t = await ws.createTask(newTask);
        await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'Added the limiter constant.' } });
        const answer = (await (await post(app, `/api/tasks/${t.id}/summary`, {})).json()) as SummaryAnswer;
        expect(answer.source).toBe(source);
        expect(models.chats()).toBe(chats);
      });
    } finally {
      models.stop();
    }
  }
}, 60_000);

test("A killed run's diff digest records its cost on the task's log once the model answers", async () => {
  const models = fakeModels('The limiter constant is in; nothing calls it yet.');
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, (config) => {
        pointOllamaAt(models.url)(config);
        config.routes.summary = ['ollama/fake'];
      });
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      const ctx = daemonContext(app);
      ctx.worktrees.diff = async () => '+++ b/src/lib/limiter.ts\n+export const LIMIT = 60;\n';
      expect(await digestFrom(ctx, t.id)).toEqual({ summary: 'The limiter constant is in; nothing calls it yet.' });
      const spent = (await ws.events(t.id).read()).filter((e) => e.type === 'cost.recorded');
      expect(spent.map((e) => e.payload)).toEqual([{ for: 'digest', host: 'ollama', model: 'fake', cost: { inputTokens: 40, cachedTokens: 0, outputTokens: 8, usd: 0 } }]);
    });
  } finally {
    models.stop();
  }
}, 60_000);
