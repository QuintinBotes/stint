import { expect, test } from 'bun:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk, parseNumstat } from '../src/index';
import { makeApp, newTask, withFixtureRepo } from './helpers';

test('GET /diff?format=json equals git diff --numstat run by hand', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const task = await ws.createTask(newTask);
    const { Worktrees, RunRegistry } = await import('../src/index');
    const wt = new Worktrees(ws, new RunRegistry());
    const { path } = await wt.create(task, 'r1');
    appendFileSync(join(path, 'src/routes/webhooks.ts'), '// limiter goes here\n');
    writeFileSync(join(path, 'src/lib/limiter.ts'), 'export const limit = 60;\nexport const windowMs = 60_000;\n');
    await wt.commit(task, 'r1', path, 'limiter');

    const byHand = parseNumstat(await gitOk(repo, ['diff', '--numstat', `${task.baseCommit}..stint/T-0001`]));
    const res = await app.request(`/api/tasks/${task.id}/diff?format=json`);
    expect(await res.json()).toEqual(byHand);
    expect(byHand).toContainEqual({ path: 'src/lib/limiter.ts', added: 2, removed: 0 });
    const unified = await (await app.request(`/api/tasks/${task.id}/diff`)).text();
    expect(unified).toContain('+export const limit = 60;');
  });
}, 30_000);
