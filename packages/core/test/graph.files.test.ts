import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../../daemon/src/index';
import { Workspace, filesTogether } from '../src/node';
import { withFixtureRepo } from './fixture';

async function replayed(repo: string): Promise<Workspace> {
  const ws = await Workspace.open(repo);
  const r = new Replayer(ws);
  r.load(DEFAULT_RECORDING);
  await r.play({ speed: 0 });
  return ws;
}

describe('graph files together', () => {
  test("filesTogether('src/lib/limiter.ts') returns src/routes/webhooks.ts with count >= 1", async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await replayed(repo);
      const rows = await filesTogether(ws, 'src/lib/limiter.ts');
      const webhooks = rows.find((r) => r.path === 'src/routes/webhooks.ts');
      expect(webhooks).toBeDefined();
      expect(webhooks?.count).toBeGreaterThanOrEqual(1);
      expect(rows.map((r) => r.path)).not.toContain('src/lib/limiter.ts');
      const counts = rows.map((r) => r.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });
  }, 60_000);
});
