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

test('parses Vitest, Jest, bun test and Mocha summaries, adds up a command that runs several, and falls back when there is none', () => {
  expect(parseTestSummary('      Tests  27 passed (27)\n')).toEqual({ passed: 27, failed: 0 });
  expect(parseTestSummary('      Tests  1 failed | 26 passed (27)\n')).toEqual({ passed: 26, failed: 1 });
  expect(parseTestSummary(' 66 pass\n 2 fail\n Ran 68 tests')).toEqual({ passed: 66, failed: 2 });
  // vercel/ms runs Jest twice, for node and for the edge runtime
  const jest = (line: string) => `Test Suites: 1 passed, 1 total\nTests:       ${line}\nSnapshots:   0 total\nTime:        0.4 s\n`;
  expect(parseTestSummary(jest('1 failed, 88 passed, 89 total') + jest('89 passed, 89 total'))).toEqual({ passed: 177, failed: 1 });
  expect(parseTestSummary('  ✔ picks the server preference\n\n  261 passing (32ms)\n  3 pending\n')).toEqual({ passed: 261, failed: 0 });
  expect(parseTestSummary('  257 passing (40ms)\n  3 pending\n  4 failing\n\n  1) negotiator.mediaTypes()\n')).toEqual({ passed: 257, failed: 4 });
  expect(parseTestSummary('ok')).toBeNull();
  expect(parseTestSummary('Ran 5 tests in 0.01s\n\nOK\n')).toBeNull();
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
