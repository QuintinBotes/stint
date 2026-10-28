import { expect, test } from 'bun:test';
import { builtTask, withFixtureRepo } from './helpers';

test('The task list carries each task its latest verification in brief, so the board needs no request per card', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const fresh = await ws.createTask({ title: 'Not built yet', goal: 'Nothing.', acceptance: ['nothing'], testCommand: 'true' });
    const { tasks } = (await (await app.request('/api/tasks')).json()) as { tasks: Array<{ task: { id: string }; verification: unknown }> };
    expect(tasks.find((c) => c.task.id === t.id)?.verification).toEqual({ passed: 33, failed: 0, status: 'green' });
    expect(tasks.find((c) => c.task.id === fresh.id)?.verification).toBeNull();
  });
}, 120_000);
