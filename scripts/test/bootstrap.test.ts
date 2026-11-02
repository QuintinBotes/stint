import { expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(import.meta.dir, '..', 'bootstrap.sh');

test('R-069 Acceptance 2: bootstrap --check-only with Ollama and no Glimmer prints the opt-in line and starts no download', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stint-bootstrap-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'ollama.log');
  Bun.spawnSync(['mkdir', '-p', bin]);
  // an Ollama with no models pulled, which writes down every command it is given
  writeFileSync(join(bin, 'ollama'), `#!/bin/sh\necho "$*" >> "${log}"\n[ "$1" = list ] && echo "NAME ID SIZE MODIFIED"\nexit 0\n`, { mode: 0o755 });
  const tools = [bin, dirname(process.execPath), dirname(Bun.which('git') ?? '/usr/bin/git'), '/usr/bin', '/bin'];
  const r = Bun.spawnSync(['bash', script, '--check-only'], { stdout: 'pipe', stderr: 'pipe', env: { PATH: tools.join(':'), HOME: dir, XDG_CONFIG_HOME: join(dir, '.config') } });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain(
    'ollama: muse-glimmer:30b-mlx is not pulled. Only the offline review needs it: about 19 GB to download, and 32 GB of memory is comfortable. To get it: bash scripts/bootstrap.sh --with-glimmer',
  );
  expect(existsSync(log)).toBe(true);
  expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['list']);
});

test('bootstrap --check-only calls the Stint agent available when Ollama answers and no key is set, as the daemon does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stint-bootstrap-'));
  // a copy away from the checkout, so no .env there can set a key
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(script, join(dir, 'scripts', 'bootstrap.sh'));
  let ollama: ReturnType<typeof Bun.serve> | null = null;
  try {
    ollama = Bun.serve({ hostname: '127.0.0.1', port: 11434, fetch: () => Response.json({ version: '0.32.8' }) });
  } catch {
    // Ollama itself listens on this machine
  }
  try {
    const tools = [dirname(process.execPath), dirname(Bun.which('git') ?? '/usr/bin/git'), '/usr/bin', '/bin'];
    // async, not spawnSync: the Ollama stand-in answers from this process
    const p = Bun.spawn(['bash', join(dir, 'scripts', 'bootstrap.sh'), '--check-only'], { stdout: 'pipe', stderr: 'pipe', env: { PATH: tools.join(':'), HOME: dir, XDG_CONFIG_HOME: join(dir, '.config') } });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(code).toBe(0);
    expect(out).toContain('  stint-agent    available: ollama/muse-glimmer:30b-mlx first (Ollama answers at localhost:11434)');
  } finally {
    ollama?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
