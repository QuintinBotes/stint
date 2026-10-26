import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../src/index';
import { makeApp, withFixtureRepo } from './helpers';

type GraphReply = {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ from: string; to: string }>;
  asOf: string | null;
  total: number;
};

describe('graph route', () => {
  test('GET /graph on T-0042 returns at most 60 nodes with the task at index 0', async () => {
    await withFixtureRepo(async (repo) => {
      const { ws, app } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      await r.play({ speed: 0 });

      const res = await app.request('/api/tasks/T-0042/graph');
      expect(res.status).toBe(200);
      const body = (await res.json()) as GraphReply;
      expect(body.nodes.length).toBeLessThanOrEqual(60);
      expect(body.nodes.length).toBeGreaterThan(1);
      expect(body.nodes[0]?.id).toBe('task:T-0042');
      expect(body.total).toBeGreaterThanOrEqual(body.nodes.length);
      const ids = new Set(body.nodes.map((n) => n.id));
      for (const e of body.edges) {
        expect(ids.has(e.from)).toBe(true);
        expect(ids.has(e.to)).toBe(true);
      }

      const rows = (await (await app.request('/api/graph/query?q=similar&task=T-0042')).json()) as Array<{ task: string }>;
      expect(rows.map((row) => row.task)).toContain('T-0043');
    });
  }, 60_000);
});
