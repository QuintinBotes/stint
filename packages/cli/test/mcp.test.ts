import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, withFixtureRepo } from '../../daemon/test/helpers';

/** An MCP client over the server's stdio, one request at a time, as an agent would talk to it. */
function client(repo: string, env: Record<string, string> = {}) {
  const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), 'mcp', '--repo', repo], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  const reader = p.stdout.getReader();
  let buffer = '';
  let next = 1;
  const read = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        return JSON.parse(line) as Record<string, unknown>;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('the server closed its output');
      buffer += new TextDecoder().decode(value);
    }
  };
  const send = (msg: Record<string, unknown>) => {
    p.stdin.write(`${JSON.stringify(msg)}\n`);
    p.stdin.flush();
  };
  return {
    request: async (method: string, params: Record<string, unknown> = {}) => {
      const id = next++;
      send({ jsonrpc: '2.0', id, method, params });
      return read();
    },
    notify: (method: string) => send({ jsonrpc: '2.0', method }),
    tool: async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await (async () => {
        const id = next++;
        send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
        return read();
      })()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
      return { text: r.result.content[0]?.text ?? '', isError: !!r.result.isError };
    },
    close: () => {
      p.stdin.end();
      p.kill();
    },
  };
}

test('stint mcp speaks MCP over stdio: initialize, list tools without approve, create a task, read the board, record a decision, read it back', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
    const c = client(repo);
    try {
      const init = (await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })) as { result: { serverInfo: { name: string }; capabilities: { tools: unknown } } };
      expect(init.result.serverInfo.name).toBe('stint');
      expect(init.result.capabilities.tools).toBeDefined();
      c.notify('notifications/initialized');

      const list = (await c.request('tools/list')) as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } };
      const names = list.result.tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['stint_status', 'stint_task', 'stint_new_task', 'stint_packet', 'stint_similar', 'stint_constraints', 'stint_decide', 'stint_hand', 'stint_autopilot', 'stint_verify']));
      // merging stays with a person
      expect(names.some((n) => /approve|reject|merge/.test(n))).toBe(false);
      for (const t of list.result.tools) expect(t.inputSchema.type).toBe('object');

      const created = await c.tool('stint_new_task', { title: 'Rate-limit the admin API', acceptance: ['429 with Retry-After'] });
      expect(created.isError).toBe(false);
      const id = /Created (T-\d+)/.exec(created.text)?.[1] as string;
      expect((await c.tool('stint_status')).text).toContain(`${id} [planned] Rate-limit the admin API`);

      expect((await c.tool('stint_decide', { task: id, text: 'Read limits through loadConfig()' })).text).toBe(`Recorded D1 on ${id}: Read limits through loadConfig()`);
      const task = await c.tool('stint_task', { task: id });
      expect(task.text).toContain('- D1: Read limits through loadConfig()');
      expect(task.text).toContain('- 429 with Retry-After');

      // errors come back as tool results the agent can read, not as crashes
      const noPacket = await c.tool('stint_packet', { task: id });
      expect(noPacket).toMatchObject({ isError: true, text: `${id} has no packet yet. Every run that ends builds one.` });
      expect((await c.tool('stint_approve', { task: id })).isError).toBe(true);
      expect((await c.request('nonsense')) as { error: { code: number } }).toMatchObject({ error: { code: -32601 } });
    } finally {
      c.close();
      await d.stop();
    }
  });
}, 120_000);

test('inside a Stint run the task defaults to the run\'s task, and with no daemon the tools say how to start one', async () => {
  await withFixtureRepo(async (repo) => {
    const c = client(repo, { STINT_TASK: 'T-0042' });
    try {
      await c.request('initialize', {});
      const r = await c.tool('stint_task');
      expect(r.isError).toBe(true);
      expect(r.text).toContain('No Stint daemon is running for');
      expect(r.text).toContain('stint up');
    } finally {
      c.close();
    }
  });
}, 60_000);
