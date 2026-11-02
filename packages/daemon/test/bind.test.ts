import { expect, test } from 'bun:test';
import { startDaemon } from '../src/index';
import { fakeAdapter, withFixtureRepo } from './helpers';

test('a daemon started with no address listens on 127.0.0.1', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [fakeAdapter('edit')] });
    try {
      expect(d.hostname).toBe('127.0.0.1');
      expect((await fetch(`${d.url}/api/health`)).status).toBe(200);
    } finally {
      await d.stop();
    }
  });
});

test('a daemon bound to 0.0.0.0 for a container answers on loopback and still refuses a Host other than localhost', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, hostname: '0.0.0.0', adapters: [fakeAdapter('edit')] });
    try {
      expect(d.hostname).toBe('0.0.0.0');
      expect(d.url).toBe(`http://127.0.0.1:${d.port}`);
      expect((await fetch(`${d.url}/api/health`)).status).toBe(200);
      expect((await fetch(`${d.url}/api/health`, { headers: { Host: 'evil.example.com' } })).status).toBe(401);
      expect((await fetch(`${d.url}/`, { headers: { Host: 'evil.example.com' } })).status).toBe(401);
      expect((await fetch(`${d.url}/api/tasks`, { method: 'POST', body: '{}' })).status).toBe(401);
    } finally {
      await d.stop();
    }
  });
});
