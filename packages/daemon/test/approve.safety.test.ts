import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk, worktreePath } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

const code = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; hint: unknown } }).error;
const commitIn = (dir: string, args: string[]) => gitOk(dir, ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.com', ...args]);

test('approve merges only the commit the daemon verified: a branch that moved after its tests is refused', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const v = await ws.verification(t.id).latest();
    await ws.verification(t.id).write({ ...(v as NonNullable<typeof v>), commit: '0'.repeat(40) });
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(await code(res)).toMatchObject({ code: 'verification_red', message: expect.stringContaining('moved after the last verification') });
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
}, 120_000);

test('a second approve of the same task is refused and merges nothing', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, t } = await builtTask(repo);
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const again = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(again.status).toBe(400);
    expect((await code(again)).message).toContain('already approved and merged');
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
}, 120_000);

test('a merge that would overwrite an ignored file in the main tree is refused and the file is untouched', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const wt = worktreePath(ws, t.id, 'r1');
    writeFileSync(join(wt, '.env'), 'FROM_THE_AGENT=1\n');
    await commitIn(wt, ['add', '-f', '.env']);
    await commitIn(wt, ['commit', '-qm', 'agent adds an env file']);
    writeFileSync(join(repo, '.env'), 'MINE=1\n');
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(await code(res)).toMatchObject({ code: 'dirty_tree', hint: { files: ['.env'] } });
    expect(readFileSync(join(repo, '.env'), 'utf8')).toBe('MINE=1\n');
  });
}, 120_000);

test('approve is refused after an agent changed the locked acceptance tests', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    await ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'acceptance.locked', payload: { run: 'r1', files: [{ path: 'test/a.test.ts', sha256: 'sha256:x' }], failing: ['a'] } });
    await ws.events(t.id).append({ task: t.id, run: 'r2', vendor: 'daemon', type: 'acceptance.tampered', payload: { run: 'r2', files: ['test/a.test.ts'] } });
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(await code(res)).toMatchObject({ code: 'review_blocked', message: 'an agent changed the locked acceptance tests' });
  });
}, 120_000);
