import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

test("Restoring a checkpoint's code opens the commit the run ended on in a detached worktree; the branch does not move", async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const commit = (await ws.events(t.id).read()).find((e) => e.type === 'run.finished')?.payload.commit as string;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    const task = await ws.readTask(t.id);
    const branchBefore = (await gitOk(repo, ['rev-parse', task.branch])).trim();

    const res = await post(app, `/api/tasks/${t.id}/runs/r1/restore`, { what: 'code' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; commit: string };
    expect(body).toEqual({ path: `.stint/worktrees/${t.id}-r1-checkpoint`, commit });
    expect((await gitOk(join(repo, body.path), ['rev-parse', 'HEAD'])).trim()).toBe(commit);
    expect((await gitOk(join(repo, body.path), ['symbolic-ref', '-q', 'HEAD']).catch(() => 'detached')).trim()).toBe('detached');
    expect((await gitOk(repo, ['rev-parse', task.branch])).trim()).toBe(branchBefore);
    // asking again returns the same worktree
    expect((await post(app, `/api/tasks/${t.id}/runs/r1/restore`, { what: 'code' })).status).toBe(200);

    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
    expect(await code(await post(app, `/api/tasks/${t.id}/runs/r1/restore`, { what: 'conversation' }))).toBe('invalid');
    expect(await code(await post(app, `/api/tasks/${t.id}/runs/..%2Fx/restore`, { what: 'code' }))).toBe('invalid');
    expect(await code(await post(app, `/api/tasks/${t.id}/runs/r9/restore`, { what: 'code' }))).toBe('not_found');
    expect(existsSync(join(repo, '.stint/worktrees', `${t.id}-r9-checkpoint`))).toBe(false);
  });
}, 120_000);
