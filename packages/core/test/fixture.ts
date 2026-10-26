import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FIXTURE_BUNDLE = join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle');

/** Clones the demo fixture (F-001) into a temp dir, runs `fn` in it and removes it. Tests never touch the checkout. */
export async function withFixtureRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'stint-fixture-'));
  try {
    const clone = Bun.spawnSync(['git', 'clone', '-q', FIXTURE_BUNDLE, dir], { stderr: 'pipe' });
    if (clone.exitCode !== 0) throw new Error(`cannot clone the fixture: ${clone.stderr.toString()}`);
    for (const [k, v] of [['user.name', 'Stint Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) {
      Bun.spawnSync(['git', '-C', dir, 'config', k as string, v as string]);
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function tempDir(prefix = 'stint-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
