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

      // the review's findings on T-0042 stay open, each with its file and the decision it would reverse
      const open = (await (await app.request('/api/graph/query?q=open-findings&task=T-0042')).json()) as Array<Record<string, unknown>>;
      expect(open.map(({ id, node, run, file, severity, contradictsDecision, linksTo }) => ({ id, node, run, file, severity, contradictsDecision, linksTo }))).toEqual([
        { id: 'F1', node: 'finding:T-0042/r4#F1', run: 'r4', file: 'src/lib/limiter.ts', severity: 'minor', contradictsDecision: null, linksTo: 'R2' },
        { id: 'F2', node: 'finding:T-0042/r4#F2', run: 'r4', file: 'src/lib/limiter.ts', severity: 'note', contradictsDecision: 'D3', linksTo: null },
      ]);
      expect(await (await app.request('/api/graph/query?q=open-findings&task=T-0043')).json()).toEqual([]);
      const none = await app.request('/api/graph/query?q=open-findings');
      expect(none.status).toBe(400);
      expect(((await none.json()) as { error: { message: string } }).error.message).toBe('q=open-findings needs a task');
    });
  }, 60_000);
});
