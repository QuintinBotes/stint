import { describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RECORDING, Replayer } from '../../daemon/src/index';
import { Workspace, project, similar } from '../src/node';
import { withFixtureRepo } from './fixture';

async function replayed(repo: string): Promise<Workspace> {
  const ws = await Workspace.open(repo);
  const r = new Replayer(ws);
  r.load(DEFAULT_RECORDING);
  await r.play({ speed: 0 });
  return ws;
}

describe('graph cache', () => {
  test('Deleting graph.sqlite and querying again returns identical rows', async () => {
    await withFixtureRepo(async (repo) => {
      const ws = await replayed(repo);
      const cacheFile = join(repo, '.stint', 'cache', 'graph.sqlite');
      const rows1 = await similar(ws, 'T-0042');
      const graph1 = await project(ws);
      expect(existsSync(cacheFile)).toBe(true);

      rmSync(cacheFile);
      expect(existsSync(cacheFile)).toBe(false);

      const rows2 = await similar(ws, 'T-0042');
      const graph2 = await project(ws);
      expect(rows2).toEqual(rows1);
      expect(graph2).toEqual(graph1);
      expect(existsSync(cacheFile)).toBe(true);
    });
  }, 60_000);
});
