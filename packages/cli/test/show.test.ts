import { expect, test } from 'bun:test';
import { builtTask, post, withFixtureRepo } from '../../daemon/test/helpers';
import { showCommit } from '../src/approve';

test('stint show <commit> prints the task id, runs and packet path from the trailers', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, t } = await builtTask(repo);
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    const out = await showCommit(repo, 'HEAD');
    expect(out).toContain(`Task: ${t.id} Rate-limit incoming webhooks`);
    expect(out).toContain('Runs: r1');
    expect(out).toMatch(/Packet: \.stint\/tasks\/T-0001-[a-z-]+\/handoffs\/h1\.json \(sha256:[0-9a-f]{64}\)/);
    expect(out).toContain('Verified: bun run test 33/33');
    await expect(showCommit(repo, 'HEAD~1')).rejects.toThrow('has no Stint-Task trailer');
  });
}, 120_000);
