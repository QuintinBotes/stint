import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './helpers';

test('daemon.json is written with mode 0600 and removed on SIGTERM', async () => {
  const tmp = tempDir();
  try {
    const server = join(import.meta.dir, '..', 'src', 'server.ts');
    const proc = Bun.spawn(['bun', server], { env: { ...process.env, STINT_ROOT: tmp.dir }, stderr: 'pipe', stdout: 'ignore' });
    const info = join(tmp.dir, '.stint', 'cache', 'daemon.json');
    for (let i = 0; i < 100 && !existsSync(info); i++) await Bun.sleep(50);
    expect(existsSync(info)).toBe(true);
    expect(statSync(info).mode & 0o777).toBe(0o600);
    const d = JSON.parse(readFileSync(info, 'utf8')) as { port: number; token: string; pid: number };
    expect(d.pid).toBe(proc.pid);
    expect((await fetch(`http://127.0.0.1:${d.port}/api/health`)).ok).toBe(true);
    proc.kill('SIGTERM');
    await proc.exited;
    expect(existsSync(info)).toBe(false);
    const logs = await new Response(proc.stderr).text();
    expect(logs).toContain('/api/health');
    expect(logs).not.toContain(d.token);
  } finally {
    tmp.cleanup();
  }
});

test('the daemon listens on 127.0.0.1 only: its bound address is the loopback, and another address of this machine is refused', async () => {
  const { networkInterfaces } = await import('node:os');
  const { startDaemon } = await import('../src/index');
  const tmp = tempDir();
  const d = await startDaemon({ root: tmp.dir, quiet: true, adapters: [] });
  try {
    expect(d.hostname).toBe('127.0.0.1');
    expect(d.url).toBe(`http://127.0.0.1:${d.port}`);
    expect((await fetch(`${d.url}/api/health`)).ok).toBe(true);
    // with a wildcard bind this machine's own network address would answer too
    const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
    if (lan) expect(await fetch(`http://${lan}:${d.port}/api/health`, { signal: AbortSignal.timeout(3_000) }).then(() => 'answered', () => 'refused')).toBe('refused');
  } finally {
    await d.stop();
    tmp.cleanup();
  }
}, 30_000);
