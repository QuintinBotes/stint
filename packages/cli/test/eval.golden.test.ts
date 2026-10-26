import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { tempDir } from '../../core/test/fixture';
import { fakeAdapter, withFixtureRepo } from '../../daemon/test/helpers';
import { freshFixture } from '../src/demo';
import { runGoldenLive } from '../src/eval/live';
import { type GoldenResults, loadGoldenTasks } from '../src/eval/results';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const fixtures = join(import.meta.dir, 'fixtures', 'golden-runs');
const repoRootPath = join(import.meta.dir, '..', '..', '..');

test('stint eval --golden --k 3 --replay on recorded golden runs reports pass@1 and pass^3 correctly', async () => {
  const tmp = tempDir('stint-golden-');
  try {
    const r = Bun.spawnSync(['bun', bin, 'eval', '--golden', '--k', '3', '--replay', '--from', fixtures, '--out', tmp.dir, '--json'], { cwd: repoRootPath, stdout: 'pipe', stderr: 'pipe' });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const results = JSON.parse(r.stdout.toString()) as GoldenResults;
    expect(results.version).toBe('stint.golden/1');
    expect(results.replay).toBe(true);
    expect(results.synthetic).toBe(true);
    expect(results.k).toBe(3);
    // 8 of 9 tries pass; 2 of 3 tasks pass every try
    expect(results.passAt1).toBe(0.8889);
    expect(results.passPowK).toBe(0.6667);
    expect(results.tasks).toHaveLength(3);
    expect(results.tasks.find((t) => t.name === 'bench-01-rate-limit')).toMatchObject({ passedRuns: 3, passAll: true });
    expect(results.tasks.find((t) => t.name === 'bench-02-get-event')).toMatchObject({ passedRuns: 2, passAll: false });
    expect(results.cost.usd).toBe(0.135);
    expect(existsSync(join(tmp.dir, 'golden-results.json'))).toBe(true);
  } finally {
    tmp.cleanup();
  }
});

test('bench/golden holds three golden tasks taken from the fixture bench tasks', async () => {
  const tasks = await loadGoldenTasks(join(repoRootPath, 'bench', 'golden'));
  expect(tasks.map((t) => t.name)).toEqual(['bench-01-rate-limit', 'bench-02-get-event', 'bench-03-delete-tenant']);
  for (const t of tasks) {
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.acceptance.length).toBeGreaterThan(0);
    expect(t.testCommand).toBe('bun run test');
    expect(t.fixtureCommit).toMatch(/^[0-9a-f]{40}$/);
  }
});

test('stint eval add-golden turns a rejected task into a golden task and refuses a task that never failed', async () => {
  await withFixtureRepo(async (repo) => {
    const ws = await Workspace.open(repo);
    const rejected = await ws.createTask({ title: 'Cache the tenant list', goal: 'Serve tenants from a cache.', acceptance: ['stale reads never happen'], testCommand: 'bun run test' });
    await ws.events(rejected.id).append({ task: rejected.id, vendor: 'human', type: 'approval.rejected', payload: { reason: 'The cache serves deleted tenants' } });
    const fine = await ws.createTask({ title: 'Rename a helper', goal: 'Call it what it does.', acceptance: ['the suite stays green'], testCommand: 'bun run test' });

    const ok = Bun.spawnSync(['bun', bin, 'eval', 'add-golden', rejected.id, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
    expect(ok.exitCode, ok.stderr.toString()).toBe(0);
    const path = join(repo, 'bench', 'golden', `${rejected.id.toLowerCase()}-cache-the-tenant-list.json`);
    expect(existsSync(path)).toBe(true);
    const golden = JSON.parse(readFileSync(path, 'utf8')) as { title: string; goal: string; acceptance: string[]; testCommand: string; fixtureCommit: string };
    expect(golden.title).toBe('Cache the tenant list');
    expect(golden.fixtureCommit).toBe(rejected.baseCommit);

    const refused = Bun.spawnSync(['bun', bin, 'eval', 'add-golden', fine.id, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain('neither rejected nor reverted');
  });
}, 120_000);

test('the live golden eval grades by the daemon verification plus scenarios, k times on fresh fixtures', async () => {
  const out = tempDir('stint-golden-live-');
  try {
    const rows = await runGoldenLive({
      tasks: [
        {
          name: 'fake-limiter',
          title: 'Add the limiter constant',
          goal: 'Write src/lib/limiter.ts.',
          acceptance: ['the limiter file exists'],
          testCommand: 'true',
          scenarios: [{ name: 'limiter file written', command: 'test -f src/lib/limiter.ts' }],
        },
      ],
      k: 2,
      implementer: 'fake',
      outRunsDir: join(out.dir, 'golden-runs'),
      adapters: () => [fakeAdapter('edit')],
      makeFixture: () => freshFixture(),
      synthetic: true,
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ verified: true, passed: true, synthetic: true });
      expect(row.scenarios).toEqual([{ name: 'limiter file written', passed: true }]);
    }
    expect(existsSync(join(out.dir, 'golden-runs', 'fake-limiter-r1', 'row.json'))).toBe(true);
    expect(existsSync(join(out.dir, 'golden-runs', 'fake-limiter-r2', 'row.json'))).toBe(true);
    const log = readFileSync(join(out.dir, 'golden-runs', 'fake-limiter-r1', 'events.jsonl'), 'utf8');
    expect(log).toContain('"type":"eval.ran"');
    expect(log).toContain('"type":"scenario.ran"');
  } finally {
    out.cleanup();
  }
}, 180_000);
