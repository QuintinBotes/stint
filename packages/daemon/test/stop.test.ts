import { expect, test } from 'bun:test';
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
