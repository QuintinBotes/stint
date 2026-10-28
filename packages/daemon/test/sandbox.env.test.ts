import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { daemonContext } from '../src/app';
import type { Adapter, RunResult } from '../src/index';
import { runEnv } from '../src/env';
import { sandboxArgv, sandboxProfile } from '../src/sandbox';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

beforeAll(() => {
  process.env.STINT_TEST_API_KEY = 'k-1';
  process.env.STINT_TEST_TOKEN = 't-1';
});
afterAll(() => {
  delete process.env.STINT_TEST_API_KEY;
  delete process.env.STINT_TEST_TOKEN;
});

test('An agent\'s environment has no API keys unless its manifest names them', async () => {
  await withFixtureRepo(async (repo) => {
    const seen: Array<Record<string, string>> = [];
    const agent = (id: string, needsEnv?: string[]): Adapter => ({
      ...fakeAdapter('edit'),
      id,
      ...(needsEnv ? { needsEnv } : {}),
      async run(ctx): Promise<RunResult> {
        seen.push(ctx.env);
        return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
      },
    });
    const { app, ws } = await makeApp(repo, [agent('plain'), agent('named', ['STINT_TEST_TOKEN'])]);
    // the daemon's own test run sees no keys either
    const t = await ws.createTask({ title: 'Keys stay home', goal: 'Run without keys.', acceptance: ['no keys'], testCommand: 'test -z "$STINT_TEST_API_KEY" && test -z "$STINT_TEST_TOKEN"' });
    const ctx = daemonContext(app);
    for (const [n, adapter] of ['plain', 'named'].entries()) {
      await post(app, `/api/tasks/${t.id}/assign`, { adapter, role: 'implementer' });
      // the run is over once it is verified and the daemon has let go of it
      for (let i = 0; i < 600 && (ctx.runs.get(t.id) || (await ws.events(t.id).read()).filter((e) => e.type === 'verification.ran').length <= n); i++) await Bun.sleep(50);
    }
    expect(seen).toHaveLength(2);
    expect(seen[0]?.STINT_TEST_API_KEY).toBeUndefined();
    expect(seen[0]?.STINT_TEST_TOKEN).toBeUndefined();
    expect(seen[1]?.STINT_TEST_API_KEY).toBeUndefined();
    expect(seen[1]?.STINT_TEST_TOKEN).toBe('t-1');
    const verifications = (await ws.events(t.id).read()).filter((e) => e.type === 'verification.ran');
    expect(verifications.map((e) => e.payload.status)).toEqual(['green', 'green']);
  });
}, 60_000);

test('runEnv keeps credentials only for the person\'s terminal, and sets the proxy for every client', () => {
  const base = { PATH: '/bin', OPENAI_API_KEY: 'x', GH_TOKEN: 'y', DB_PASSWORD: 'z', AWS_SECRET: 'w', API_KEY: 'v', MONKEY: 'kept', MUSE_SESSION: 's' };
  const env = runEnv('T-0001', 'r1', '/wt', { base, proxy: 'http://T-0001:r1@127.0.0.1:9' });
  expect(Object.keys(env).sort()).toEqual(['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'MONKEY', 'NODE_USE_ENV_PROXY', 'NO_PROXY', 'PATH', 'STINT_RUN', 'STINT_TASK', 'STINT_WORKTREE', 'TERM_PROGRAM', 'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy']);
  expect(env.HTTPS_PROXY).toBe('http://T-0001:r1@127.0.0.1:9');
  expect(runEnv('T-0001', 'r1', '/wt', { base, credentials: true }).GH_TOKEN).toBe('y');
});

test('The docker sandbox mounts only the worktree and git data (hooks and config read-only), passes env by name, and uses the internal network with egress on', () => {
  const argv = sandboxArgv(['muse', 'exec'], { kind: 'docker', worktree: '/repo/.stint/worktrees/T-0001-r1', root: '/repo', ports: [], envNames: ['STINT_TASK', 'HTTPS_PROXY'], dockerProxy: 'stint-egress-proxy:3128', image: 'stint-agent:1', name: 'stint-t-0001-r1' });
  expect(argv.slice(0, 5)).toEqual(['docker', 'run', '--rm', '-i', '--init']);
  const pairs = (flag: string) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
  expect(pairs('-v')).toEqual(['/repo/.stint/worktrees/T-0001-r1:/repo/.stint/worktrees/T-0001-r1', '/repo/.git:/repo/.git', '/repo/.git/hooks:/repo/.git/hooks:ro', '/repo/.git/config:/repo/.git/config:ro']);
  expect(pairs('--network')).toEqual(['stint-egress']);
  expect(pairs('-e')).toEqual(['STINT_TASK', 'HTTPS_PROXY']);
  expect(argv.slice(-3)).toEqual(['stint-agent:1', 'muse', 'exec']);
  expect(argv.join(' ')).not.toContain('=');
  expect(sandboxArgv(['x'], { kind: 'none', worktree: '/w', root: '/r', ports: [] })).toEqual(['x']);
});

test.skipIf(process.platform !== 'darwin')('Under sandbox-exec a run writes its worktree but not outside it, and reaches only the loopback ports it was given', async () => {
  const probe = join(homedir(), `.stint-sandbox-probe-${process.pid}`);
  const allowed = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('allowed') });
  const other = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('reached') });
  try {
    await withFixtureRepo(async (repo) => {
      const script = [`echo in > ${repo}/inside.txt; echo w1=$?`, `echo out > ${probe}; echo w2=$?`, `curl -s --noproxy '*' --max-time 3 http://127.0.0.1:${allowed.port}/; echo c1=$?`, `curl -s --noproxy '*' --max-time 3 http://127.0.0.1:${other.port}/; echo c2=$?`].join('; ');
      expect(sandboxProfile({ kind: 'sandbox-exec', worktree: repo, root: repo, ports: [allowed.port as number] })).toContain('(deny network-outbound)');
      const p = Bun.spawn(sandboxArgv(['/bin/sh', '-c', script], { kind: 'sandbox-exec', worktree: repo, root: repo, ports: [allowed.port as number] }), { stdout: 'pipe', stderr: 'pipe' });
      const out = await new Response(p.stdout).text();
      await p.exited;
      expect(out).toContain('w1=0');
      expect(out).toMatch(/w2=[1-9]/);
      expect(out).toContain('allowedc1=0');
      expect(out).toMatch(/c2=[1-9]/);
      expect(existsSync(probe)).toBe(false);
    });
  } finally {
    rmSync(probe, { force: true });
    allowed.stop(true);
    other.stop(true);
  }
}, 30_000);

const dockerReady = (() => {
  if (!Bun.which('docker')) return false;
  const info = Bun.spawnSync(['docker', 'image', 'inspect', 'node:22'], { stdout: 'ignore', stderr: 'ignore' });
  return info.exitCode === 0;
})();

test.skipIf(!dockerReady)('In the docker sandbox an agent has no direct route out, reaches allowed hosts through the sidecar, and its refusals land on its run', async () => {
  await withFixtureRepo(async (repo) => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { DEFAULT_CONFIG } = await import('@stint-dev/core');
    const config = structuredClone(DEFAULT_CONFIG);
    config.sandbox = { kind: 'docker', image: 'node:22', egress: { mode: 'proxy', allow: ['registry.npmjs.org'] } };
    mkdirSync(join(repo, '.stint'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    let out = '';
    const agent: Adapter = {
      ...fakeAdapter('edit'),
      async run(ctx): Promise<RunResult> {
        const script = `curl -s --noproxy '*' --max-time 5 -o /dev/null https://example.com; echo direct=$?; curl -s --noproxy '' --max-time 10 -o /dev/null -w 'allowed=%{http_code} ' https://registry.npmjs.org/; curl -s --noproxy '' --max-time 5 -o /dev/null -w 'denied=%{http_code} ' http://blocked.example/; echo built > src/lib/limiter.ts; echo w=$?`;
        const argv = ctx.wrap?.(['sh', '-c', script]) ?? [];
        const child = Bun.spawn(argv, { cwd: ctx.worktree, env: ctx.env, stdout: 'pipe', stderr: 'pipe' });
        out = await new Response(child.stdout).text();
        await child.exited;
        return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [agent]);
    const t = await ws.createTask({ title: 'Reach out from a container', goal: 'Fetch two hosts.', acceptance: ['one allowed'], testCommand: 'true' });
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const ctx = daemonContext(app);
    for (let i = 0; i < 1200 && (ctx.runs.get(t.id) || !(await ws.events(t.id).read()).some((e) => e.type === 'verification.ran')); i++) await Bun.sleep(50);
    expect(out).toMatch(/direct=[1-9]/);
    expect(out).toContain('allowed=200');
    expect(out).toContain('denied=403');
    expect(out).toContain('w=0');
    const blocked = (await ws.events(t.id).read()).filter((e) => e.type === 'rule.blocked');
    expect(blocked.map((e) => [e.run, e.payload.by, e.payload.host])).toEqual([['r1', 'egress', 'blocked.example']]);
  });
}, 120_000);
