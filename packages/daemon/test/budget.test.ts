import { expect, test } from 'bun:test';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

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
