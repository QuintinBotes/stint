import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { tempDir } from '../../core/test/fixture';
import type { BenchResults } from '../src/bench/results';

const live = process.env.STINT_LIVE === '1';
const bin = join(import.meta.dir, '..', 'bin', 'stint');

test.skipIf(!live)('With STINT_LIVE=1, three tasks run live end to end and verified is reported per row', async () => {
  const tmp = tempDir('stint-bench-live-');
  try {
    const proc = Bun.spawn(['bun', bin, 'bench', '--tasks', '3', '--modes', 'transcript,packet', '--out', tmp.dir, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode, stderr).toBe(0);
    const results = JSON.parse(stdout) as BenchResults;
    expect(results.version).toBe('stint.bench/1');
    expect(results.replay).toBe(false);
    expect(results.rows).toHaveLength(6);
    for (const row of results.rows) {
      expect(typeof row.verified).toBe('boolean');
      expect(row.promptTokens).toBeGreaterThan(0);
      expect(row.inputTokens).toBeGreaterThan(0);
    }
    expect(results.byMode.transcript?.runs).toBe(3);
    expect(results.byMode.packet?.runs).toBe(3);
  } finally {
    tmp.cleanup();
  }
}, 45 * 60_000);

test.skipIf(live)('bench.live.test.ts skips without STINT_LIVE=1 (it needs Muse Code and a model host); its replay twin runs in CI', () => {
  expect(live).toBe(false);
});
