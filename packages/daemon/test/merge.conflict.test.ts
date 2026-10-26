import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

test('A conflicting base commit yields merge_conflict with the file list and a clean tree', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    writeFileSync(join(repo, 'src/lib/limiter.ts'), 'export const LIMIT = 120;\n');
    await gitOk(repo, ['add', 'src/lib/limiter.ts']);
    await gitOk(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'Add the limit on main']);
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    const err = ((await res.json()) as { error: { code: string; hint: { files: string[] } } }).error;
    expect(err.code).toBe('merge_conflict');
    expect(err.hint.files).toEqual(['src/lib/limiter.ts']);
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await gitOk(repo, ['status', '--porcelain', '--untracked-files=no'])).trim()).toBe('');
    expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
  });
}, 120_000);
