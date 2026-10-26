import { expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '@stint-dev/daemon';
import { TOKEN, auth, newTask, withFixtureRepo } from '../../../daemon/test/helpers';
import { createStintAgent } from '../src/index';
import { callTool, configFor, fakeHost, say } from './fake';

test('A tool call to git push is refused, emitted as rule.blocked, and the adapter\'s gate flips to enforced in /api/health', async () => {
  const host = fakeHost([{ body: callTool('bash', { command: 'git push origin stint/T-0001' }) }, { body: say('I could not push; Stint merges on approve.') }]);
  try {
    await withFixtureRepo(async (repo) => {
      const agent = createStintAgent(configFor({ 'meta-api': host.url }), { META_API_KEY: 'test' });
      const ws = await Workspace.open(repo);
      const app = createApp(ws, [agent], { token: TOKEN, quiet: true, webDist: null });
      const healthGate = async () => ((await (await app.request('/api/health')).json()) as { adapters: Array<{ id: string; gate: string }> }).adapters.find((a) => a.id === 'stint-agent')?.gate;
      const t = await ws.createTask(newTask);
      const res = await app.request(`/api/tasks/${t.id}/assign`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'stint-agent', role: 'implementer' }) });
      expect(res.status).toBe(202);
      for (let i = 0; i < 300 && !(await ws.events(t.id).read()).some((e) => e.type === 'run.finished'); i++) await Bun.sleep(25);
      const events = await ws.events(t.id).read();
      const blocked = events.find((e) => e.type === 'rule.blocked');
      expect(blocked?.payload).toMatchObject({ action: 'git push origin stint/T-0001', by: 'stint-rules' });
      expect(events.find((e) => e.type === 'agent.tool_result')?.payload.ok).toBe(false);
      expect(events.find((e) => e.type === 'run.finished')?.payload).toMatchObject({ endedBy: 'completed', host: 'meta-api' });
      expect(await healthGate()).toBe('enforced');
      // the model was told why, as its tool result
      expect(JSON.stringify(host.seen[1]?.messages)).toContain('Refused by Stint: pushing is the human');
      for (let i = 0; i < 200 && (await ws.readTask(t.id)).status === 'verifying'; i++) await Bun.sleep(25);
    });
  } finally {
    host.stop();
  }
}, 60_000);
