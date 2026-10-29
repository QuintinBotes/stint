import { describe, expect, test } from 'bun:test';
import { makeApp, newTask, post, readSSE, withFixtureRepo } from './helpers';

describe('task stream', () => {
  test('POST /api/tasks then GET /api/tasks/:id/stream receives task.created within 200 ms', async () => {
    await withFixtureRepo(async (repo) => {
      const { app } = await makeApp(repo);
      const created = (await (await post(app, '/api/tasks', newTask)).json()) as { id: string };
      const t0 = performance.now();
      const res = await app.request(`/api/tasks/${created.id}/stream`);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      const frames = await readSSE(res, (f) => f.some((x) => x.event === 'task.created'));
      expect(performance.now() - t0).toBeLessThan(200);
      const first = frames.find((f) => f.event === 'task.created');
      expect(first?.id).toBe('1');
      expect(JSON.parse(first?.data ?? '{}')).toMatchObject({ type: 'task.created', seq: 1, task: created.id });
    });
  });

  test('Reconnecting with Last-Event-ID: 3 receives seq 4 onward only', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      for (let i = 0; i < 5; i++) await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: `m${i}` } });
      const res = await app.request(`/api/tasks/${t.id}/stream`, { headers: { 'Last-Event-ID': '3' } });
      const frames = await readSSE(res, (f) => f.some((x) => x.id === '6'));
      expect(frames.filter((f) => f.id).map((f) => f.id)).toEqual(['4', '5', '6']);
    });
  });

  test('a live append after connecting arrives on the open stream', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo);
      const t = await ws.createTask(newTask);
      const res = await app.request(`/api/tasks/${t.id}/stream`);
      setTimeout(() => void ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'agent.message', payload: { text: 'live' } }), 30);
      const frames = await readSSE(res, (f) => f.some((x) => x.event === 'agent.message'));
      expect(frames.map((f) => f.event)).toEqual(['task.created', 'agent.message']);
    });
  });

  test('R-004 Req 2: an idle stream sends a heartbeat with no id every heartbeatMs, on the task stream and the board stream', async () => {
    await withFixtureRepo(async (repo) => {
      const { app, ws } = await makeApp(repo, [], { heartbeatMs: 150 });
      const t = await ws.createTask(newTask);
      for (const [path, expected] of [
        [`/api/tasks/${t.id}/stream`, ['task.created:1', 'heartbeat:{}', 'heartbeat:{}']],
        ['/api/stream', ['heartbeat:{}', 'heartbeat:{}']],
      ] as const) {
        const t0 = performance.now();
        const frames = await readSSE(await app.request(path), (f) => f.filter((x) => x.event === 'heartbeat').length >= 2, 3000);
        expect([path, frames.map((f) => `${f.event}:${f.event === 'heartbeat' ? f.data : f.id}`)]).toEqual([path, [...expected]]);
        expect(frames.filter((f) => f.event === 'heartbeat').every((f) => f.id === undefined)).toBe(true);
        // two beats cannot come sooner than two intervals
        expect(performance.now() - t0).toBeGreaterThanOrEqual(290);
      }
    });
  });

  test('the board stream carries events from every task', async () => {
    await withFixtureRepo(async (repo) => {
      const { app } = await makeApp(repo);
      const res = await app.request('/api/stream');
      setTimeout(() => void post(app, '/api/tasks', newTask), 30);
      const frames = await readSSE(res, (f) => f.some((x) => x.event === 'task.created'));
      expect(frames.find((f) => f.event === 'task.created')?.id).toMatch(/^T-[0-9]{4}:1$/);
    });
  });
});
