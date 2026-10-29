import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { gitOk } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

test('R-017 Req 1: approve after a blocking review answers 409 review_blocked and merges nothing; a later approving review opens the gate', async () => {
  const answer = { verdict: 'block', blockers: ['The limiter drops every request.'], findings: [{ id: 'F1', severity: 'blocker', text: 'The limiter drops every request.' }] };
  const model = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      const review = { version: 'stint.review/1', summary: answer.findings.length ? 'See findings.' : 'No actionable findings.', ...answer };
      return Response.json({ message: { content: JSON.stringify(review) }, prompt_eval_count: 100, eval_count: 20 });
    },
  });
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: `http://127.0.0.1:${model.port}/v1`, models: { fake: 'fake' } };
      config.routes.reviewer = ['ollama/fake'];
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const { app, ws, t } = await builtTask(repo);
      const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();

      expect((await post(app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
      const refused = await post(app, `/api/tasks/${t.id}/approve`, {});
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'review_blocked', message: 'the latest review blocks this change' });
      expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
      expect((await ws.events(t.id).read()).some((e) => e.type === 'approval.granted' || e.type === 'merge.completed')).toBe(false);

      Object.assign(answer, { verdict: 'approve', blockers: [], findings: [] });
      expect((await post(app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
      expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
      expect((await ws.readTask(t.id)).status).toBe('done');
    });
  } finally {
    model.stop(true);
  }
}, 120_000);
