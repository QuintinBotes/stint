import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fakeModels, setup, task, until } from './autopilot.fixtures';
import { builtTask, fakeAdapter, post, withFixtureRepo } from './helpers';

test('Reject off autopilot writes the decision, sets rejected so the board shows it under Needs you, and the next assign\'s prompt.md contains the reason under ## Ask', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const reason = 'Read the limit through loadConfig(), not a constant';
    const res = await post(app, `/api/tasks/${t.id}/reject`, { reason });
    expect(await res.json()).toEqual({ status: 'rejected', autopilot: false, decision: 'D1' });
    expect(readFileSync(`${await ws.taskDir(t.id)}/decisions.md`, 'utf8')).toContain(`Rejected: ${reason}`);
    expect(await ws.readTask(t.id)).toMatchObject({ status: 'rejected', pendingAsk: reason });
    expect((await ws.events(t.id).read()).some((e) => e.type === 'approval.rejected' && e.payload.reason === reason)).toBe(true);
    const assigned = await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    const { run } = (await assigned.json()) as { run: string };
    const prompt = (await ws.runs(t.id).readPrompt(run)) ?? '';
    expect(prompt.slice(prompt.indexOf('## Ask'))).toContain(reason);
    for (let i = 0; i < 600 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created' && e.run === run); i++) await Bun.sleep(50);
  });
}, 120_000);

test('request-changes off autopilot sets rejected with the text as the ask and records no decision', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws, t } = await builtTask(repo);
    const res = await post(app, `/api/tasks/${t.id}/request-changes`, { text: 'Add a test for two tenants' });
    expect(await res.json()).toEqual({ status: 'rejected', autopilot: false });
    expect(await ws.readTask(t.id)).toMatchObject({ status: 'rejected', pendingAsk: 'Add a test for two tenants' });
    expect((await ws.decisions(t.id).read()).length).toBe(0);
  });
}, 120_000);

for (const [route, body, ask] of [
  ['reject', { reason: 'Read the limit through loadConfig()' }, 'Read the limit through loadConfig()'],
  ['request-changes', { text: 'Add a test for two tenants' }, 'Add a test for two tenants'],
] as const) {
  test(`${route} when autopilot stopped at the gate switches it on again, and it builds from the ask back to the gate`, async () => {
    const models = fakeModels();
    try {
      await withFixtureRepo(async (repo) => {
        const { app, ws } = await setup(repo, [{ ...fakeAdapter('edit'), id: 'muse-code' }], models);
        const t = await ws.createTask(task('true'));
        await post(app, `/api/tasks/${t.id}/autopilot`, { on: true });
        await until(ws, t.id, (ev) => ev.some((e) => e.type === 'autopilot.stopped'));
        expect((await ws.readTask(t.id)).status).toBe('awaiting_approval');

        const res = await post(app, `/api/tasks/${t.id}/${route}`, body);
        expect(await res.json()).toMatchObject({ status: 'building', autopilot: true });
        const events = await until(ws, t.id, (ev) => ev.filter((e) => e.type === 'autopilot.stopped').length >= 2);
        const builds = events.filter((e) => e.type === 'autopilot.step' && e.payload.step === 'build');
        expect(builds.map((e) => e.payload.reason)).toEqual(['Nothing is built yet. muse-code builds it.', 'It was sent back with changes to make. muse-code builds it.']);
        const second = events.filter((e) => e.type === 'run.started' && e.payload.role === 'implementer').at(-1)?.run as string;
        const prompt = (await ws.runs(t.id).readPrompt(second)) ?? '';
        expect(prompt.slice(prompt.indexOf('## Ask'))).toContain(ask);
        expect(events.filter((e) => e.type === 'autopilot.stopped').at(-1)?.payload).toMatchObject({ reason: 'Waiting for your approval.', needsYou: false });
        expect(await ws.readTask(t.id)).toMatchObject({ status: 'awaiting_approval', pendingAsk: null });
      });
    } finally {
      models.stop();
    }
  }, 120_000);
}
