import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, '..', 'install-cli.sh');
const run = (dir: string, ...args: string[]) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'STINT_BIN_DIR') env[k] = v;
  return Bun.spawnSync(['bash', script, '--dir', dir, ...args], { stdout: 'pipe', stderr: 'pipe', env });
};

test('R-059 Acceptance 6: install-cli.sh --dir <tmp> writes the shim, a second run changes nothing, the shim runs stint --help, and --uninstall removes it; a file at that path that the script did not write is left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stint-bin-'));
  const shim = join(dir, 'stint');

  const first = run(dir);
  expect(first.exitCode).toBe(0);
  expect(existsSync(shim)).toBe(true);
  expect(statSync(shim).mode & 0o111).not.toBe(0);
  const written = readFileSync(shim, 'utf8');
  const mtime = statSync(shim).mtimeMs;
  // not on PATH, so it says how to add it
  expect(first.stdout.toString()).toContain(`export PATH="${dir}:$PATH"`);

  const second = run(dir);
  expect(second.exitCode).toBe(0);
  expect(second.stdout.toString()).toContain('already installed');
  expect(readFileSync(shim, 'utf8')).toBe(written);
  expect(statSync(shim).mtimeMs).toBe(mtime);

  const help = Bun.spawnSync([shim, '--help'], { stdout: 'pipe', stderr: 'pipe' });
  expect(help.exitCode).toBe(0);
  expect(`${help.stdout}${help.stderr}`).toContain('The task outlives the agent.');

  expect(run(dir, '--uninstall').exitCode).toBe(0);
  expect(existsSync(shim)).toBe(false);

  // someone else's stint is never overwritten or removed
  writeFileSync(shim, '#!/bin/sh\necho mine\n', { mode: 0o755 });
  const refused = run(dir);
  expect(refused.exitCode).toBe(1);
  expect(refused.stderr.toString()).toContain('did not write it');
  expect(run(dir, '--uninstall').stdout.toString()).toContain('Left');
  expect(readFileSync(shim, 'utf8')).toBe('#!/bin/sh\necho mine\n');
});
