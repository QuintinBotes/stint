import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderHandoff } from '@stint-dev/core';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

function agent(id: string, refuse?: string): Adapter & { seen: Array<{ promptPath: string }> } {
  const base = fakeAdapter('edit');
  return {
    ...base,
    id,
    async run(ctx): Promise<RunResult> {
      base.seen.push(ctx);
      if (refuse) await ctx.emit({ type: 'rule.blocked', payload: { action: refuse, reason: 'pushing is the human\'s call', by: 'stint-rules' } });
      await Bun.write(`${ctx.worktree}/notes-${id}.md`, `${id}\n`);
      await ctx.emit({ type: 'agent.message', payload: { text: `${id} wrote its notes.` } });
      return { endedBy: 'completed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 } };
    },
  };
}

test('A third hop\'s prompt contains the first hop\'s refusals attributed to the first agent and none of its done items', async () => {
  await withFixtureRepo(async (repo) => {
    const a = agent('alpha', 'git push origin stint/T-0001');
    const b = agent('bravo');
    const c = agent('charlie');
    const { app, ws } = await makeApp(repo, [a, b, c]);
    const t = await ws.createTask(newTask);
    const waitPackets = async (n: number) => {
      for (let i = 0; i < 400 && (await ws.handoffs(t.id).names()).length < n; i++) await Bun.sleep(50);
    };
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'alpha', role: 'implementer' });
    await waitPackets(1);
    const h1 = await ws.handoffs(t.id).read('h1');
    expect(h1?.refusals?.[0]?.action).toBe('git push origin stint/T-0001');
    await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'bravo' });
    await waitPackets(3);
    await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'charlie' });
    for (let i = 0; i < 400 && c.seen.length === 0; i++) await Bun.sleep(50);
    const prompt = readFileSync(c.seen[0]?.promptPath as string, 'utf8');
    expect(prompt).toContain('git push origin stint/T-0001 [by stint-rules; reason: pushing is the human\'s call; for: alpha r1]');
    expect(prompt).toContain('Before that it was with alpha r1');
    expect(prompt).not.toContain('alpha wrote its notes.');
    expect(prompt).toContain('bravo wrote its notes.');
  });
}, 90_000);

test('Acceptance 6: a hop packet prompt contains none of the previous hop done items', async () => {
  await withFixtureRepo(async (repo) => {
    const a = agent('alpha');
    const b = agent('bravo');
    const c = agent('charlie');
    const { app, ws } = await makeApp(repo, [a, b, c]);
    const t = await ws.createTask(newTask);
    await ws.writePlan(t.id, {
      version: 'stint.plan/1',
      steps: [
        { id: 1, text: 'Alpha step one', files: ['notes-alpha.md'] },
        { id: 2, text: 'Bravo step two', files: ['notes-bravo.md'] },
      ],
      filesToTouch: ['notes-alpha.md', 'notes-bravo.md'],
      risks: [],
      similarTasks: [],
      model: 'fake',
    });
    const waitPackets = async (n: number) => {
      for (let i = 0; i < 400 && (await ws.handoffs(t.id).names()).length < n; i++) await Bun.sleep(50);
    };
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'alpha', role: 'implementer' });
    await waitPackets(1);
    const h1 = await ws.handoffs(t.id).read('h1');
    expect(h1?.done).toContain('Alpha step one');
    await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'bravo' });
    await waitPackets(3);
    const names = await ws.handoffs(t.id).names();
    const bravoPacket = await ws.handoffs(t.id).read(names.at(-1) as string);
    expect(bravoPacket?.from.adapter).toBe('bravo');
    expect(bravoPacket?.done).toContain('Bravo step two');
    for (const item of h1?.done ?? []) expect(bravoPacket?.done).not.toContain(item);
    // the packet prompt is the rendered packet the next hop reads
    const prompt = renderHandoff(bravoPacket as NonNullable<typeof bravoPacket>);
    expect(prompt).toContain('Bravo step two');
    for (const item of h1?.done ?? []) expect(prompt).not.toContain(item);
    expect(c.seen).toHaveLength(0);
  });
}, 120_000);
