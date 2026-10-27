import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { DaemonVerifier, RunRegistry, Worktrees } from '../src/index';
import { newTask, withFixtureRepo } from './helpers';

const GREEN = `printf ' 2 pass\\n 0 fail\\n'`;

test("A task with checks: [{name:'typecheck', command:'...', kind:'typecheck'}] records both checks and is red when only the typecheck fails", async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const created = await ws.createTask({ ...newTask, testCommand: GREEN });
    const task = await ws.writeTask(created.id, { checks: [{ name: 'typecheck', command: 'exit 1', kind: 'typecheck' }] });
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    const v = await new DaemonVerifier(ws).verify(task, 'r1', path);
    expect(v.status).toBe('red');
    expect(v.passed).toBe(2);
    expect(v.failed).toBe(0);
    expect(v.checks).toHaveLength(2);
    expect(v.checks?.[0]).toMatchObject({ name: 'tests', kind: 'test', exitCode: 0, passed: 2, failed: 0, status: 'green' });
    expect(v.checks?.[1]).toMatchObject({ name: 'typecheck', kind: 'typecheck', exitCode: 1, status: 'red' });
    expect(v.checks?.[1]?.durationMs).toBeGreaterThanOrEqual(0);
    const ran = (await ws.events(task.id).read()).find((e) => e.type === 'verification.ran');
    expect(ran?.payload.status).toBe('red');
    expect(ran?.payload.checks).toEqual(v.checks);
    // nothing was locked, so there is no tamper result to report
    expect(ran?.payload).not.toHaveProperty('tamper');
    expect(ran?.payload.scenarios).toBeNull();
  });
}, 120_000);

test('config.verify.checks run when the task names none, and the record is green only when every check is green', async () => {
  await withFixtureRepo(async (repo) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.verify = { checks: [{ name: 'lint', command: 'true', kind: 'lint' }], tamper: 'fail' };
    mkdirSync(join(repo, '.stint'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    const ws = await Workspace.open(repo);
    const task = await ws.createTask({ ...newTask, testCommand: GREEN });
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    const v = await new DaemonVerifier(ws).verify(task, 'r1', path);
    expect(v.status).toBe('green');
    expect(v.checks?.map((c) => c.name)).toEqual(['tests', 'lint']);
    expect(v.tamper).toBeUndefined();
    expect(v.scenarios).toBeNull();
    expect(v.coverage).toBeNull();
  });
}, 120_000);

test('task.checks win over config.verify.checks', async () => {
  await withFixtureRepo(async (repo) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.verify = { checks: [{ name: 'lint', command: 'exit 1', kind: 'lint' }], tamper: 'fail' };
    mkdirSync(join(repo, '.stint'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    const ws = await Workspace.open(repo);
    const created = await ws.createTask({ ...newTask, testCommand: GREEN });
    const task = await ws.writeTask(created.id, { checks: [] });
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    const v = await new DaemonVerifier(ws).verify(task, 'r1', path);
    expect(v.status).toBe('green');
    expect(v.checks?.map((c) => c.name)).toEqual(['tests']);
  });
}, 120_000);
