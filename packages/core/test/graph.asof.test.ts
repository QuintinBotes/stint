import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../../daemon/src/index';
import { Workspace, constrains } from '../src/node';
import { withFixtureRepo } from './fixture';

async function replayed(repo: string): Promise<Workspace> {
  const ws = await Workspace.open(repo);
  const r = new Replayer(ws);
  r.load(DEFAULT_RECORDING);
  await r.play({ speed: 0 });
  return ws;
}

describe('graph constrains as of', () => {
  test("constrains('T-0042') includes D3; with asOf before D3's recordedAt it does not; after a superseding D4 it includes D4 and not D3", async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await replayed(repo);
      const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
      expect(ids(await constrains(ws, 'T-0042'))).toContain('D3');

      const d3 = (await ws.decisions('T-0042').read()).find((d) => d.id === 'D3');
      expect(d3).toBeDefined();
      const before = new Date(Date.parse(d3?.recordedAt as string) - 1).toISOString();
      expect(ids(await constrains(ws, 'T-0042', before))).not.toContain('D3');

      const d4 = await ws.decisions('T-0042').append({
        text: 'Fixed window is enough now that the window edge case is covered elsewhere',
        supersedes: 'D3',
        by: 'human review',
      });
      expect(d4.id).toBe('D4');
      const after = ids(await constrains(ws, 'T-0042'));
      expect(after).toContain('D4');
      expect(after).not.toContain('D3');
    });
  }, 60_000);
});
