import { expect, test } from 'bun:test';
import { assign, daemonContext } from '../src/index';
import { fakeAdapter, makeApp, newTask, withFixtureRepo } from './helpers';

test('A run assigned with resume transcript has no packet section and carries the transcript; steps caps the run', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [adapter]);
    const ctx = daemonContext(app);
    const t = await ws.createTask(newTask);

    // A completed first run, so a packet exists that a normal continuation would carry.
    const first = await assign(ctx, t.id, { adapter: 'fake', role: 'implementer' });
    await first.done;
    expect(await ws.handoffs(t.id).names()).toHaveLength(1);
    expect(adapter.seen[0]?.budget.steps).not.toBe(3);
    expect(adapter.seen[0]?.budget.maxTurns).toBeUndefined();

    const transcript = 'Assistant: half the limiter is written.\n\nTool call: read_file {"path":"src/lib/limiter.ts"}\n\nTool result (read_file):\nexport const LIMIT = 60;';
    const second = await assign(ctx, t.id, {
      adapter: 'fake',
      role: 'implementer',
      steps: 3,
      resume: { kind: 'transcript', text: transcript },
    });
    await second.done;

    const seen = adapter.seen[1];
    expect(seen?.prompt).toContain('## Transcript of the previous run');
    expect(seen?.prompt).toContain('half the limiter is written');
    expect(seen?.prompt).toContain('Tool call: read_file {"path":"src/lib/limiter.ts"}');
    expect(seen?.prompt).not.toContain('## Packet from the previous run');
    expect(seen?.prompt).not.toContain('You are picking up work in progress.');
    expect(seen?.budget.steps).toBe(3);
    expect(seen?.budget.maxTurns).toBe(3);
  });
}, 90_000);

test('A run assigned with resume diff carries the earlier diff and neither the packet nor a transcript', async () => {
  await withFixtureRepo(async (repo) => {
    const adapter = fakeAdapter('edit');
    const { app, ws } = await makeApp(repo, [adapter]);
    const ctx = daemonContext(app);
    const t = await ws.createTask(newTask);
    const first = await assign(ctx, t.id, { adapter: 'fake', role: 'implementer' });
    await first.done;
    expect(await ws.handoffs(t.id).names()).toHaveLength(1);

    const diff = (await ctx.worktrees.diff(await ws.readTask(t.id), 'unified')) as string;
    expect(diff).toContain('export const LIMIT = 60;');
    const second = await assign(ctx, t.id, { adapter: 'fake', role: 'implementer', resume: { kind: 'diff', text: diff } });
    await second.done;

    const prompt = adapter.seen[1]?.prompt ?? '';
    expect(prompt).toContain('## Diff of the previous run');
    expect(prompt).toContain('+export const LIMIT = 60;');
    expect(prompt).toContain('Continue from the diff');
    expect(prompt).toContain(newTask.goal);
    expect(prompt).not.toContain('## Packet from the previous run');
    expect(prompt).not.toContain('## Transcript of the previous run');
    const started = (await ws.events(t.id).read()).find((e) => e.type === 'run.started' && e.run === second.run);
    expect(started?.payload.handoffFrom).toBeNull();
  });
}, 90_000);
