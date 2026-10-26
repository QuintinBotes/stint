import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { daemonContext } from '../src/app';
import { parseHeaders, tracesUrl } from '../src/otel';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

beforeAll(() => {
  process.env.STINT_TEST_OTEL_HEADERS = 'x-api-key=abc%3D,x-team=stint';
});
afterAll(() => {
  delete process.env.STINT_TEST_OTEL_HEADERS;
});

async function built(repo: string, endpoint: string) {
  const config = structuredClone(DEFAULT_CONFIG);
  config.otel = { endpoint, headersEnv: 'STINT_TEST_OTEL_HEADERS', serviceName: 'stint-test' };
  mkdirSync(join(repo, '.stint'), { recursive: true });
  writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
  const made = await makeApp(repo, [fakeAdapter('edit')]);
  const t = await made.ws.createTask({ title: 'Trace a run', goal: 'Export spans.', acceptance: ['spans'], testCommand: 'true' });
  await post(made.app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
  const ctx = daemonContext(made.app);
  for (let i = 0; i < 600 && (ctx.runs.get(t.id) || !(await made.ws.events(t.id).read()).some((e) => e.type === 'handoff.created')); i++) await Bun.sleep(50);
  return { ...made, ctx, t };
}

test('OTLP headers parse like OTEL_EXPORTER_OTLP_HEADERS and the traces path is added once', () => {
  expect(parseHeaders('a=1, b = x%3Dy ,bad')).toEqual({ a: '1', b: 'x=y' });
  expect(tracesUrl('http://c:4318')).toBe('http://c:4318/v1/traces');
  expect(tracesUrl('http://c:4318/v1/traces/')).toBe('http://c:4318/v1/traces');
});

test("With an endpoint configured, a run's end posts a batch to a fake collector", async () => {
  const got: Array<{ headers: Headers; body: { resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> }; scopeSpans: Array<{ spans: Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }> }> }> } }> = [];
  const collector = Bun.serve({
    port: 0,
    fetch: async (req) => {
      if (new URL(req.url).pathname !== '/v1/traces') return new Response('no', { status: 404 });
      got.push({ headers: req.headers, body: (await req.json()) as never });
      return Response.json({});
    },
  });
  try {
    await withFixtureRepo(async (repo) => {
      const { ctx } = await built(repo, `http://127.0.0.1:${collector.port}`);
      await ctx.otel.flush();
      for (let i = 0; i < 100 && got.length === 0; i++) await Bun.sleep(20);
      expect(got.length).toBeGreaterThan(0);
      expect(got[0]?.headers.get('x-api-key')).toBe('abc=');
      const spans = got.flatMap((g) => g.body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
      const run = spans.find((s) => s.name === 'invoke_agent fake');
      expect(run?.attributes).toContainEqual({ key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } });
      expect(run?.attributes).toContainEqual({ key: 'stint.run', value: { stringValue: 'r1' } });
      expect(spans.map((s) => s.name)).toContain('execute_tool write_file');
      expect(got[0]?.body.resourceSpans[0]?.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'stint-test' } });
    });
  } finally {
    collector.stop(true);
  }
}, 60_000);

test('A collector that is down costs a log line, never the run', async () => {
  await withFixtureRepo(async (repo) => {
    const { ws, t, ctx } = await built(repo, 'http://127.0.0.1:9');
    await ctx.otel.flush();
    const v = (await ws.events(t.id).read()).find((e) => e.type === 'verification.ran');
    expect(v?.payload.status).toBe('green');
  });
}, 60_000);
