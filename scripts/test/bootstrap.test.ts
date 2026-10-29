import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
