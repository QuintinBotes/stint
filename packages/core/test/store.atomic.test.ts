import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/node';
import { withFixtureRepo } from './fixture';

test('Killing the process (simulated by throwing) between temp write and rename leaves the previous task.json intact', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const task = await ws.createTask({ title: 'Atomic write', goal: 'Prove the rename is the commit point.', acceptance: ['task.json survives'] });
    const dir = await ws.taskDir(task.id);
    const before = readFileSync(join(dir, 'task.json'), 'utf8');
    const crash = () => {
      throw new Error('killed between write and rename');
    };
    await expect(ws.writeTask(task.id, { title: 'Half written' }, { beforeRename: crash })).rejects.toThrow('killed');
    expect(readFileSync(join(dir, 'task.json'), 'utf8')).toBe(before);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await ws.readTask(task.id)).title).toBe('Atomic write');
  });
});
