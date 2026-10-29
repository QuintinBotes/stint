import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withReplay } from './replay';

const stint = (repo: string, ...args: string[]) => {
  const p = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

const D = [
  'decision D1 (T-0042) Count requests per tenant, not per source IP files: src/app.ts',
  'decision D2 (T-0042) Answer 429 with a Retry-After header, never 503 files: src/app.ts',
  'decision D3 (T-0042) Sliding window over fixed window, so a burst at a window edge cannot double the limit files: src/app.ts',
];

test('stint graph similar, files-together and constrains --as-of answer from the replayed fixture, with no daemon running', async () => {
  await withReplay(async (root) => {
    expect(stint(root, 'graph', 'similar', 'T-0042')).toEqual({ code: 0, stderr: '', stdout: 'T-0040 score 15 themes: hard-coded, limit, loadconfig, read, tenant\nT-0043 score 3 files: src/app.ts; tags: limits\n' });
    expect(JSON.parse(stint(root, 'graph', 'similar', 'T-0043', '--json').stdout).map((r: { task: string; score: number }) => [r.task, r.score])).toEqual([['T-0042', 3]]);
    expect(stint(root, 'graph', 'files-together', 'src/lib/limiter.ts').stdout).toBe('src/app.ts 1\nsrc/routes/webhooks.ts 1\ntest/limiter.test.ts 1\n');
    expect(stint(root, 'graph', 'files-together', 'nothing/here.ts').stdout).toBe('No file changed in the same run as nothing/here.ts.\n');
    // T-0042's decisions bind T-0043 through src/app.ts once they were made, and not before
    expect(stint(root, 'graph', 'constrains', 'T-0043').stdout).toBe(`${D.join('\n')}\n`);
    expect(stint(root, 'graph', 'constrains', 'T-0043', '--as-of', '2999-01-01T00:00:00Z').stdout).toBe(`${D.join('\n')}\n`);
    expect(stint(root, 'graph', 'constrains', 'T-0043', '--as-of', '2026-01-01T00:00:00Z').stdout).toBe('Nothing constrains T-0043 at 2026-01-01T00:00:00Z.\n');
    expect(stint(root, 'graph', 'constrains', 'T-0043', '--as-of', 'yesterday')).toEqual({ code: 2, stdout: '', stderr: '--as-of is not a time: yesterday\n' });
    expect(stint(root, 'graph', 'similar', 'T-0099')).toMatchObject({ code: 1, stderr: 'no task T-0099\n' });
  });
}, 120_000);
