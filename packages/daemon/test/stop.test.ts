import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitOk } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('stop during a run produces run.finished { endedBy: killed } within 6 s and the worktree has a wip( commit', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('sleep')]);
    const t = await ws.createTask(newTask);
    const { run, worktree } = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' })).json()) as { run: string; worktree: string };
    for (let i = 0; i < 100 && !(await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(20);
    const t0 = Date.now();
    const res = await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {});
    expect(res.status).toBe(202);
    let finished = null as null | { payload: Record<string, unknown> };
    while (Date.now() - t0 < 6_000 && !finished) {
      finished = (await ws.events(t.id).read()).find((e) => e.type === 'run.finished') ?? null;
      if (!finished) await Bun.sleep(50);
    }
    expect(Date.now() - t0).toBeLessThan(6_000);
    expect(finished?.payload.endedBy).toBe('killed');
    expect(finished?.payload.inFlight).toBe('write_file src/lib/limiter.ts');
    expect((await gitOk(join(repo, worktree), ['log', '-1', '--format=%s'])).trim()).toBe(`wip(${t.id} ${run}): killed`);
    const again = await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {});
    expect(again.status).toBe(404);
  });
}, 30_000);

test('.stint/active names a live run while one is live: a run that ends leaves another run\'s pointer alone, hands it to the run still going, and clears it when none is', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('sleep')]);
    const [a, b, c] = [await ws.createTask({ ...newTask, testCommand: 'true' }), await ws.createTask({ ...newTask, title: 'Second task', testCommand: 'true' }), await ws.createTask({ ...newTask, title: 'Third task', testCommand: 'true' })] as const;
    const active = () => (existsSync(join(repo, '.stint', 'active')) ? (JSON.parse(readFileSync(join(repo, '.stint', 'active'), 'utf8')) as Record<string, string>) : null);
    const assign = async (id: string) => expect((await post(app, `/api/tasks/${id}/assign`, { adapter: 'fake', role: 'implementer' })).status).toBe(202);
    const stop = async (id: string) => expect((await post(app, `/api/tasks/${id}/runs/r1/stop`, {})).status).toBe(202);
    await assign(a.id);
    await assign(b.id);
    expect(active()).toEqual({ task: b.id, run: 'r1', worktree: `.stint/worktrees/${b.id}-r1`, adapter: 'fake' });
    await stop(a.id);
    expect(active()).toEqual({ task: b.id, run: 'r1', worktree: `.stint/worktrees/${b.id}-r1`, adapter: 'fake' });
    await assign(c.id);
    await stop(c.id);
    expect(active()).toEqual({ task: b.id, run: 'r1', worktree: `.stint/worktrees/${b.id}-r1`, adapter: 'fake' });
    await stop(b.id);
    expect(active()).toBeNull();
  });
}, 60_000);

const live = process.env.STINT_LIVE === '1';
const hasMuse = Bun.which('muse') !== null;

// R-009 Acceptance 3's live twin (R-057): the same stop against a real Muse Code run
test.skipIf(!live || !hasMuse)('With STINT_LIVE=1, stopping a real Muse Code run ends it as killed within 6 s and leaves a wip( commit', async () => {
  const { museCodeAdapter } = await import('@stint-dev/adapter-muse-code');
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [museCodeAdapter]);
    const t = await ws.createTask({ ...newTask, title: 'Rate-limit incoming webhooks per tenant' });
    const { run, worktree } = (await (await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'muse-code', role: 'implementer' })).json()) as { run: string; worktree: string };
    for (let i = 0; i < 1200 && !(await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(100);
    expect((await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call')).toBe(true);
    const t0 = Date.now();
    expect((await post(app, `/api/tasks/${t.id}/runs/${run}/stop`, {})).status).toBe(202);
    let finished = null as null | { payload: Record<string, unknown> };
    while (Date.now() - t0 < 6_000 && !finished) {
      finished = (await ws.events(t.id).read()).find((e) => e.type === 'run.finished') ?? null;
      if (!finished) await Bun.sleep(50);
    }
    expect(Date.now() - t0).toBeLessThan(6_000);
    expect(finished?.payload.endedBy).toBe('killed');
    expect((await gitOk(join(repo, worktree), ['log', '-1', '--format=%s'])).trim()).toBe(`wip(${t.id} ${run}): killed`);
  });
}, 180_000);

test.skipIf(live && hasMuse)('the live stop twin skips without STINT_LIVE=1 and the muse CLI; the fake-adapter stop above is its replay twin', () => {
  expect(live && hasMuse).toBe(false);
});
