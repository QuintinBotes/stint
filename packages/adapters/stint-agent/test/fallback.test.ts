import { expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '@stint-dev/daemon';
import { TOKEN, auth, newTask, withFixtureRepo } from '../../../daemon/test/helpers';
import { createStintAgent } from '../src/index';
import { callTool, configFor, fakeHost, say } from './fake';

test('A fake first host answering 429 moves the run to the next host and emits provider.fallback', async () => {
  const meta = fakeHost([{ status: 429 }]);
  const fireworks = fakeHost([{ body: callTool('read_file', { path: 'src/app.ts' }) }, { body: say('Read the app; nothing to change.') }]);
  try {
    await withFixtureRepo(async (repo) => {
      const agent = createStintAgent(configFor({ 'meta-api': meta.url, fireworks: fireworks.url }), { META_API_KEY: 'a', FIREWORKS_API_KEY: 'b' });
      const ws = await Workspace.open(repo);
      const app = createApp(ws, [agent], { token: TOKEN, quiet: true, webDist: null });
      const t = await ws.createTask(newTask);
      await app.request(`/api/tasks/${t.id}/assign`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'stint-agent', role: 'implementer' }) });
      for (let i = 0; i < 300 && !(await ws.events(t.id).read()).some((e) => e.type === 'run.finished'); i++) await Bun.sleep(25);
      const events = await ws.events(t.id).read();
      expect(events.find((e) => e.type === 'provider.fallback')?.payload).toMatchObject({ from: 'meta-api/muse-spark-1.3', to: 'fireworks/muse-spark-open', reason: '429' });
      const finished = events.find((e) => e.type === 'run.finished');
      expect(finished?.payload).toMatchObject({ endedBy: 'completed', host: 'fireworks', model: 'muse-spark-open' });
      expect((finished?.payload.cost as { usd: number }).usd).toBeGreaterThan(0);
      expect(events.find((e) => e.type === 'agent.tool_result')?.payload).toMatchObject({ tool: 'read_file', ok: true });
      for (let i = 0; i < 200 && (await ws.readTask(t.id)).status === 'verifying'; i++) await Bun.sleep(25);
    });
  } finally {
    meta.stop();
    fireworks.stop();
  }
}, 60_000);
