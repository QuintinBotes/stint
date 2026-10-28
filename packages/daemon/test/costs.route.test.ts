import { describe, expect, test } from 'bun:test';
import { weekOf } from '@stint-dev/core';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { makeApp, newTask, withFixtureRepo } from './helpers';

type Row = { key: string; usd: number; runs: number; creditsLeft?: number; derived?: boolean };

describe('/api/costs', () => {
  test('GET /api/costs?group=day on the replayed recording returns one row per day with the sum equal to the task totals, the learn step included', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0 });
      const days = (await (await app.request('/api/costs?group=day')).json()) as Row[];
      const tasks = (await (await app.request('/api/costs?group=task')).json()) as Row[];
      expect(new Set(days.map((d) => d.key)).size).toBe(days.length);
      const sum = (rows: Row[]) => Math.round(rows.reduce((s, x) => s + x.usd, 0) * 10_000) / 10_000;
      // a task's total is everything spent on it, so T-0042 carries its learn step's $0.015 on Baseten too
      expect(sum(days)).toBe(sum(tasks));
      expect(tasks.find((t) => t.key === 'T-0042')?.usd.toFixed(2)).toBe('0.63');
    });
  }, 60_000);

  test('GET /api/costs?group=week on the replayed recording is one row for this local week, and every grouping adds up to it', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0 });
      const get = async (group: string) => (await (await app.request(`/api/costs?group=${group}`)).json()) as Row[];
      const sum = (rows: Row[]) => Math.round(rows.reduce((s, x) => s + x.usd, 0) * 10_000) / 10_000;
      // a replay stamps its events when it plays them, so all six runs and the learn step land in the week it was played
      expect(await get('week')).toEqual([expect.objectContaining({ key: weekOf(new Date()), usd: 0.7581, runs: 6, unpriced: 0 })]);
      for (const group of ['task', 'run', 'day', 'host', 'model', 'day-host']) expect([group, sum(await get(group))]).toEqual([group, 0.7581]);
      expect((await get('host')).find((h) => h.key === 'baseten')).toMatchObject({ usd: 0.015, runs: 0, creditsLeft: 99.985 });
      const bad = await app.request('/api/costs?group=month');
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: { hint: string } }).error.hint).toContain('week');
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

  test('A Claude Code run on its own login draws no Meta Model API credits, and a Stint agent fallback draws its own host', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      const ev = ws.events(t.id);
      const cost = (usd: number) => ({ inputTokens: 1000, cachedTokens: 0, outputTokens: 100, usd });
      await ev.append({ task: t.id, run: 'r1', adapter: 'claude-code', vendor: 'anthropic', type: 'run.started', payload: { role: 'implementer', host: 'local-cli', model: 'sonnet' } });
      await ev.append({ task: t.id, run: 'r1', adapter: 'claude-code', vendor: 'anthropic', type: 'run.finished', payload: { endedBy: 'completed', cost: cost(0.5), host: 'local-cli', model: 'sonnet' } });
      await ev.append({ task: t.id, run: 'r2', adapter: 'stint-agent', vendor: 'meta', type: 'run.started', payload: { role: 'implementer', host: 'local-cli', model: 'muse-spark-1.3' } });
      await ev.append({ task: t.id, run: 'r2', adapter: 'stint-agent', vendor: 'meta', type: 'run.finished', payload: { endedBy: 'completed', cost: cost(0.1), host: 'fireworks', model: 'muse-spark-open' } });
      const hosts = (await (await app.request('/api/costs?group=host')).json()) as Row[];
      expect(hosts.find((h) => h.key === 'meta-api')).toMatchObject({ usd: 0, creditsLeft: 150 });
      expect(hosts.find((h) => h.key === 'fireworks')).toMatchObject({ usd: 0.1, runs: 1, creditsLeft: 24.9 });
      const claude = hosts.find((h) => h.key === 'claude-code');
      expect(claude).toMatchObject({ usd: 0.5, runs: 1 });
      expect(claude?.creditsLeft).toBeUndefined();
    });
  });
});
