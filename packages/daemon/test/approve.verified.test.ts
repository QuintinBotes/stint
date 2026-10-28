import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type VerificationRecord, Workspace } from '@stint-dev/core/node';
import { DaemonVerifier, gitOk, worktreePath } from '../src/index';
import { builtTask, newTask, post, tempDir, withFixtureRepo } from './helpers';

const error = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;

test('POST /verify first commits what was changed outside a run, so the verified commit is the tree that was tested', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const wt = worktreePath(ws, t.id, 'r1');
    writeFileSync(join(wt, 'NOTES.md'), 'edited by hand\n');
    const res = await post(app, `/api/tasks/${t.id}/verify`, {});
    expect(res.status).toBe(200);
    const v = (await res.json()) as { commit?: string };
    const head = (await gitOk(wt, ['rev-parse', 'HEAD'])).trim();
    expect(v.commit).toBe(head);
    expect((await gitOk(wt, ['status', '--porcelain'])).trim()).toBe('');
    expect((await gitOk(wt, ['log', '-1', '--format=%s'])).trim()).toContain('outside a run');
    // nothing left to commit: a second verify adds no commit
    await post(app, `/api/tasks/${t.id}/verify`, {});
    expect((await gitOk(wt, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
}, 120_000);

test('POST /verify answers 400 for a run that is not a run id', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, t } = await builtTask(repo);
    const res = await post(app, `/api/tasks/${t.id}/verify`, { run: '../../etc' });
    expect(res.status).toBe(400);
    expect((await error(res)).code).toBe('invalid');
  });
}, 120_000);

test('the verifier records the commit of a repository with 64-hex object ids', async () => {
  const tmp = tempDir('stint-sha256-');
  try {
    const repo = tmp.dir;
    const git = (...args: string[]) => gitOk(repo, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args]);
    await git('init', '-q', '--object-format=sha256', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    await git('add', 'README.md');
    await git('commit', '-qm', 'first');
    const ws = await Workspace.open(repo);
    const task = await ws.createTask({ ...newTask, testCommand: 'true' });
    const v = await new DaemonVerifier(ws).verify(task, 'r1', repo);
    expect(v.commit).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    tmp.cleanup();
  }
}, 60_000);

test('approve refuses when the latest green verification recorded no commit', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const { commit: _, ...v } = (await ws.verification(t.id).latest()) as VerificationRecord;
    await ws.verification(t.id).write(v);
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(await error(res)).toMatchObject({ code: 'verification_red', message: expect.stringContaining('no commit') });
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });
}, 120_000);

test('an unallowed tamper on the latest verification blocks approve; an earlier one a later clean verification replaced does not', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const latest = (await ws.verification(t.id).latest()) as VerificationRecord;
    await ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'acceptance.locked', payload: { run: 'r1', files: [{ path: 'test/a.test.ts', sha256: 'sha256:x' }], failing: [] } });
    await ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'verification.tampered', payload: { run: 'r1', files: ['test/a.test.ts'] } });
    await ws.verification(t.id).write({ ...latest, tamper: { files: ['test/a.test.ts'] } });
    const blocked = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(blocked.status).toBe(409);
    expect(await error(blocked)).toMatchObject({ code: 'review_blocked', message: 'an agent changed the locked acceptance tests' });

    // a later run put the test back; its verification is green with no tamper
    await ws.verification(t.id).write({ ...latest, run: 'r2', tamper: null, at: new Date(Date.now() + 1000).toISOString() });
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
  });
}, 120_000);
