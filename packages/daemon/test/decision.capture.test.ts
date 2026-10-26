import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('An agent.message containing decision: Sliding window over fixed window appends D<n> to decisions.md and emits decision.recorded', async () => {
  await withFixtureRepo(async (repo) => {
    const deciding: Adapter = {
      ...fakeAdapter('edit'),
      async run(ctx): Promise<RunResult> {
        await ctx.emit({ type: 'agent.message', payload: { text: 'A fixed window lets a tenant double the limit at the edge.\ndecision: Sliding window over fixed window' } });
        await ctx.emit({ type: 'agent.message', payload: { text: 'decision: Keep hits per tenant in memory\nsupersedes: D1' } });
        return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [deciding]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    for (let i = 0; i < 300 && (await ws.events(t.id).read()).filter((e) => e.type === 'decision.recorded').length < 2; i++) await Bun.sleep(25);
    const recorded = (await ws.events(t.id).read()).filter((e) => e.type === 'decision.recorded');
    expect(recorded.map((e) => [e.payload.id, e.payload.text])).toEqual([
      ['D1', 'Sliding window over fixed window'],
      ['D2', 'Keep hits per tenant in memory'],
    ]);
    const md = readFileSync(join(await ws.taskDir(t.id), 'decisions.md'), 'utf8');
    expect(md).toContain('Sliding window over fixed window');
    expect(md).toContain('supersedes: D1');
    expect((await ws.decisions(t.id).validAt()).map((d) => d.id)).toEqual(['D2']);
    for (let i = 0; i < 300 && (await ws.readTask(t.id)).status !== 'reviewing'; i++) await Bun.sleep(25);
  });
}, 60_000);
