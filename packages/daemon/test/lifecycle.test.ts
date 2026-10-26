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
