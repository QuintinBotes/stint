import { afterAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Handoff, type Plan, type Review, Workspace, costs, taskBundle } from '../src/node';
import { example } from './ajv';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);
const EXPECTED = join(import.meta.dir, 'fixtures', 'bundle.expected.json');
const VOLATILE = new Set(['ts', 'createdAt', 'updatedAt', 'at', 'startedAt', 'endedAt', 'recordedAt']);

/** Timestamps and ids change every run; the shape and the numbers must not. */
function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, VOLATILE.has(k) && typeof v === 'string' ? '<time>' : mask(v)]));
  }
  return value;
}

async function seed(): Promise<Workspace> {
  const ws = await Workspace.open(tmp.dir);
  const t = await ws.createTask({
    id: 'T-0042',
    title: 'Rate-limit incoming webhooks per tenant',
    goal: 'POST /webhooks answers 429 with Retry-After when a tenant is over the limit.',
    acceptance: ['A tenant over the limit gets 429 with Retry-After', 'The limit comes from config'],
    testCommand: 'bun run test',
    baseCommit: 'be1bee8d153659647701b8f5886f0a5c73cf276a',
  });
  const ev = ws.events(t.id);
  await ws.writePlan(t.id, example('plan') as Plan);
  await ev.append({ task: t.id, run: 'r1', adapter: 'openai-compatible', vendor: 'meta', type: 'run.started', payload: { role: 'planner', model: 'muse-wonder-1.0', host: 'meta-api' } });
  await ev.append({ task: t.id, run: 'r1', adapter: 'openai-compatible', vendor: 'meta', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 5200, cachedTokens: 0, outputTokens: 900, usd: 0.0388 } } });
  await ev.append({ task: t.id, run: 'r2', adapter: 'muse-code', vendor: 'meta', type: 'run.started', payload: { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' } });
  await ev.append({ task: t.id, run: 'r2', adapter: 'muse-code', vendor: 'meta', type: 'run.finished', payload: { endedBy: 'killed', inFlight: 'write_file test/ratelimit.test.ts', cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 3910, usd: 0.0303 } } });
  await ws.verification(t.id).write({ run: 'r2', command: 'bun run test', exitCode: 0, passed: 30, failed: 0, durationMs: 1630, runBy: 'daemon', status: 'green', outputRef: 'verification/r2.out.txt', at: new Date().toISOString() });
  await ws.handoffs(t.id).write(example('handoff-killed') as Handoff);
  await ws.writeReview(t.id, example('review') as Review);
  return ws;
}

test('taskBundle on a seeded task dir equals the expected JSON fixture', async () => {
  const ws = await seed();
  const bundle = mask(await taskBundle(ws, 'T-0042'));
  if (!existsSync(EXPECTED) || process.env.UPDATE_FIXTURES === '1') writeFileSync(EXPECTED, `${JSON.stringify(bundle, null, 2)}\n`);
  expect(bundle).toEqual(JSON.parse(readFileSync(EXPECTED, 'utf8')));
  const rows = await costs(ws, { group: 'run' });
  expect(rows.map((r) => [r.key, r.usd])).toEqual([['T-0042/r1', 0.0388], ['T-0042/r2', 0.0303]]);
  expect((await costs(ws, { group: 'task' }))[0]).toMatchObject({ key: 'T-0042', usd: 0.0691, runs: 2 });
});
