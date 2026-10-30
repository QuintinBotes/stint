import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { mkdirSync, writeFileSync } from 'node:fs';
import { flowConfig, startFakeModels } from '../../../apps/web/e2e/flows/fakes';
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

test('inside a Stint run the server lists only the tools the run token can call, and those work', async () => {
  await withFixtureRepo(async (repo) => {
    const agent = fakeAdapter('sleep');
    const d = await startDaemon({ root: repo, quiet: true, adapters: [agent] });
    const headers = { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' };
    try {
      const t = await d.ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429.', acceptance: ['429'], testCommand: 'true' });
      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers, body: JSON.stringify({ adapter: 'fake', role: 'implementer' }) });
      for (let i = 0; i < 200 && !agent.seen[0]; i++) await Bun.sleep(25);
      const env = agent.seen[0]?.env as Record<string, string>;
      expect(env.STINT_RUN_TOKEN).toMatch(/^[0-9a-f]{32,}$/);
      const c = client(repo, { STINT_RUN_TOKEN: env.STINT_RUN_TOKEN as string, STINT_DAEMON_PORT: env.STINT_DAEMON_PORT as string, STINT_TASK: t.id, STINT_RUN: 'r1' });
      try {
        await c.request('initialize', {});
        const list = (await c.request('tools/list')) as { result: { tools: Array<{ name: string }> } };
        expect(list.result.tools.map((x) => x.name)).toEqual(['stint_status', 'stint_task', 'stint_packet', 'stint_similar', 'stint_constraints', 'stint_files_together', 'stint_decide', 'stint_autopilot']);
        expect(await c.tool('stint_decide', { text: 'Keep the limiter in memory' })).toEqual({ isError: false, text: `Recorded D1 on ${t.id}: Keep the limiter in memory` });
        expect(await c.tool('stint_autopilot', { on: false })).toEqual({ isError: false, text: `${t.id} is off autopilot; a live run keeps going.` });
        expect((await c.tool('stint_verify')).isError).toBe(true);
      } finally {
        c.close();
      }
    } finally {
      await d.stop();
    }
  });
}, 120_000);

test('From a harness, a goal is made, split into tasks that wait on each other, and run; and a live run is stopped for its packet', async () => {
  const models = startFakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port)));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('sleep'), id: 'muse-code' }] });
      const c = client(repo);
      try {
        await c.request('initialize', {});
        const made = await c.tool('stint_new_goal', { title: 'Reliable webhook delivery', outcome: 'Webhooks are limited per tenant and retried.', criteria: ['A tenant over the limit gets 429', 'A failed delivery is retried with backoff'] });
        expect(made).toEqual({ isError: false, text: 'Made G-0001, Reliable webhook delivery, with 2 criteria. Split it into tasks with stint_plan_goal.' });
        const split = await c.tool('stint_plan_goal', { goal: 'G-0001' });
        expect(split.isError).toBe(false);
        expect(split.text.split('\n')).toEqual([
          'G-0001 is split into 2 tasks:',
          '- T-0001 Part 1: A tenant over the limit gets 429',
          '- T-0002 Part 2: A failed delivery is retried with backoff, after T-0001',
          'Run them with stint_run_goal.',
        ]);
        expect((await c.tool('stint_stop', { task: 'T-0001' })).text).toBe('T-0001 has no run going');

        const ran = await c.tool('stint_run_goal', { goal: 'G-0001' });
        expect(ran.text).toStartWith('G-0001: T-0001');
        for (let i = 0; i < 400 && !(await d.ws.events('T-0001').read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(25);
        expect((await c.tool('stint_stop', { task: 'T-0001' })).text).toMatch(/^Stopped T-0001 r\d+\. Its packet is built from the log and the diff; hand it on with stint_hand\.$/);
        for (let i = 0; i < 400 && !(await d.ws.events('T-0001').read()).some((e) => e.type === 'run.finished' && e.payload.endedBy === 'killed'); i++) await Bun.sleep(25);
        expect((await d.ws.events('T-0001').read()).some((e) => e.type === 'run.finished' && e.payload.endedBy === 'killed')).toBe(true);
      } finally {
        c.close();
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 90_000);
