import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { daemonContext } from '../src/app';
import { type Adapter, type RunContext, type RunResult, DaemonVerifier, RunRegistry, Worktrees, startDaemon } from '../src/index';
import { runEnv } from '../src/env';
import { sandboxArgv, sandboxProfile } from '../src/sandbox';
import { auth, fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const stint = join(import.meta.dir, '..', '..', 'cli', 'bin', 'stint');

test('the macOS profile denies reading the daemon cache and writing git hooks and config, after the allow rules', () => {
  const p = sandboxProfile({ kind: 'sandbox-exec', worktree: '/repo/.stint/worktrees/T-0001-r1', root: '/repo', ports: [] });
  const lines = p.split('\n');
  const allowWrite = lines.findIndex((l) => l.startsWith('(allow file-write*'));
  const denyRead = lines.findIndex((l) => l === '(deny file-read* (subpath "/repo/.stint/cache"))');
  const denyWrite = lines.findIndex((l) => l === '(deny file-write* (subpath "/repo/.git/hooks") (literal "/repo/.git/config"))');
  expect(lines.indexOf('(allow default)')).toBeLessThan(denyRead);
  expect(denyRead).toBeGreaterThan(-1);
  expect(denyWrite).toBeGreaterThan(allowWrite);
  // a checkout the daemon made under the cache (a branch verification) is still readable, the rest of the cache is not
  const inCache = sandboxProfile({ kind: 'sandbox-exec', worktree: '/repo/.stint/cache/verify/T-0001-1', root: '/repo', ports: [] }).split('\n');
  expect(inCache.indexOf('(allow file-read* (subpath "/repo/.stint/cache/verify/T-0001-1"))')).toBeGreaterThan(inCache.findIndex((l) => l.startsWith('(deny file-read*')));
});

test('the docker sandbox mounts git hooks and config read-only and never the cache', () => {
  const argv = sandboxArgv(['sh'], { kind: 'docker', worktree: '/repo/.stint/worktrees/T-0001-r1', root: '/repo', ports: [] });
  const mounts = argv.flatMap((a, i) => (a === '-v' ? [argv[i + 1] as string] : []));
  expect(mounts).toEqual(['/repo/.stint/worktrees/T-0001-r1:/repo/.stint/worktrees/T-0001-r1', '/repo/.git:/repo/.git', '/repo/.git/hooks:/repo/.git/hooks:ro', '/repo/.git/config:/repo/.git/config:ro']);
  expect(mounts.some((m) => m.includes('.stint/cache'))).toBe(false);
});

test.skipIf(process.platform !== 'darwin')('under sandbox-exec a run cannot read daemon.json or write a git hook, and still writes its worktree', async () => {
  await withFixtureRepo(async (repo) => {
    mkdirSync(join(repo, '.stint', 'cache'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'cache', 'daemon.json'), '{"port":1,"token":"fake-token"}');
    const wt = join(repo, '.stint', 'worktrees', 'T-0001-r1');
    mkdirSync(wt, { recursive: true });
    const script = [`cat ${repo}/.stint/cache/daemon.json; echo r=$?`, `echo x > ${repo}/.git/hooks/post-commit; echo h=$?`, `echo x >> ${repo}/.git/config; echo c=$?`, `echo x > ${wt}/a.txt; echo w=$?`].join('; ');
    const p = Bun.spawn(sandboxArgv(['/bin/sh', '-c', script], { kind: 'sandbox-exec', worktree: wt, root: repo, ports: [] }), { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(p.stdout).text();
    await p.exited;
    expect(out).not.toContain('fake-token');
    expect(out).toMatch(/r=[1-9]/);
    expect(out).toMatch(/h=[1-9]/);
    expect(out).toMatch(/c=[1-9]/);
    expect(out).toContain('w=0');
    expect(existsSync(join(repo, '.git', 'hooks', 'post-commit'))).toBe(false);
  });
}, 30_000);

test('a hook an agent wrote never runs when the daemon commits', async () => {
  await withFixtureRepo(async (repo) => {
    const marker = join(repo, 'hook-ran');
    const hook = join(repo, '.git', 'hooks', 'post-commit');
    writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`);
    chmodSync(hook, 0o755);
    const ws = await Workspace.open(repo);
    const task = await ws.createTask(newTask);
    const wts = new Worktrees(ws, new RunRegistry());
    const { path } = await wts.create(task, 'r1');
    writeFileSync(join(path, 'a.txt'), 'x\n');
    await wts.commit(task, 'r1', path, 'completed');
    expect(existsSync(marker)).toBe(false);
  });
}, 60_000);

test.skipIf(process.platform !== 'darwin')('verify commands run inside the configured sandbox', async () => {
  await withFixtureRepo(async (repo) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.sandbox = { kind: 'sandbox-exec', egress: { mode: 'off', allow: [] } };
    mkdirSync(join(repo, '.stint', 'cache'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    writeFileSync(join(repo, '.stint', 'cache', 'probe.txt'), 'readable\n');
    const { app, ws } = await makeApp(repo, []);
    const verifier = daemonContext(app).verifier as DaemonVerifier;
    const task = await ws.createTask({ ...newTask, testCommand: `cat ${repo}/.stint/cache/probe.txt` });
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    expect((await verifier.verify(task, 'r1', path)).status).toBe('red');
    // with no sandbox the same command reads the file
    expect((await new DaemonVerifier(ws).verify(task, 'r1', path)).status).toBe('green');
  });
}, 60_000);

test('a run strips every configured host key, and a base URL that carries a credential, whatever their names', () => {
  const hosts = { mine: { keyEnv: 'MY_HOST_CRED', baseURLEnv: 'MY_HOST_URL', models: {}, offline: false, structuredOutput: 'enforced' as const, cachedInput: false }, open: { baseURLEnv: 'OPEN_URL', models: {}, offline: false, structuredOutput: 'enforced' as const, cachedInput: false } };
  // a user and password in the URL, written split so it never reads as an address
  const withUser = ['https://user:pass', 'host.example/v1'].join('@');
  const base = { PATH: '/bin', MY_HOST_CRED: 'c', MY_HOST_URL: withUser, OPEN_URL: 'http://localhost:11434/v1' };
  const env = runEnv('T-0001', 'r1', '/wt', { base, hosts });
  expect(env.MY_HOST_CRED).toBeUndefined();
  expect(env.MY_HOST_URL).toBeUndefined();
  expect(runEnv('T-0001', 'r1', '/wt', { base: { MY_HOST_URL: 'https://host.example/v1?api_key=abc' }, hosts }).MY_HOST_URL).toBeUndefined();
  expect(env.OPEN_URL).toBe('http://localhost:11434/v1');
  expect(runEnv('T-0001', 'r1', '/wt', { base, hosts, keep: ['MY_HOST_CRED'] }).MY_HOST_CRED).toBe('c');
});

/** An agent that waits until stopped and keeps its context, so a test can call the daemon as it would. */
function holder(): Adapter & { ctx: () => RunContext | undefined } {
  let seen: RunContext | undefined;
  const sleep = fakeAdapter('sleep');
  return {
    ...sleep,
    ctx: () => seen,
    async run(ctx): Promise<RunResult> {
      seen = ctx;
      return sleep.run(ctx);
    },
  };
}

test('a run token reaches only its own run\'s agent routes, answers 403 elsewhere, and is revoked when the run ends', async () => {
  await withFixtureRepo(async (repo) => {
    const agent = holder();
    const { app, ws } = await makeApp(repo, [agent]);
    const t = await ws.createTask(newTask);
    const other = await ws.createTask({ ...newTask, title: 'Another task' });
    expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).status).toBe(202);
    for (let i = 0; i < 200 && !agent.ctx(); i++) await Bun.sleep(25);
    const token = agent.ctx()?.env.STINT_RUN_TOKEN as string;
    expect(token).toMatch(/^[0-9a-f]{32,}$/);
    expect(token).not.toBe(auth.Authorization.slice(7));
    const as = { Authorization: `Bearer ${token}` };
    const code = async (res: Response) => [res.status, ((await res.json()) as { error?: { code: string } }).error?.code ?? 'ok'];

    expect(await code(await post(app, `/api/tasks/${t.id}/runs/r1/inflight`, { tool: 'bash' }, as))).toEqual([200, 'ok']);
    expect(await code(await post(app, `/api/tasks/${t.id}/decisions`, { text: 'Keep the limiter in memory', by: 'agent r1' }, as))).toEqual([201, 'ok']);
    expect(await code(await post(app, `/api/tasks/${t.id}/runs/r2/inflight`, { tool: 'bash' }, as))).toEqual([403, 'forbidden']);
    expect(await code(await post(app, `/api/tasks/${t.id}/handoff`, { run: 'r2' }, as))).toEqual([403, 'forbidden']);
    expect(await code(await post(app, `/api/tasks/${other.id}/decisions`, { text: 'x' }, as))).toEqual([403, 'forbidden']);
    expect(await code(await post(app, `/api/tasks/${t.id}/approve`, {}, as))).toEqual([403, 'forbidden']);
    expect(await code(await post(app, '/api/skills/import', {}, as))).toEqual([403, 'forbidden']);
    expect(await code(await post(app, '/api/tasks', newTask, as))).toEqual([403, 'forbidden']);

    expect((await post(app, `/api/tasks/${t.id}/runs/r1/stop`, {})).status).toBe(202);
    expect(await code(await post(app, `/api/tasks/${t.id}/runs/r1/inflight`, { tool: 'bash' }, as))).toEqual([401, 'unauthorized']);
  });
}, 60_000);

test('the hook uses the run token and port from its environment when daemon.json cannot be read', async () => {
  await withFixtureRepo(async (repo) => {
    const agent = holder();
    // Muse names the open tool without arguments; the hook adds them
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...agent, id: 'muse-code', run: async (ctx) => ({ ...(await agent.run(ctx)), inFlight: 'write_file' }) }] });
    try {
      const t = await d.ws.createTask(newTask);
      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      for (let i = 0; i < 200 && !agent.ctx(); i++) await Bun.sleep(25);
      const env = agent.ctx()?.env as Record<string, string>;
      expect(env.STINT_DAEMON_PORT).toBe(String(d.port));
      // as inside the sandbox, which denies reading the cache
      renameSync(d.infoPath, `${d.infoPath}.away`);
      const p = Bun.spawn(['bun', stint, 'hook', 'PreToolUse'], { env, stdin: Buffer.from(JSON.stringify({ tool_name: 'write_file', tool_input: { path: 'src/a.ts' } })), stdout: 'pipe', stderr: 'pipe' });
      const [exitCode, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()]);
      renameSync(`${d.infoPath}.away`, d.infoPath);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      await fetch(`${d.url}/api/tasks/${t.id}/runs/r1/stop`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}` } });
      const finished = (await d.ws.events(t.id).read()).find((e) => e.type === 'run.finished');
      expect(finished?.payload.inFlight).toBe('write_file src/a.ts');
    } finally {
      await d.stop();
    }
  });
}, 60_000);
