import { expect, test } from 'bun:test';
import { makeApp, newTask, post, withFixtureRepo } from './helpers';

test('A mutating call without the token gets 401 unauthorized; with it, 2xx', async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    const denied = await post(app, '/api/tasks', newTask, {});
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
    const wrong = await post(app, '/api/tasks', newTask, { Authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);
    const ok = await post(app, '/api/tasks', newTask);
    expect(ok.status).toBe(201);
    expect((await app.request('/api/tasks')).status).toBe(200);
  });
});

test('errors are { error: { code, message, hint } } and a bad body is invalid with the zod issues in hint', async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    const res = await post(app, '/api/tasks', { title: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string; hint: unknown[] } };
    expect(body.error.code).toBe('invalid');
    expect(Array.isArray(body.error.hint)).toBe(true);
    const missing = await app.request('/api/tasks/T-9999');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('not_found');
  });
});

test('a request with a Host other than localhost is refused, so DNS rebinding cannot reach the daemon', async () => {
  await withFixtureRepo(async (repo) => {
    const { app } = await makeApp(repo);
    expect((await app.request('/api/health', { headers: { Host: 'evil.example.com' } })).status).toBe(401);
    expect((await app.request('/api/health', { headers: { Host: '127.0.0.1:4319' } })).status).toBe(200);
  });
});
