import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { DaemonVerifier, RunRegistry, Worktrees, execInGroup, parseTestSummary } from '../src/index';
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

test('The test cap counts awake time: a timer that fires after a sleep is set again, and a command that really runs over is still killed', async () => {
  // a clock that stood still, as performance.now does while a Mac sleeps: the 100 ms timer fires, 0 ms were awake
  const asleep = await execInGroup('sleep 0.4; echo finished', process.cwd(), { PATH: process.env.PATH ?? '' }, 100, () => 0);
  expect(asleep).toMatchObject({ exitCode: 0, timedOut: false });
  expect(asleep.output).toContain('finished');

  const over = await execInGroup('sleep 2; echo finished', process.cwd(), { PATH: process.env.PATH ?? '' }, 150);
  expect(over.timedOut).toBe(true);
  expect(over.output).not.toContain('finished');
});

test('a test command whose folder is gone comes back red with the reason, and the daemon keeps running', async () => {
  const gone = join(process.cwd(), 'no-such-worktree-for-stint');
  const r = await execInGroup('echo finished', gone, { PATH: process.env.PATH ?? '' }, 5_000);
  expect(r.exitCode).toBe(127);
  expect(r.timedOut).toBe(false);
  expect(r.output).toStartWith('stint: the command could not start: ');
  expect(r.output).toContain('ENOENT');
  expect(r.output).not.toContain('finished');
});
