import { expect, test } from 'bun:test';
import { TOKEN, fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('Assigning an implementer run when the role spend plus the prompt exceeds the budget returns budget_exceeded with a hint naming spent, prompt and cap', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ ...newTask, budgets: { implementer: 200 } });
    const res = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: { code: string; hint: { spent: number; prompt: number; cap: number } } };
    expect(error.code).toBe('budget_exceeded');
    expect(error.hint).toMatchObject({ spent: 0, cap: 200 });
    expect(error.hint.prompt).toBeGreaterThan(200);
    expect((await ws.events(t.id).read()).some((e) => e.type === 'run.started')).toBe(false);
  });
});

test('A refused run says what was spent against which budget and how to raise it, and runs once a person raises it with the limits route', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask({ ...newTask, budgets: { planner: 40_000, implementer: 200, reviewer: 30_000 } });
    const refused = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).json()) as { error: { message: string } };
    expect(refused.error.message).toMatch(new RegExp(`^the implementer budget on ${t.id} would be exceeded: 0 tokens spent and a [0-9,]+-token prompt against 200; raise it with stint limits ${t.id} --implementer-tokens [0-9]+0000$`));
    const raise = await app.request(`/api/tasks/${t.id}/limits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ budgets: { implementer: 100_000 } }),
    });
    expect(raise.status).toBe(200);
    expect(((await raise.json()) as { tokens: unknown }).tokens).toEqual({ budget: 100_000, spent: 0 });
    expect((await ws.readTask(t.id)).budgets).toMatchObject({ planner: 40_000, implementer: 100_000, reviewer: 30_000 });
    expect((await ws.events(t.id).read()).find((e) => e.type === 'limits.changed')?.payload).toMatchObject({ budgetsFrom: { implementer: 200 }, budgetsTo: { implementer: 100_000 }, by: 'you' });
    expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).status).toBe(202);
  });
});
