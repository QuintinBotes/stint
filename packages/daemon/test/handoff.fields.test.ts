import { expect, test } from 'bun:test';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const waitPackets = async (ws: { handoffs: (id: string) => { names: () => Promise<string[]> } }, id: string, n: number) => {
  for (let i = 0; i < 400 && (await ws.handoffs(id).names()).length < n; i++) await Bun.sleep(50);
  return ws.handoffs(id).names();
};

test('Acceptance 5: a packet after a run that left the ask open lists it under open, and a risk line lands in risks', async () => {
  await withFixtureRepo(async (repo) => {
    const alphaBase = fakeAdapter('edit');
    const alpha: Adapter = {
      ...alphaBase,
      id: 'alpha',
      async run(ctx): Promise<RunResult> {
        await Bun.write(`${ctx.worktree}/notes-alpha.md`, 'alpha\n');
        await ctx.emit({ type: 'agent.message', payload: { text: 'Added the first pass.\nrisk: The limiter state resets on restart' } });
        return { endedBy: 'completed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 } };
      },
    };
    const bravoBase = fakeAdapter('edit');
    const bravo: Adapter = {
      ...bravoBase,
      id: 'bravo',
      async run(ctx): Promise<RunResult> {
        await ctx.emit({ type: 'agent.message', payload: { text: 'Looked at it and stopped.' } });
        return { endedBy: 'failed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [alpha, bravo]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'alpha', role: 'implementer' });
    await waitPackets(ws, t.id, 1);
    const h1 = await ws.handoffs(t.id).read('h1');
    expect(h1).not.toBeNull();
    expect(h1?.risks).toContain('The limiter state resets on restart');
    const carriedAsk = h1?.askOfNext as string;
    expect(carriedAsk.length).toBeGreaterThan(0);
    await post(app, `/api/tasks/${t.id}/hand`, { adapter: 'bravo' });
    // hand rebuilds a packet for alpha, then bravo ends and its ending builds another
    const names = await waitPackets(ws, t.id, 3);
    const last = await ws.handoffs(t.id).read(names.at(-1) as string);
    expect(last?.from.adapter).toBe('bravo');
    expect(last?.open).toContain(carriedAsk);
  });
}, 120_000);

test('Req 8: POST handoff with enrich true asks the leaving session before building the packet', async () => {
  await withFixtureRepo(async (repo) => {
    let enrichCalls = 0;
    const base = fakeAdapter('edit');
    const agent: Adapter = {
      ...base,
      id: 'enricher',
      capabilities: { ...base.capabilities, resumable: true },
      async run(ctx): Promise<RunResult> {
        await Bun.write(`${ctx.worktree}/notes-enrich.md`, 'x\n');
        await ctx.emit({ type: 'agent.message', payload: { text: 'Did the work.' } });
        return { endedBy: 'completed', cost: { inputTokens: 5, cachedTokens: 0, outputTokens: 5, usd: 0 }, sessionId: 'sess-1' };
      },
      enrich: async () => {
        enrichCalls++;
        return { summary: `Enriched summary ${enrichCalls}.` };
      },
    };
    const { app, ws } = await makeApp(repo, [agent]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'enricher', role: 'implementer' });
    await waitPackets(ws, t.id, 1);
    const afterRun = enrichCalls;
    const plain = await post(app, `/api/tasks/${t.id}/handoff`, {});
    expect(plain.status).toBe(200);
    expect(enrichCalls).toBe(afterRun);
    const enriched = await post(app, `/api/tasks/${t.id}/handoff`, { enrich: true });
    expect(enriched.status).toBe(200);
    expect(enrichCalls).toBe(afterRun + 1);
    const body = (await enriched.json()) as { handoff: { summary: string } };
    expect(body.handoff.summary).toBe(`Enriched summary ${afterRun + 1}.`);
  });
}, 120_000);
