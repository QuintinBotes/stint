import { expect, test } from 'bun:test';
import { type DemoClient, reviewBeat } from '../src/demo/live';
import { assertPreflight, checkPreflight } from '../src/demo/preflight';

const allPresent = { checkOllama: async () => true, checkMuse: () => true };

test('stint demo --live with META_API_KEY unset refuses to start and names the key', async () => {
  const r = await checkPreflight({ env: {}, ...allPresent });
  expect(r.ok).toBe(false);
  expect(r.missing[0]).toBe('META_API_KEY');
  expect(r.needs).toContain('META_API_KEY');
  await expect(assertPreflight({ env: {}, ...allPresent })).rejects.toThrow(/META_API_KEY/);
  const ok = await checkPreflight({ env: { META_API_KEY: 'present' }, ...allPresent });
  expect(ok).toMatchObject({ ok: true, missing: [] });
});

test('The review beat refuses to run while online unless --allow-online', async () => {
  const posts: Array<{ path: string; body: unknown }> = [];
  const client: DemoClient = {
    post: async (path, body) => {
      posts.push({ path, body });
      return { verdict: 'approve' };
    },
    get: async () => ({}),
  };
  const online = async () => true;
  const noPause = async () => undefined;
  await expect(reviewBeat(client, 'T-0042', { allowOnline: false, isOnline: online, pause: noPause })).rejects.toThrow(/while online/);
  expect(posts).toEqual([]);
  await reviewBeat(client, 'T-0042', { allowOnline: true, isOnline: online, pause: noPause });
  expect(posts).toEqual([{ path: '/api/tasks/T-0042/review', body: {} }]);
  posts.length = 0;
  await reviewBeat(client, 'T-0042', { allowOnline: false, isOnline: async () => false, pause: noPause });
  expect(posts).toEqual([{ path: '/api/tasks/T-0042/review', body: { host: 'ollama' } }]);
});
