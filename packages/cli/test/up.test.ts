import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG, type Config } from '@stint-dev/core';
import { upReport } from '../src/up';

test('Acceptance 3: stint up warms a fake local host once in the background and reports each key', async () => {
  const warmBodies: Array<Record<string, unknown>> = [];
  const local = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/chat') {
        warmBodies.push((await req.json()) as Record<string, unknown>);
        // a slow warm must not hold up the report
        await Bun.sleep(400);
        return Response.json({ message: { content: 'ok' } });
      }
      return new Response('no', { status: 404 });
    },
  });
  let modelLists = 0;
  const hosted = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') {
        modelLists++;
        return req.headers.get('authorization') === 'Bearer good-key'
          ? Response.json({ object: 'list', data: [] })
          : Response.json({ error: 'bad key' }, { status: 401 });
      }
      return new Response('no', { status: 404 });
    },
  });
  try {
    const config = structuredClone(DEFAULT_CONFIG) as Config;
    config.hosts = {
      ollama: { baseURL: `http://127.0.0.1:${local.port}/v1`, models: { fake: 'fake' }, offline: true, structuredOutput: 'enforced', cachedInput: false },
      fireworks: { baseURL: `http://127.0.0.1:${hosted.port}/v1`, keyEnv: 'FIREWORKS_API_KEY', models: { 'muse-spark-open': 'muse-spark-open' }, offline: false, structuredOutput: 'enforced', cachedInput: true },
      baseten: { baseURL: `http://127.0.0.1:${hosted.port}/v1`, keyEnv: 'BASETEN_API_KEY', models: { 'muse-spark-open': 'muse-spark-open' }, offline: false, structuredOutput: 'accepted', cachedInput: true },
    };
    config.routes.reviewer = ['ollama/fake', 'fireworks/muse-spark-open'];
    const started = Date.now();
    const report = await upReport(config, { FIREWORKS_API_KEY: 'good-key' });
    const elapsed = Date.now() - started;
    expect(report.warming).toContain('ollama/fake');
    expect(report.warming?.toLowerCase()).toContain('background');
    expect(elapsed).toBeLessThan(350);
    expect(report.keyLines.some((l) => l.includes('fireworks') && l.includes('ok'))).toBe(true);
    expect(report.keyLines.some((l) => l.includes('baseten') && l.includes('BASETEN_API_KEY') && l.includes('not set'))).toBe(true);
    expect(modelLists).toBe(1);
    await report.warmDone;
    expect(warmBodies).toHaveLength(1);
    expect(warmBodies[0]?.model).toBe('fake');
    expect(warmBodies[0]?.keep_alive).toBe('30m');
  } finally {
    local.stop(true);
    hosted.stop(true);
  }
});
