import { expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { museCodeAdapter } from '@stint-dev/adapter-muse-code';
import { type Adapter, type RunResult, daemonContext, deriveHandoff } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, tempDir, withFixtureRepo } from './helpers';

test('Enrichment that returns a 900-char summary is rejected and the daemon\'s summary kept, with meta.fields.summary.from === events', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    for (let i = 0; i < 300 && (await ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
    const ctx = daemonContext(app);
    const { handoff, meta } = await deriveHandoff(ctx, t.id, 'r1', { enrich: { summary: 'x'.repeat(900), askOfNext: 'Review the limiter constant against the plan.', leftOut: ['The README was not updated'] } });
    expect(handoff.summary).toBe('Added the limiter constant.');
    expect(meta.fields.summary?.from).toBe('events');
    expect(handoff.askOfNext).toBe('Review the limiter constant against the plan.');
    expect(meta.fields.askOfNext?.from).toBe('enrich');
    expect(handoff.leftOut).toContain('The README was not updated');
    expect(meta.enriched.sort()).toEqual(['askOfNext', 'leftOut']);
  });
}, 60_000);

test('D-060: asking a leaving Muse Code session for the packet is metered as cost.recorded for enrich, and the task total counts it', async () => {
  const { dir, cleanup } = tempDir('stint-fake-muse-');
  const answer = JSON.stringify({ stream: { kind: 'session', id: 'sess-1' }, record_type: 'event', payload_type: 'run.terminal.completed', payload: { kind: 'run_terminal', terminal: 'completed', text: JSON.stringify({ summary: 'The limiter is wired.', leftOut: [], risks: [], askOfNext: 'Read the limit from config.' }) } });
  const usage = JSON.stringify({ stream: { kind: 'exec.usage', id: 'u1' }, record_type: 'status', payload_type: 'run.usage', payload: { kind: 'run_usage', models: [{ model: 'muse-spark-1.3', input_tokens: 18420, cached_tokens: 11200, output_tokens: 390 }] } });
  writeFileSync(join(dir, 'records.jsonl'), `${usage}\n${answer}\n`);
  writeFileSync(join(dir, 'muse'), `#!/bin/sh\ncat "${dir}/records.jsonl"\n`);
  chmodSync(join(dir, 'muse'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    await withFixtureRepo(async (repo) => {
      // the real adapter's enrich against a fake muse; only the run itself is faked
      const muse: Adapter = {
        ...museCodeAdapter,
        async run(ctx): Promise<RunResult> {
          await Bun.write(`${ctx.worktree}/src/lib/limiter.ts`, 'export const LIMIT = 60;\n');
          return { endedBy: 'completed', cost: { inputTokens: 100, cachedTokens: 40, outputTokens: 20, usd: 0.001 }, model: 'muse-spark-1.3', host: 'local-cli', sessionId: 'sess-1' };
        },
      };
      const { app, ws } = await makeApp(repo, [muse]);
      const t = await ws.createTask(newTask);
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
      for (let i = 0; i < 400 && (await ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
      const recorded = (await ws.events(t.id).read()).filter((e) => e.type === 'cost.recorded').map((e) => e.payload);
      // 7220 fresh at $1.25, 11200 cached at $0.15 and 390 out at $5 per million on meta-api/muse-spark-1.3
      expect(recorded).toEqual([{ for: 'enrich', run: 'r1', host: 'meta-api', model: 'muse-spark-1.3', cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 390, usd: 0.0127 } }]);
      expect((await ws.handoffs(t.id).read('h1'))?.summary).toBe('The limiter is wired.');
      const rows = (await (await app.request('/api/costs?group=task')).json()) as Array<{ key: string; usd: number; runs: number }>;
      expect(rows.find((r) => r.key === t.id)).toMatchObject({ usd: 0.0137, runs: 1 });
    });
  } finally {
    process.env.PATH = path;
    cleanup();
  }
}, 60_000);
