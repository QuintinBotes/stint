import { expect, test } from 'bun:test';
import { daemonContext } from '../src/app';
import { gardenStatus, gardenTick } from '../src/gardening';
import { makeApp, withFixtureRepo } from './helpers';

const DAY = 86_400_000;

test('With a weekly schedule and a clock moved forward, exactly one doc-gardening task is created and none twice', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    ws.config.gardening = { schedule: 'weekly', tasks: [{ title: 'Prune stale feature flags', goal: 'Remove feature flags that have been on for every tenant for a month.' }] };
    const ctx = daemonContext(app);
    const start = Date.parse('2026-10-27T09:00:00Z');
    const docs = async () => (await ws.listTasks()).filter((t) => t.source?.kind === 'gardening' && t.source.ref === 'docs');

    const first = await gardenTick(ctx, new Date(start));
    expect(first).toHaveLength(3);
    expect(await docs()).toHaveLength(1);
    const task = (await docs())[0];
    expect(task).toMatchObject({ tags: ['gardening'], source: { kind: 'gardening', ref: 'docs' } });
    expect((await ws.events(task?.id as string).read()).some((e) => e.type === 'autopilot.started')).toBe(true);

    // the same day, a day later, and with the task merged but the week not up: nothing new
    expect(await gardenTick(ctx, new Date(start + 60_000))).toEqual([]);
    expect(await gardenTick(ctx, new Date(start + DAY))).toEqual([]);
    await ws.writeTask(task?.id as string, { status: 'done' });
    expect(await gardenTick(ctx, new Date(start + 3 * DAY))).toEqual([]);
    expect(await docs()).toHaveLength(1);

    // a week on, the doc gardening comes round again; the others still have open tasks, so they wait
    const week = await gardenTick(ctx, new Date(start + 7 * DAY + 60_000));
    expect(week).toHaveLength(1);
    expect(await docs()).toHaveLength(2);
    const status = await gardenStatus(ctx, new Date(start + 7 * DAY + 60_000));
    expect(status.templates.map((t) => t.id)).toEqual(['docs', 'drift', 'own-prune-stale-feature-flags']);
    expect(status.templates.find((t) => t.id === 'drift')?.openTask).toBeTruthy();
    expect(status.templates.find((t) => t.id === 'docs')?.nextAt).toBe(new Date(start + 14 * DAY + 60_000).toISOString());
  });
}, 60_000);

test('With gardening off, or not configured, no task is made', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const ctx = daemonContext(app);
    expect(await gardenTick(ctx)).toEqual([]);
    ws.config.gardening = { schedule: 'off', tasks: [] };
    expect(await gardenTick(ctx)).toEqual([]);
    expect(await ws.listTasks()).toEqual([]);
    expect((await (await app.request('/api/gardening')).json()) as { schedule: string }).toMatchObject({ schedule: 'off' });
  });
}, 60_000);
