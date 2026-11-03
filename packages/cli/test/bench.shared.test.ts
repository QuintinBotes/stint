import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, RunContext, RunResult } from '@stint-dev/daemon';
import { FIXTURE_BUNDLE, tempDir } from '../../core/test/fixture';
import { runBenchLive } from '../src/bench/live';
import type { BenchTaskDef } from '../src/bench/results';

const task: BenchTaskDef = {
  id: 'shared-limiter',
  title: 'Rate-limit incoming webhooks',
  goal: 'Answer 429 when a tenant is over the limit.',
  acceptance: ['429 with Retry-After'],
  testCommand: 'bun run test',
  killAfterSteps: 2,
};

// Passes only on a branch where the continuer wrote src/lib/next.ts, which it does only when handed the diff.
const holdout = `import { expect, it } from 'vitest';
import { LIMIT } from '../src/lib/limiter';
import { DONE } from '../src/lib/next';
it('finished from the diff', () => expect([LIMIT, DONE]).toEqual([60, true]));
`;

function fake(id: string, run: (ctx: RunContext) => Promise<RunResult>): Adapter {
  return {
    id,
    vendor: 'local',
    roles: ['implementer'],
    capabilities: { editsFiles: true, runsCommands: false, resumable: false, structuredOutput: false, offline: true },
    available: async () => ({ ok: true, version: 'fake 1' }),
    gate: () => 'none',
    run,
  };
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-demo-'));
  Bun.spawnSync(['git', 'clone', '-q', FIXTURE_BUNDLE, dir]);
  for (const [k, v] of [['user.name', 'Stint Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) Bun.spawnSync(['git', '-C', dir, 'config', k as string, v as string]);
  return dir;
}

test('the bench runs one capped first run per task and continues every mode from it; diff mode carries only the task and the diff; held-out tests grade each run', async () => {
  const out = tempDir('stint-bench-out-');
  const firstRuns: string[] = [];
  const prompts: string[] = [];
  const adapters = () => [
    fake('first', async (ctx) => {
      firstRuns.push(ctx.run);
      await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
      await ctx.emit({ type: 'agent.message', payload: { text: 'Half the limiter is written.' } });
      return { endedBy: 'capped', cost: { inputTokens: 100, cachedTokens: 0, outputTokens: 10, usd: 0.001 } };
    }),
    fake('next', async (ctx) => {
      prompts.push(ctx.prompt);
      if (ctx.prompt.includes('## Diff of the previous run')) await Bun.write(`${ctx.worktree}/src/lib/next.ts`, 'export const DONE = true;\n');
      return { endedBy: 'completed', cost: { inputTokens: 50, cachedTokens: 0, outputTokens: 5, usd: 0.0005 } };
    }),
  ];
  try {
    const results = await runBenchLive({
      tasks: [task],
      modes: ['transcript', 'packet', 'diff'],
      implementer: 'first',
      continuer: 'next',
      repeat: 1,
      concurrency: 3,
      outDir: out.dir,
      synthetic: true,
      adapters,
      makeFixture: fixture,
      scenarios: { 'shared-limiter': [{ name: 'test/holdout-next.test.ts', content: holdout }] },
    });

    expect(firstRuns).toEqual(['r1']);
    expect(prompts).toHaveLength(3);
    const byHeading = (h: string) => prompts.filter((p) => p.includes(h));
    expect(byHeading('## Packet from the previous run')).toHaveLength(1);
    const [diffPrompt] = byHeading('## Diff of the previous run');
    expect(diffPrompt).toContain('+export const LIMIT = 60;');
    expect(diffPrompt).toContain(task.goal);
    expect(diffPrompt).not.toContain('## Packet from the previous run');
    expect(diffPrompt).not.toContain('## Transcript of the previous run');
    expect(diffPrompt).not.toContain('Half the limiter is written');

    // every mode continued from the same packet, which names the one first run's commit
    const packets = ['transcript', 'packet', 'diff'].map((m) => JSON.parse(readFileSync(join(out.dir, 'runs', `shared-limiter-${m}`, 'handoff.json'), 'utf8')) as { hash: string; diffRef: { head: string } });
    expect(new Set(packets.map((p) => p.hash)).size).toBe(1);
    expect(packets[0]?.diffRef.head).toMatch(/^[0-9a-f]{40}$/);
    for (const m of ['transcript', 'packet', 'diff']) {
      const folder = join(out.dir, 'runs', `shared-limiter-${m}`);
      expect(readFileSync(join(folder, 'events.jsonl'), 'utf8')).toContain('"scenario.ran"');
      expect(readFileSync(join(folder, 'diff.patch'), 'utf8')).toContain('+export const LIMIT = 60;');
    }

    const hidden = Object.fromEntries(results.rows.map((r) => [r.mode, r.hidden]));
    expect(hidden).toEqual({ transcript: 'red', packet: 'red', diff: 'green' });
    expect(results.rows.find((r) => r.mode === 'diff')?.scenarios).toEqual({ passed: 1, failed: 0 });
    // the daemon's verdict and the held-out tests are named apart
    expect(Object.fromEntries(results.rows.map((r) => [r.mode, r.result]))).toEqual({
      transcript: "the daemon's verdict green; held-out tests passed 0 of 1",
      packet: "the daemon's verdict green; held-out tests passed 0 of 1",
      diff: "the daemon's verdict green; held-out tests passed 1 of 1",
    });
    expect(results.byMode.diff).toMatchObject({ runs: 1, hiddenPassRate: 1, hiddenGraded: 1 });
    expect(results.byMode.packet).toMatchObject({ runs: 1, passRate: 1, hiddenPassRate: 0, hiddenGraded: 1 });
  } finally {
    out.cleanup();
  }
}, 180_000);
