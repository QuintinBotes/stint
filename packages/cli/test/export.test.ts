import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtTask, post, tempDir, withFixtureRepo } from '../../daemon/test/helpers';
import { exportEntire } from '../src/approve';

test('stint export --format entire writes the latest packet and a pairing of the merge commit with the runs that wrote it', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const { commit } = (await (await post(app, `/api/tasks/${t.id}/approve`, {})).json()) as { commit: string };
    const out = tempDir('stint-export-');
    try {
      expect(await exportEntire(repo, t.id, out.dir)).toEqual(['packet.json', 'checkpoint.json']);
      const packet = JSON.parse(readFileSync(join(out.dir, 'packet.json'), 'utf8')) as { hash: string };
      expect(packet.hash).toBe((await ws.handoffs(t.id).latest())?.hash as string);
      const pairing = JSON.parse(readFileSync(join(out.dir, 'checkpoint.json'), 'utf8'));
      expect(pairing).toMatchObject({ version: 'stint.checkpoint/1', task: { id: t.id, status: 'done' }, commit, merged: { by: 'you' }, packet: { file: 'packet.json', hash: packet.hash } });
      expect(pairing.sessions).toEqual([expect.objectContaining({ run: 'r1', agent: 'fake', role: 'implementer', endedBy: expect.any(String) })]);
    } finally {
      out.cleanup();
    }
  });
}, 120_000);
