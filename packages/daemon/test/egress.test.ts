import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@stint-dev/core';
import type { Adapter, RunResult } from '../src/index';
import { EgressProxy, defaultAllow, hostAllowed } from '../src/egress';
import { fakeAdapter, makeApp, post, withFixtureRepo } from './helpers';

test('hostAllowed matches exact names and *.domain wildcards, and nothing else', () => {
  const allow = ['api.llama.com', '*.fireworks.ai', 'localhost'];
  expect(hostAllowed('api.llama.com', allow)).toBe(true);
  expect(hostAllowed('API.LLAMA.COM.', allow)).toBe(true);
  expect(hostAllowed('fireworks.ai', allow)).toBe(true);
  expect(hostAllowed('api.fireworks.ai', allow)).toBe(true);
  expect(hostAllowed('evilfireworks.ai', allow)).toBe(false);
  expect(hostAllowed('api.llama.com.evil.io', allow)).toBe(false);
  expect(hostAllowed('127.0.0.1', allow)).toBe(false);
  expect(defaultAllow({ a: { baseURL: 'https://api.llama.com/compat/v1' }, b: { baseURL: 'not a url' }, c: undefined })).toEqual(['registry.npmjs.org', 'api.llama.com']);
});

test('CONNECT to an allowed host is tunnelled, and a kept-alive plain request cannot reach a second host', async () => {
  const echo = createServer((s) => s.on('data', (d) => s.write(d)));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
  const echoPort = (echo.address() as { port: number }).port;
  const blocked: string[] = [];
  const proxy = new EgressProxy(() => ['localhost'], (b) => blocked.push(`${b.method} ${b.host}`));
  const port = await proxy.start();
  try {
    const reply = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () => s.write(`CONNECT localhost:${echoPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`));
      let got = '';
      s.on('data', (d) => {
        got += d.toString();
        if (got.includes('\r\n\r\n') && !got.includes('ping')) s.write('ping');
        if (got.endsWith('ping')) {
          s.destroy();
          resolve(got);
        }
      });
    });
    expect(reply).toStartWith('HTTP/1.1 200 Connection Established');
    expect(reply).toEndWith('ping');
    const refused = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () => s.write('CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n'));
      let got = '';
      s.on('data', (d) => (got += d.toString()));
      s.on('close', () => resolve(got));
    });
    expect(refused).toStartWith('HTTP/1.1 403 Forbidden');
    expect(blocked).toEqual(['CONNECT 10.0.0.1']);
  } finally {
    await proxy.stop();
    echo.close();
  }
});

test("A process in a run's environment can reach an allowed host through the proxy and is refused for another, with the event recorded", async () => {
  const site = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('hello from an allowed host') });
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.sandbox = { kind: 'none', egress: { mode: 'proxy', allow: ['localhost'] } };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      let out = '';
      // the agent is a process started with the run's environment, asking for two hosts through the proxy it was given
      const agent: Adapter = {
        ...fakeAdapter('edit'),
        async run(ctx): Promise<RunResult> {
          const script = `const p = process.env.HTTP_PROXY; const a = await fetch('http://localhost:${site.port}/', { proxy: p }); const b = await fetch('http://blocked.example/', { proxy: p }); console.log(a.status, await a.text(), '|', b.status);`;
          const child = Bun.spawn(['bun', '-e', script], { cwd: ctx.worktree, env: ctx.env, stdout: 'pipe', stderr: 'pipe' });
          out = await new Response(child.stdout).text();
          await child.exited;
          return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
        },
      };
      const { app, ws } = await makeApp(repo, [agent]);
      const t = await ws.createTask({ title: 'Reach the network', goal: 'Fetch two hosts.', acceptance: ['one allowed'], testCommand: 'true' });
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      let events = await ws.events(t.id).read();
      for (let i = 0; i < 400 && !events.some((e) => e.type === 'verification.ran'); i++) {
        await Bun.sleep(50);
        events = await ws.events(t.id).read();
      }
      expect(out.trim()).toBe('200 hello from an allowed host | 403');
      const blocked = events.find((e) => e.type === 'rule.blocked');
      expect(blocked?.run).toBe('r1');
      expect(blocked?.payload).toMatchObject({ by: 'egress', host: 'blocked.example', port: 80, reason: 'blocked.example is not in sandbox.egress.allow' });
      const run = events.find((e) => e.type === 'run.started');
      expect(run?.payload.role).toBe('implementer');
      const health = (await (await app.request('/api/health')).json()) as { sandbox: { kind: string; egress: { mode: string; enforced: boolean; allow: string[] } } };
      expect(health.sandbox.egress).toMatchObject({ mode: 'proxy', enforced: false });
      expect(health.sandbox.egress.allow).toContain('localhost');
    });
  } finally {
    site.stop(true);
  }
}, 60_000);
