import { expect, test } from 'bun:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { RunRegistry, Worktrees } from '../src/index';
import { newTask, withFixtureRepo } from './helpers';

test('Editing a file in the worktree produces a file.changed event within 6 s with the right added/removed', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const wt = new Worktrees(ws, new RunRegistry());
    const task = await ws.createTask(newTask);
    const { path } = await wt.create(task, 'r1');
    const snaps = wt.startSnapshots(task, 'r1', path);
    const t0 = Date.now();
    appendFileSync(join(path, 'src/config.ts'), 'export const A = 1;\nexport const B = 2;\n');
    writeFileSync(join(path, 'src/lib/limiter.ts'), 'export const limit = 60;\n');
    let changed: Array<Record<string, unknown>> = [];
    while (Date.now() - t0 < 6_000) {
      changed = (await ws.events(task.id).read()).filter((e) => e.type === 'file.changed').map((e) => e.payload);
      if (changed.length >= 2) break;
      await Bun.sleep(100);
    }
    await snaps.stop();
    expect(Date.now() - t0).toBeLessThan(6_000);
    expect(changed).toContainEqual({ path: 'src/config.ts', added: 2, removed: 0, run: 'r1' });
    expect(changed).toContainEqual({ path: 'src/lib/limiter.ts', added: 1, removed: 0, run: 'r1' });
    const before = (await ws.events(task.id).read()).length;
    await wt.startSnapshots(task, 'r1', path).stop();
    expect((await ws.events(task.id).read()).length).toBe(before + 2);
  });
}, 15_000);
