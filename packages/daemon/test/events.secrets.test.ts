import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, RunResult } from '../src/index';
import { fakeAdapter, makeApp, newTask, post, withFixtureRepo } from './helpers';

const FAKE = ['fw', '0123456789abcdef'].join('-');

test('a line typed in the terminal and an agent\'s tool output are stored with their credentials redacted', async () => {
  const before = process.env.FIREWORKS_API_KEY;
  process.env.FIREWORKS_API_KEY = `${FAKE}-loaded`;
  try {
    await withFixtureRepo(async (repo) => {
      const leaky: Adapter = {
        ...fakeAdapter('edit'),
        async run(ctx): Promise<RunResult> {
          await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'bash', args: { command: 'cat .env' }, callId: 'c1' } });
          await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'bash', callId: 'c1', ok: true, output: { lines: [`MY_SERVICE_TOKEN: ${FAKE}`, `the key is ${FAKE}-loaded`] } } });
          return { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };
        },
      };
      const { app, ws } = await makeApp(repo, [leaky]);
      const t = await ws.createTask(newTask);
      await ws.events(t.id).append({ task: t.id, vendor: 'human', type: 'human.command', payload: { command: `export FIREWORKS_API_KEY=${FAKE}`, approximate: false } });
      await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'fake', role: 'implementer' });
      for (let i = 0; i < 300 && !(await ws.events(t.id).read()).some((e) => e.type === 'agent.tool_result'); i++) await Bun.sleep(25);
      const events = await ws.events(t.id).read();
      expect(events.find((e) => e.type === 'human.command')?.payload.command).toBe('export FIREWORKS_API_KEY=[redacted]');
      expect(events.find((e) => e.type === 'agent.tool_result')?.payload.output).toEqual({ lines: ['MY_SERVICE_TOKEN: [redacted]', 'the key is [redacted]'] });
      expect(readFileSync(join(await ws.taskDir(t.id), 'events.jsonl'), 'utf8')).not.toContain(FAKE);
      expect(await ws.events(t.id).verify()).toEqual({ ok: true });
    });
  } finally {
    if (before === undefined) delete process.env.FIREWORKS_API_KEY;
    else process.env.FIREWORKS_API_KEY = before;
  }
}, 60_000);
