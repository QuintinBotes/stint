import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk, parseTrailers, worktreePath } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

test('Approving T-0042 on the fixture copy produces one commit on main whose body carries all four trailers', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const before = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(200);
    const { commit } = (await res.json()) as { commit: string };
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(commit);
    expect((await gitOk(repo, ['rev-list', '--count', `${before}..HEAD`, '--first-parent'])).trim()).toBe('1');
    const body = await gitOk(repo, ['log', '-1', '--format=%B']);
    expect(body).toContain(`Stint-Task: ${t.id}`);
    expect(parseTrailers(body)).toMatchObject({ 'Stint-Task': t.id, 'Stint-Runs': 'r1', 'Stint-Handoff': expect.stringMatching(/^sha256:[0-9a-f]{64}$/), 'Stint-Verified': 'bun run test 33/33' });
    expect((await gitOk(repo, ['log', '-1', '--format=%P'])).trim().split(' ')).toHaveLength(2);
    // the main tree now has the change, and no uncommitted state
    expect(readFileSync(join(repo, 'src/lib/limiter.ts'), 'utf8')).toBe('export const LIMIT = 60;\n');
    expect((await gitOk(repo, ['status', '--porcelain', '--untracked-files=no'])).trim()).toBe('');
    const task = await ws.readTask(t.id);
    expect(task.status).toBe('done');
    expect(JSON.parse(readFileSync(join(await ws.taskDir(t.id), 'signoff.json'), 'utf8'))).toMatchObject({ by: 'you', commit, verificationHash: expect.stringMatching(/^sha256:/) });
    const types = (await ws.events(t.id).read()).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['approval.granted', 'merge.completed', 'learn.skipped']));
    expect(existsSync(worktreePath(ws, t.id, 'r1'))).toBe(false);
    expect((await gitOk(repo, ['branch', '--list', task.branch])).trim()).not.toBe('');
  });
}, 120_000);

test('Approve with a red verification returns 409 verification_red and changes nothing', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo, 'red');
    const head = (await gitOk(repo, ['rev-parse', 'HEAD'])).trim();
    const eventsBefore = (await ws.events(t.id).read()).length;
    const res = await post(app, `/api/tasks/${t.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('verification_red');
    expect((await gitOk(repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await ws.events(t.id).read()).length).toBe(eventsBefore);
    expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');
  });
}, 120_000);
