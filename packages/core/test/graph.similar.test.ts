import { describe, expect, test } from 'bun:test';
import { DEFAULT_RECORDING, Replayer } from '../../daemon/src/index';
import { Workspace, similar } from '../src/node';
import { withFixtureRepo } from './fixture';

async function replayed(repo: string): Promise<Workspace> {
  const ws = await Workspace.open(repo);
  const r = new Replayer(ws);
  r.load(DEFAULT_RECORDING);
  await r.play({ speed: 0 });
  return ws;
}

describe('graph similar', () => {
  test("On the replayed fixture, similar('T-0042') returns T-0040 and T-0043, each with its evidence named", async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await replayed(repo);
      const rows = await similar(ws, 'T-0042');
      const ids = rows.map((r) => r.task);
      expect(ids).toContain('T-0040');
      expect(ids).toContain('T-0043');
      expect(ids).not.toContain('T-0042');
      const t43 = rows.find((r) => r.task === 'T-0043');
      expect(t43?.evidence.files).toContain('src/app.ts');
      const t40 = rows.find((r) => r.task === 'T-0040');
      expect(t40?.evidence.themes.some((t) => t.includes('limit'))).toBe(true);
      for (const row of rows) {
        expect(row.score).toBeGreaterThan(0);
        const named = [...row.evidence.files, ...row.evidence.themes, ...row.evidence.tags];
        expect(named.length).toBeGreaterThan(0);
      }
      const scores = rows.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });
  }, 60_000);
});
