import { expect, test } from 'bun:test';
import { Workspace } from '@stint-dev/core/node';
import { createApp } from '@stint-dev/daemon';
import { TOKEN, auth, newTask, withFixtureRepo } from '../../../daemon/test/helpers';
import { createStintAgent } from '../src/index';
import { checkCall } from '../src/tools';
import { callTool, configFor, fakeHost, say } from './fake';

/** A tool call whose arguments are sent exactly as given, malformed or not. */
const rawCall = (name: string, args: string, id: string) => {
  const c = callTool(name, {}, id);
  for (const call of c.choices[0]?.message.tool_calls ?? []) call.function.arguments = args;
  return c;
};

test('checkCall refuses unknown tools, bad JSON, missing or mistyped arguments, and passes a good call', () => {
  expect(checkCall('rm_rf', '{}')).toMatchObject({ ok: false, reason: expect.stringContaining('there is no tool named rm_rf') });
  expect(checkCall('bash', '{"command": ')).toEqual({ ok: false, reason: 'the arguments are not valid JSON' });
  expect(checkCall('bash', '[]')).toEqual({ ok: false, reason: 'the arguments must be a JSON object' });
  expect(checkCall('bash', '{}')).toEqual({ ok: false, reason: 'command is required' });
  expect(checkCall('read_file', '{"path": "a", "offset": 1.5}')).toEqual({ ok: false, reason: 'offset must be a whole number' });
  expect(checkCall('write_file', '{"path": "a", "content": 3}')).toEqual({ ok: false, reason: 'content must be a string' });
  expect(checkCall('grep', '{"pattern": "x", "flags": "i"}')).toEqual({ ok: false, reason: 'grep takes no argument flags' });
  expect(checkCall('bash', '{"command": "bun test"}')).toEqual({ ok: true, args: { command: 'bun test' } });
});

async function runAgent(replies: Parameters<typeof fakeHost>[0]) {
  const host = fakeHost(replies);
  return { host, go: async (repo: string) => {
    const agent = createStintAgent(configFor({ 'meta-api': host.url }), { META_API_KEY: 'test' });
    const ws = await Workspace.open(repo);
    const app = createApp(ws, [agent], { token: TOKEN, quiet: true, webDist: null });
    const t = await ws.createTask(newTask);
    await app.request(`/api/tasks/${t.id}/assign`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'stint-agent', role: 'implementer' }) });
    for (let i = 0; i < 400 && !(await ws.events(t.id).read()).some((e) => e.type === 'run.finished'); i++) await Bun.sleep(25);
    const events = await ws.events(t.id).read();
    for (let i = 0; i < 200 && (await ws.readTask(t.id)).status === 'verifying'; i++) await Bun.sleep(25);
    return { events };
  } };
}

test('A malformed tool call from a local model is never run: the model is told why, calls again, and the run goes on', async () => {
  const { host, go } = await runAgent([
    { body: rawCall('bash', '{"command": "bun test"', 'c1') },
    { body: rawCall('bash', '{}', 'c2') },
    { body: callTool('write_file', { path: 'NOTES.md', content: 'checked\n' }, 'c3') },
    { body: say('Wrote the notes.') },
  ]);
  try {
    await withFixtureRepo(async (repo) => {
      const { events } = await go(repo);
      const results = events.filter((e) => e.type === 'agent.tool_result').map((e) => [e.payload.callId, e.payload.ok, e.payload.summary]);
      expect(results).toEqual([
        ['c1', false, 'not run: the arguments are not valid JSON'],
        ['c2', false, 'not run: command is required'],
        ['c3', true, expect.any(String)],
      ]);
      expect(JSON.stringify(host.seen[1]?.messages)).toContain('That call was not run: the arguments are not valid JSON. Call bash again');
      expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('completed');
      // nothing named "undefined" was ever run as a command
      expect(events.some((e) => e.type === 'agent.tool_call' && e.payload.args && (e.payload.args as { command?: string }).command === 'undefined')).toBe(false);
      const commit = Bun.spawnSync(['git', '-C', repo, 'show', `stint/${(await (await Workspace.open(repo)).listTasks())[0]?.id}:NOTES.md`], { stdout: 'pipe' }).stdout.toString();
      expect(commit).toBe('checked\n');
    });
  } finally {
    host.stop();
  }
}, 60_000);

test('Four malformed tool calls in a row end the run as failed instead of looping', async () => {
  const bad = (id: string) => ({ body: rawCall('bash', 'nope', id) });
  const { host, go } = await runAgent([bad('a'), bad('b'), bad('c'), bad('d'), { body: say('unreachable') }]);
  try {
    await withFixtureRepo(async (repo) => {
      const { events } = await go(repo);
      expect(events.find((e) => e.type === 'run.finished')?.payload.endedBy).toBe('failed');
      expect(events.filter((e) => e.type === 'agent.tool_result')).toHaveLength(4);
      expect(String(events.filter((e) => e.type === 'agent.message').at(-1)?.payload.text)).toContain('4 tool calls in a row were not valid');
      expect(host.seen).toHaveLength(4);
    });
  } finally {
    host.stop();
  }
}, 60_000);
