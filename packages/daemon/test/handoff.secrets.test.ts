import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const SECRET = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');

test('A tool result containing a credential never appears in the packet or prompt.md', async () => {
  await withFixtureRepo(async (repo) => {
    const leaky: Adapter = {
      ...fakeAdapter('edit'),
      id: 'leaky',
      async run(ctx): Promise<RunResult> {
        await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'bash', args: { command: 'env' }, callId: 'c1' } });
        await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'bash', callId: 'c1', ok: true, summary: `AWS_SECRET_ACCESS_KEY=${SECRET}` } });
        await ctx.emit({ type: 'agent.message', payload: { text: `I printed the environment. AWS_SECRET_ACCESS_KEY=${SECRET} is set.` } });
        return { endedBy: 'completed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 } };
      },
    };
    const next = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [leaky, next]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'leaky', role: 'implementer' });
    for (let i = 0; i < 300 && (await ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
    expect((await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'fake' })).status).toBe(202);
    for (let i = 0; i < 300 && next.seen.length === 0; i++) await Bun.sleep(50);
    const dir = await ws.taskDir(t.id);
    const packets = (await ws.handoffs(t.id).names()).map((n) => readFileSync(join(dir, 'handoffs', `${n}.json`), 'utf8'));
    for (const p of [...packets, readFileSync(join(dir, 'handoff.json'), 'utf8'), readFileSync(next.seen[0]?.promptPath as string, 'utf8')]) {
      expect(p).not.toContain(SECRET);
    }
    expect(readFileSync(next.seen[0]?.promptPath as string, 'utf8')).toContain('AWS_SECRET_ACCESS_KEY=[redacted]');
  });
}, 60_000);
