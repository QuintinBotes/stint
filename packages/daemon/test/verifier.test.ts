import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { DaemonVerifier, RunRegistry, Worktrees, parseTestSummary } from '../src/index';
import { newTask, withFixtureRepo } from './helpers';

test('verify on the fixture writes verification/r1.json with passed: 27, failed: 0, runBy: daemon; breaking one test yields failed: 1 and exitCode: 1', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const task = await ws.createTask(newTask);
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    const v = new DaemonVerifier(ws);

    const green = await v.verify(task, 'r1', path);
    expect(green).toMatchObject({ command: 'bun run test', exitCode: 0, passed: 27, failed: 0, runBy: 'daemon', status: 'green' });
    const file = JSON.parse(readFileSync(join(await ws.taskDir(task.id), 'verification', 'r1.json'), 'utf8'));
    expect(file).toMatchObject({ passed: 27, failed: 0, runBy: 'daemon', outputRef: 'verification/r1.out.txt' });

    const testFile = join(path, 'test/backoff.test.ts');
    writeFileSync(testFile, readFileSync(testFile, 'utf8').replace('toBe(30_000)', 'toBe(29_999)'));
    const red = await v.verify(task, 'r2', path);
    expect(red).toMatchObject({ exitCode: 1, passed: 26, failed: 1, status: 'red' });
    const ran = (await ws.events(task.id).read()).filter((e) => e.type === 'verification.ran').map((e) => e.payload.status);
    expect(ran).toEqual(['green', 'red']);
  });
}, 60_000);

test('parses Vitest and bun test summaries, and falls back when there is neither', () => {
  expect(parseTestSummary('      Tests  27 passed (27)\n')).toEqual({ passed: 27, failed: 0 });
  expect(parseTestSummary('      Tests  1 failed | 26 passed (27)\n')).toEqual({ passed: 26, failed: 1 });
  expect(parseTestSummary(' 66 pass\n 2 fail\n Ran 68 tests')).toEqual({ passed: 66, failed: 2 });
  expect(parseTestSummary('ok')).toBeNull();
});
