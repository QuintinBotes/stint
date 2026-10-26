import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { mergeFindings } from '../src/routes/models';
import { builtTask, post, withFixtureRepo } from './helpers';

const review = (verdict: string, findings: unknown[] = [], blockers: string[] = []) => ({ version: 'stint.review/1', verdict, summary: findings.length ? 'See findings.' : 'No actionable findings.', findings, blockers });
const finding = (id: string, severity: string, text: string, file?: string, line?: number) => ({ id, severity, text, ...(file ? { file } : {}), ...(line ? { line } : {}) });

/** A reviewer that answers by the lens its prompt asks for. */
function lensModels(byLens: { general: unknown; security?: unknown; spec?: unknown }) {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const text = JSON.stringify(await req.json());
        const lens = text.includes('## Lens: security') ? 'security' : text.includes('## Lens: spec fit') ? 'spec' : 'general';
        asked.push(lens);
        const answer = (lens === 'security' ? byLens.security : lens === 'spec' ? byLens.spec : byLens.general) ?? review('approve');
        return Response.json({ message: { content: JSON.stringify(answer) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, asked, stop: () => server.stop(true) };
}

/** An OpenAI-compatible host answering one review. */
function openaiHost(answer: unknown) {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'muse-spark-open' }] });
      if (url.pathname.endsWith('/chat/completions')) return Response.json({ id: 'c', object: 'chat.completion', model: 'muse-spark-open', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

function writeConfig(repo: string, ollama: string, review: Config['review'], extra?: (c: Config) => void) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: ollama, models: { fake: 'fake' } };
  config.routes.reviewer = ['ollama/fake'];
  config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
  config.review = review;
  extra?.(config);
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
}

beforeAll(() => {
  process.env.FIREWORKS_API_KEY = 'test';
});
afterAll(() => {
  delete process.env.FIREWORKS_API_KEY;
});

test('Three lenses produce three reviews and one combined verdict; a security block blocks the gate', async () => {
  const models = lensModels({
    general: review('approve', [finding('F1', 'minor', 'The limiter name could be clearer')]),
    security: review('block', [finding('F1', 'blocker', 'The webhook signing secret is written to the log', 'src/routes/webhooks.ts', 12)], ['The signing secret is logged']),
    spec: review('approve'),
  });
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url, { lenses: ['general', 'security', 'spec-fit'], bestOf: 1, crossVendor: true });
      const { app, ws, t } = await builtTask(repo);
      const res = await post(app, `/api/tasks/${t.id}/review`, {});
      expect(res.status).toBe(200);
      expect(models.asked.sort()).toEqual(['general', 'security', 'spec']);
      const reviews = (await ws.events(t.id).read()).filter((e) => e.type === 'review.recorded');
      expect(reviews.map((e) => e.payload.lens)).toEqual(['general', 'security', 'spec-fit', 'combined']);
      const combined = await ws.readReview(t.id);
      expect(combined).toMatchObject({ lens: 'combined', verdict: 'block', blockers: ['The signing secret is logged'] });
      expect(combined?.lenses?.map((l) => [l.lens, l.verdict])).toEqual([['general', 'approve'], ['security', 'block'], ['spec-fit', 'approve']]);
      expect(combined?.findings.map((f) => [f.id, f.lens, f.severity])).toEqual([['F1', 'security', 'blocker'], ['F2', 'general', 'minor']]);
      expect((await ws.readTask(t.id)).status).toBe('building');
      expect((await ws.events(t.id).read()).some((e) => e.type === 'approval.requested')).toBe(false);
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('With review.bestOf 2, two hosts review the general lens; their findings merge with agreement and a split verdict is flagged', async () => {
  const shared = finding('F1', 'major', 'A tenant over the limit still gets 200', 'src/routes/webhooks.ts', 30);
  const models = lensModels({ general: review('approve', [shared]) });
  const other = openaiHost(review('request_changes', [shared, finding('F2', 'minor', 'Retry-After is missing from the 429 response body docs')]));
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url, { lenses: ['general'], bestOf: 2, crossVendor: true }, (c) => {
        c.hosts.fireworks = { ...(c.hosts.fireworks as NonNullable<Config['hosts']['fireworks']>), baseURL: other.url, models: { 'muse-spark-open': 'muse-spark-open' } };
        c.routes.reviewer = ['ollama/fake', 'fireworks/muse-spark-open'];
        c.prices['fireworks/muse-spark-open'] = { input: 0, cached: 0, output: 0 };
      });
      const { app, ws, t } = await builtTask(repo);
      expect((await post(app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
      const started = (await ws.events(t.id).read()).filter((e) => e.type === 'run.started' && e.payload.role === 'reviewer').map((e) => e.payload.host);
      expect(started).toEqual(['ollama', 'fireworks']);
      const combined = await ws.readReview(t.id);
      expect(combined).toMatchObject({ lens: 'combined', verdict: 'request_changes', disagreement: true });
      expect(combined?.findings.map((f) => [f.text, f.agreement])).toEqual([
        ['A tenant over the limit still gets 200', 2],
        ['Retry-After is missing from the 429 response body docs', 1],
      ]);
      expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
    });
  } finally {
    models.stop();
    other.stop();
  }
}, 60_000);

test('Without review config there is one general review and no combined one, as before', async () => {
  const models = lensModels({ general: review('approve') });
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, models.url, undefined);
      const { app, ws, t } = await builtTask(repo);
      expect((await post(app, `/api/tasks/${t.id}/review`, {})).status).toBe(200);
      expect((await ws.events(t.id).read()).filter((e) => e.type === 'review.recorded').map((e) => e.payload.lens)).toEqual(['general']);
      expect((await ws.readReview(t.id))?.lens).toBeUndefined();
    });
  } finally {
    models.stop();
  }
}, 60_000);

test('mergeFindings joins the same file and line, or two shared theme words, once per reviewer', () => {
  const a = [finding('F1', 'minor', 'limit read as a literal', 'src/a.ts', 3), finding('F2', 'major', 'Tenant limiter window hard-coded instead of config')];
  const b = [finding('F1', 'blocker', 'Literal limit here', 'src/a.ts', 3), finding('F2', 'minor', 'limiter window should come from config'), finding('F3', 'note', 'typo in a comment')];
  const merged = mergeFindings([a, b] as never);
  expect(merged.map((f) => [f.severity, f.agreement])).toEqual([['blocker', 2], ['major', 2], ['note', 1]]);
});
