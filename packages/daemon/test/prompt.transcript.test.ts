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
