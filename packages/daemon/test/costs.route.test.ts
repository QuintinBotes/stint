import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { makeApp, newTask, withFixtureRepo } from './helpers';

type Row = { key: string; usd: number; runs: number; creditsLeft?: number; derived?: boolean };

describe('/api/costs', () => {
  test('GET /api/costs?group=day on the replayed recording returns one row per day with the sum equal to the task totals', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0 });
      const days = (await (await app.request('/api/costs?group=day')).json()) as Row[];
      const tasks = (await (await app.request('/api/costs?group=task')).json()) as Row[];
      expect(new Set(days.map((d) => d.key)).size).toBe(days.length);
      const sum = (rows: Row[]) => Math.round(rows.reduce((s, x) => s + x.usd, 0) * 10_000) / 10_000;
      expect(sum(days)).toBe(sum(tasks));
      expect(tasks.find((t) => t.key === 'T-0042')?.usd.toFixed(2)).toBe('0.61');
    });
  }, 60_000);

  test('After two priced runs on baseten, /api/costs?group=host shows creditsLeft as 100 minus their sum, flagged derived: true', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      const ev = ws.events(t.id);
      for (const [run, usd] of [['r1', 0.25], ['r2', 0.5]] as const) {
        await ev.append({ task: t.id, run, adapter: 'openai-compatible', vendor: 'meta', type: 'run.started', payload: { role: 'reviewer', host: 'baseten', model: 'muse-spark-open' } });
        await ev.append({ task: t.id, run, adapter: 'openai-compatible', vendor: 'meta', type: 'run.finished', payload: { endedBy: 'completed', cost: { inputTokens: 1000, cachedTokens: 0, outputTokens: 100, usd } } });
      }
      const hosts = (await (await app.request('/api/costs?group=host')).json()) as Row[];
      expect(hosts.find((h) => h.key === 'baseten')).toMatchObject({ usd: 0.75, runs: 2, creditsLeft: 99.25, derived: true });
      expect(hosts.find((h) => h.key === 'fireworks')).toMatchObject({ usd: 0, creditsLeft: 25, derived: true });
    });
  });
});
