import { expect, test } from 'bun:test';
import { daemonContext, deriveHandoff } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

test('Enrichment that returns a 900-char summary is rejected and the daemon\'s summary kept, with meta.fields.summary.from === events', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo, [fakeAdapter('edit')]);
    const t = await ws.createTask(newTask);
    await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
    for (let i = 0; i < 300 && (await ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
    const ctx = daemonContext(app);
    const { handoff, meta } = await deriveHandoff(ctx, t.id, 'r1', { enrich: { summary: 'x'.repeat(900), askOfNext: 'Review the limiter constant against the plan.', leftOut: ['The README was not updated'] } });
    expect(handoff.summary).toBe('Added the limiter constant.');
    expect(meta.fields.summary?.from).toBe('events');
    expect(handoff.askOfNext).toBe('Review the limiter constant against the plan.');
    expect(meta.fields.askOfNext?.from).toBe('enrich');
    expect(handoff.leftOut).toContain('The README was not updated');
    expect(meta.enriched.sort()).toEqual(['askOfNext', 'leftOut']);
  });
}, 60_000);
