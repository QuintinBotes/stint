import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../../daemon/src/index';
import { Workspace, project } from '../src/node';
import { withFixtureRepo } from './fixture';

async function replayed(repo: string): Promise<Workspace> {
  const ws = await Workspace.open(repo);
  const r = new Replayer(ws);
  r.load(DEFAULT_RECORDING);
  await r.play({ speed: 0 });
  return ws;
}

describe('graph cost and links_to edges (R-052)', () => {
  test('The graph has cost and links_to edges after the replay', async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await replayed(repo);
      const graph = await project(ws, { cache: false });
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));

      // cost: the killed T-0042 r2 hangs from the model it ran on, with its usd and tokens
      const cost = graph.edges.filter((e) => e.type === 'cost');
      expect(cost.length).toBeGreaterThan(0);
      const r2 = cost.find((e) => e.from === 'run:T-0042/r2');
      expect(r2).toBeDefined();
      expect(byId.get(r2?.to as string)?.type).toBe('model');
      expect(String(r2?.data.model)).toContain('muse-spark-1.3');
      expect(r2?.data.usd).toBe(0.2117);
      expect(r2?.data.inputTokens).toBe(612400);
      expect(r2?.data.outputTokens).toBe(9840);
      expect(r2?.data.tokens).toBe(612400 + 9840);
      expect(r2?.validTo).toBeNull();
      expect((r2?.eventId ?? '').length).toBeGreaterThan(0);

      // links_to: the finding that would reverse D3 cites it, and a finding that names a rule cites the rule
      const links = graph.edges.filter((e) => e.type === 'links_to');
      expect(links.length).toBeGreaterThanOrEqual(2);
      const toDecision = links.find((e) => e.to === 'decision:T-0042/D3');
      expect(toDecision).toBeDefined();
      expect(byId.get(toDecision?.from as string)?.type).toBe('finding');
      expect(toDecision?.data.decision).toBe('D3');
      const toRule = links.find((e) => e.to === 'rule:R2');
      expect(toRule).toBeDefined();
      expect(byId.get('rule:R2')?.type).toBe('rule');
      expect(toRule?.data.rule).toBe('R2');
    });
  }, 60_000);
});
