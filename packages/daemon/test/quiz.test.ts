import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const STATEMENTS = {
  statements: [
    { id: 'S1', text: 'The run was killed before it finished.', truth: true, blocking: true },
    { id: 'S2', text: 'The tests for 429 were written and pass.', truth: false, blocking: false },
    { id: 'S3', text: 'The limiter counts per tenant.', truth: true, blocking: true },
  ],
};

/** Writes the statements when asked for facts, and answers from the packet when asked as the next agent. */
function fakeModels() {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake' }] });
      const body = (await req.json()) as { messages: Array<{ content: string }> };
      const prompt = body.messages.map((m) => m.content).join('\n');
      const writing = prompt.includes('Record:');
      asked.push(writing ? 'write' : 'answer');
      const killedLine = prompt.split('\n').find((l) => !writing && /killed/i.test(l) && !l.startsWith('S1')) ?? '';
      const content = writing
        ? STATEMENTS
        : {
            answers: [
              { id: 'S1', answer: 'true', quote: killedLine.trim() },
              { id: 'S2', answer: 'false', quote: 'a sentence the packet never said' },
              { id: 'S3', answer: 'unknown', quote: '' },
            ],
          };
      return Response.json({ message: { content: JSON.stringify(content) }, prompt_eval_count: 500, eval_count: 80 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, stop: () => server.stop(true) };
}

test('The quiz scores a killed packet: a grounded right answer counts, an answer quoting text the packet lacks does not, and an unknown blocking fact is a blocking miss', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: models.url, models: { fake: 'fake' } };
      (config.routes as Record<string, string[]>).quiz = ['ollama/fake'];
      (config.routes as Record<string, string[]>).recall = ['ollama/fake'];
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const { app, ws } = await makeApp(repo, [fakeAdapter('sleep')]);
      const t = await ws.createTask(newTask);
      const { run } = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).json()) as { run: string };
      for (let i = 0; i < 100 && !(await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(20);
      const stopped = await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {});
      if (stopped.status !== 202) throw new Error(`stop: ${stopped.status} ${await stopped.text()}`);
      // the kill's commit and verification take a few seconds on a busy machine; the packet comes after them
      for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);

      const res = await post(app, `/api/tasks/${t.id}/handoffs/h1/quiz`, {});
      expect(res.status).toBe(200);
      const result = (await res.json()) as { total: number; correct: number; score: number; blockingMisses: Array<{ id: string }>; advisoryMisses: Array<{ id: string; answer: string }> };
      expect(result).toMatchObject({ total: 3, correct: 1, score: 0.33 });
      expect(result.blockingMisses.map((m) => m.id)).toEqual(['S3']);
      expect(result.advisoryMisses).toEqual([expect.objectContaining({ id: 'S2', answer: 'false, quote not in the packet' })]);
      expect(models.asked).toEqual(['write', 'answer']);
      expect(existsSync(join(await ws.taskDir(t.id), 'handoffs', 'h1.quiz.json'))).toBe(true);
      expect((await ws.events(t.id).read()).find((e) => e.type === 'handoff.quizzed')?.payload).toMatchObject({ name: 'h1', correct: 1, total: 3 });
    });
  } finally {
    models.stop();
  }
}, 60_000);
