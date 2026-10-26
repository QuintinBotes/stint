import { expect, test } from 'bun:test';
import { countTokens, renderHandoff } from '@stint-dev/core';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

/** A run that touches sixty files and is killed, the shape that broke the first live rehearsal. */
const sprawling: Adapter = {
  ...fakeAdapter('sleep'),
  async run(ctx): Promise<RunResult> {
    for (let i = 0; i < 60; i++) await Bun.write(`${ctx.worktree}/src/generated/a-rather-long-module-name-number-${i}.ts`, `export const value${i} = ${i};\n`.repeat(i + 1));
    await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: 'src/generated/index.ts' }, callId: 'c1' } });
    await new Promise<void>((resolve) => (ctx.signal.aborted ? resolve() : ctx.signal.addEventListener('abort', () => resolve(), { once: true })));
    return { endedBy: 'killed', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 2, usd: 0 }, inFlight: 'write_file src/generated/index.ts' };
  },
};

test('A killed run that changed sixty files still gets a packet under 600 tokens that keeps the in-flight step and says what it trimmed', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [sprawling]);
    const t = await ws.createTask(newTask);
    const { run } = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).json()) as { run: string };
    for (let i = 0; i < 200 && !(await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(25);
    await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {});
    for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);
    const packet = await ws.handoffs(t.id).latest();
    expect(packet).not.toBeNull();
    expect(countTokens(renderHandoff(packet as NonNullable<typeof packet>))).toBeLessThanOrEqual(600);
    expect(packet?.from.endedBy).toBe('killed');
    expect(packet?.leftOut[0]).toBe('In-flight step unknown: write_file src/generated/index.ts');
    expect(packet?.leftOut.at(-1)).toMatch(/^Trimmed to fit 600 tokens: \d+ items and file entries are not listed/);
    expect(packet?.changedFiles.length).toBeLessThan(60);
  });
}, 120_000);
