import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { builtTask, post, withFixtureRepo } from './helpers';

test('Reject writes the decision, sets building, and the next assign\'s prompt.md contains the reason under ## Ask', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const reason = 'Read the limit through loadConfig(), not a constant';
    expect((await post(app, `/api/tasks/${t.id}/reject`, { reason })).status).toBe(200);
    expect(readFileSync(`${await ws.taskDir(t.id)}/decisions.md`, 'utf8')).toContain(`Rejected: ${reason}`);
    expect((await ws.readTask(t.id)).status).toBe('building');
    expect((await ws.events(t.id).read()).some((e) => e.type === 'approval.rejected' && e.payload.reason === reason)).toBe(true);
    const res = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const { run } = (await res.json()) as { run: string };
    const prompt = (await ws.runs(t.id).readPrompt(run)) ?? '';
    expect(prompt.slice(prompt.indexOf('## Ask'))).toContain(reason);
    for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created' && e.run === run); i++) await Bun.sleep(50);
  });
}, 120_000);

test('request-changes sets building with the text as the ask and records no decision', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    expect((await post(app, `/api/tasks/${t.id}/request-changes`, { text: 'Add a test for two tenants' })).status).toBe(200);
    const task = await ws.readTask(t.id);
    expect(task).toMatchObject({ status: 'building', pendingAsk: 'Add a test for two tenants' });
    expect((await ws.decisions(t.id).read()).length).toBe(0);
  });
}, 120_000);
