import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { worktreePath } from '../src/index';
import { builtTask, post, withFixtureRepo } from './helpers';

test('Re-run after approve, with the worktree gone, verifies the task branch in a temporary checkout, removes it, and the output can be read', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    expect((await post(app, `/api/tasks/${t.id}/approve`, {})).status).toBe(200);
    expect(existsSync(worktreePath(ws, t.id, 'r1'))).toBe(false);

    const res = await post(app, `/api/tasks/${t.id}/verify`, {});
    expect(res.status).toBe(200);
    const v = (await res.json()) as { run: string; status: string; commit?: string; command: string };
    expect(v).toMatchObject({ run: 'r1', command: 'bun run test', commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    // the temporary checkout is gone and git no longer lists it
    expect(readdirSync(join(ws.cacheDir, 'verify'))).toEqual([]);

    const list = (await (await app.request(`/api/tasks/${t.id}/verification`)).json()) as Array<{ run: string }>;
    expect(list.map((x) => x.run)).toContain('r1');
    const out = await app.request(`/api/tasks/${t.id}/verification/r1/output`);
    expect(out.status).toBe(200);
    expect((await out.text()).length).toBeGreaterThan(0);
    expect((await app.request(`/api/tasks/${t.id}/verification/r9/output`)).status).toBe(404);
  });
}, 180_000);
