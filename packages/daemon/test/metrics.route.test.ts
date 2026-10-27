import { describe, expect, test } from 'bun:test';
import { MetricsSchema } from '@stint-dev/core';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { makeApp, withFixtureRepo } from './helpers';

describe('R-061 Acceptance 5: GET /api/metrics?window=all&by=agent&series=week on the replayed demo returns validating objects; an unknown by returns invalid (400)', () => {
  test('series returns one stint.metrics/1 per ISO week, oldest first', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0 });
      const res = await app.request('/api/metrics?window=all&by=agent&series=week');
      expect(res.status).toBe(200);
      const series = (await res.json()) as Array<{ window: { from: string | null } }>;
      expect(series.length).toBeGreaterThan(0);
      for (const item of series) expect(MetricsSchema.safeParse(item).success).toBe(true);
      const froms = series.map((s) => s.window.from ?? '');
      expect(froms).toEqual([...froms].sort());
    });
  }, 60_000);

  test('a plain window returns one validating object; unknown window and by are invalid', async () => {
    await withFixtureRepo(async (repo) => {
      const { app } = await makeApp(repo);
      const res = await app.request('/api/metrics?window=all');
      expect(res.status).toBe(200);
      expect(MetricsSchema.safeParse(await res.json()).success).toBe(true);
      const badBy = await app.request('/api/metrics?window=all&by=vendor');
      expect(badBy.status).toBe(400);
      expect(((await badBy.json()) as { error: { code: string } }).error.code).toBe('invalid');
      const badWindow = await app.request('/api/metrics?window=year');
      expect(badWindow.status).toBe(400);
      expect(((await badWindow.json()) as { error: { code: string } }).error.code).toBe('invalid');
    });
  });
});
