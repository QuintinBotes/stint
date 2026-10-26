import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tempDir } from '../../core/test/fixture';

test('With the daemon stopped, stint hook PreCompact exits 0 and prints the NOT-drafted line to stderr', () => {
  const tmp = tempDir();
  try {
    const worktree = join(tmp.dir, '.stint', 'worktrees', 'T-0001-r1');
    const r = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'bin', 'stint'), 'hook', 'PreCompact'], {
      env: { ...process.env, STINT_TASK: 'T-0001', STINT_RUN: 'r1', STINT_WORKTREE: worktree },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe('');
    expect(r.stderr.toString()).toMatch(/^Stint hook: could not reach the daemon at .+\. The packet was NOT drafted\.\n$/);
  } finally {
    tmp.cleanup();
  }
});

test('outside a Stint run the hook does nothing and exits 0', () => {
  const env = { ...process.env };
  delete env.STINT_TASK;
  const r = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'bin', 'stint'), 'hook', 'PreCompact'], { env, stdout: 'pipe', stderr: 'pipe' });
  expect(r.exitCode).toBe(0);
  expect(r.stderr.toString()).toBe('');
});
