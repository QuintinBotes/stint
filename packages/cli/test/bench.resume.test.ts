import { expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countTokens } from '@stint-dev/core';
import type { Adapter, RunContext, RunResult } from '@stint-dev/daemon';
import { FIXTURE_BUNDLE, tempDir } from '../../core/test/fixture';
import { RESUME_INSTRUCTION, runBenchLive } from '../src/bench/live';
import type { BenchTaskDef } from '../src/bench/results';

const task: BenchTaskDef = {
  id: 'resume-limiter',
  title: 'Rate-limit incoming webhooks',
  goal: 'Answer 429 when a tenant is over the limit.',
  acceptance: ['429 with Retry-After'],
  testCommand: 'bun run test',
  killAfterSteps: 2,
};

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-demo-'));
  Bun.spawnSync(['git', 'clone', '-q', FIXTURE_BUNDLE, dir]);
  for (const [k, v] of [['user.name', 'Stint Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) Bun.spawnSync(['git', '-C', dir, 'config', k as string, v as string]);
  return dir;
}

test('resume continues the first run own session, each repeat from the session as the cap left it, with only the instruction', async () => {
  const out = tempDir('stint-bench-out-');
  const store = tempDir('stint-muse-sessions-');
  const sid = '01a19d9b-0000-7000-8000-000000000001';
  const sessionFile = join(store.dir, '2026', '11', '02', sid, 'session.jsonl');
  const seen: Array<{ session: string; sessionId: string; instruction: string; worktree: string; argv: string[] }> = [];
  const first: Adapter = {
    id: 'first',
    vendor: 'meta',
    roles: ['implementer'],
    capabilities: { editsFiles: true, runsCommands: false, resumable: true, structuredOutput: false, offline: true },
    available: async () => ({ ok: true, version: 'fake 1' }),
    gate: () => 'none',
    run: async (ctx: RunContext): Promise<RunResult> => {
      await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
      mkdirSync(join(sessionFile, '..'), { recursive: true });
      writeFileSync(sessionFile, 'turn 0\n');
      return { endedBy: 'capped', cost: { inputTokens: 100, cachedTokens: 0, outputTokens: 10, usd: 0.001 }, sessionId: sid };
    },
    resume: async (ctx): Promise<RunResult> => {
      seen.push({ session: readFileSync(sessionFile, 'utf8'), sessionId: ctx.sessionId, instruction: ctx.instruction, worktree: ctx.worktree, argv: ctx.wrap ? ctx.wrap(['first']) : ['first'] });
      // a resumed turn lands in the session, as Muse Code's does; the next repeat must not see it
      appendFileSync(sessionFile, `resumed in ${ctx.run}\n`);
      await Bun.write(`${ctx.worktree}/src/lib/next.ts`, 'export const DONE = true;\n');
      await ctx.emit({ type: 'agent.message', payload: { text: 'decision: tests: test/webhooks.test.ts changed because the limit moved' } });
      return { endedBy: 'completed', cost: { inputTokens: 50, cachedTokens: 0, outputTokens: 5, usd: 0.0005 }, sessionId: sid };
    },
  };
  try {
    const results = await runBenchLive({
      tasks: [task],
      modes: ['resume'],
      implementer: 'first',
      continuer: 'next',
      repeat: 2,
      concurrency: 2,
      outDir: out.dir,
      synthetic: true,
      adapters: () => [first],
      makeFixture: fixture,
      museSessions: store.dir,
    });

    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.session).toBe('turn 0\n');
      expect(s.sessionId).toBe(sid);
      expect(s.instruction).toBe(RESUME_INSTRUCTION);
      // only Muse Code is told its worktree moved
      expect(s.argv).toEqual(['first']);
    }
    expect(new Set(seen.map((s) => s.worktree)).size).toBe(2);
    expect(results.rows).toHaveLength(2);
    for (const r of results.rows) {
      expect(r).toMatchObject({ mode: 'resume', promptTokens: countTokens(RESUME_INSTRUCTION), testsDecision: true });
    }
    expect(readFileSync(join(out.dir, 'runs', 'resume-limiter-resume-r1', 'prompt.md'), 'utf8')).toBe(RESUME_INSTRUCTION);
    expect(readFileSync(join(out.dir, 'runs', 'resume-limiter-resume-r2', 'diff.patch'), 'utf8')).toContain('+export const DONE = true;');
    expect(results.byMode.resume).toMatchObject({ runs: 2 });
  } finally {
    out.cleanup();
    store.cleanup();
  }
}, 180_000);
