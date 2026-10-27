import { expect, test } from 'bun:test';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';
import { plan, writeConfig } from './plan.fixtures';
import type { Adapter, RunResult } from '../src/index';

/** A local model host that records the token cap of every chat request. */
function cappedLocal() {
  const caps: Array<number | undefined> = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake', model: 'fake' }] });
      if (url.pathname === '/api/chat') {
        const body = (await req.json()) as { options?: { num_predict?: number } };
        caps.push(body.options?.num_predict);
        return Response.json({ message: { content: JSON.stringify(plan()) }, prompt_eval_count: 100, eval_count: 20 });
      }
      return new Response('no', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1`, caps, stop: () => server.stop(true) };
}

test('Acceptance 2: the plan call carries the planner budget as maxTokens', async () => {
  const local = cappedLocal();
  try {
    await withFixtureRepo(async (repo) => {
      writeConfig(repo, local.url);
      const { app, ws } = await makeApp(repo, []);
      const t = await ws.createTask({ ...newTask, budgets: { planner: 1234 } });
      expect(t.budgets.planner).toBe(1234);
      const res = await post(app, `/api/tasks/${t.id}/plan`, {});
      expect(res.status).toBe(200);
      expect(local.caps.length).toBeGreaterThan(0);
      expect(local.caps.every((c) => c === 1234)).toBe(true);
    });
  } finally {
    local.stop();
  }
}, 90_000);

test('Req 5: Muse Code steps are derived from the remaining budget, not only from config', async () => {
  await withFixtureRepo(async (repo) => {
    const seenSteps: Array<number | undefined> = [];
    const base = fakeAdapter('edit');
    const museFake: Adapter = {
      ...base,
      id: 'muse-code',
      async run(ctx): Promise<RunResult> {
        seenSteps.push(ctx.budget.steps);
        await Bun.write(`${ctx.worktree}/notes.md`, 'done\n');
        // spend most of the implementer budget: fresh input plus output counts
        return { endedBy: 'completed', cost: { inputTokens: 18_000, cachedTokens: 0, outputTokens: 0, usd: 0 } };
      },
    };
    const { app, ws } = await makeApp(repo, [museFake]);
    const t = await ws.createTask({ ...newTask, budgets: { implementer: 20_000 } });
    const waitPackets = async (n: number) => {
      for (let i = 0; i < 400 && (await ws.handoffs(t.id).names()).length < n; i++) await Bun.sleep(50);
    };
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
    await waitPackets(1);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' });
    await waitPackets(2);
    expect(seenSteps.length).toBe(2);
    expect(seenSteps[0]).toBe(60);
    // after spending 18000 of 20000, what is left buys far fewer than 60 steps
    expect(seenSteps[1] as number).toBeLessThan(60);
    expect(seenSteps[1] as number).toBeGreaterThanOrEqual(1);
  });
}, 120_000);
