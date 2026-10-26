import { describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentDef, priceUsage } from '@stint-dev/core';
import { tempDir } from '../../../core/test/fixture';
import { makeApp, newTask, post, withFixtureRepo } from '../../../daemon/test/helpers';
import { ManifestMapper, agentArgv, cliAgent, cliAgents, getPath } from '../src/index';

const events: AgentDef['events'] = {
  format: 'jsonl',
  type: 'kind',
  text: 'text',
  tool: 'tool',
  args: 'args',
  callId: 'id',
  result: 'output',
  session: 'session_id',
  usage: { input: 'usage.input', output: 'usage.output', cached: 'usage.cached' },
  kinds: { message: ['message'], tool_call: ['tool_call'], tool_result: ['tool_result'], usage: ['usage'] },
};

describe('manifest events', () => {
  test('A manifest agent emitting JSONL produces mapped tool calls and a priced run', async () => {
    const tmp = tempDir();
    try {
      const script = join(tmp.dir, 'json-agent.sh');
      writeFileSync(
        script,
        [
          '#!/bin/sh',
          'cat > /dev/null',
          `echo '{"kind":"message","text":"Starting the limiter work.","session_id":"sess-1"}'`,
          `echo '{"kind":"tool_call","tool":"write_file","args":{"path":"src/app.ts"},"id":"c1","session_id":"sess-1"}'`,
          'echo "// rate limits come from loadConfig()" >> src/app.ts',
          `echo '{"kind":"tool_result","tool":"write_file","id":"c1","output":"wrote src/app.ts"}'`,
          `echo '{"kind":"mystery","text":"unknown shape"}'`,
          `echo '{"kind":"usage","usage":{"input":2000,"cached":500,"output":400},"session_id":"sess-1"}'`,
          `echo '{"kind":"message","text":"Done."}'`,
          '',
        ].join('\n'),
      );
      chmodSync(script, 0o755);
      await withFixtureRepo(async (repo) => {
        const def: AgentDef = {
          command: [script],
          prompt: 'stdin',
          roles: ['implementer'],
          vendor: 'other',
          model: 'test-model',
          enabled: true,
          harness: 'cli',
          events,
          env: ['MY_AGENT_KEY'],
        };
        const adapter = cliAgent('json-agent', def);
        expect(adapter.needsEnv).toEqual(['MY_AGENT_KEY']);
        expect(adapter.gate()).toBe('observed');
        const { app, ws } = await makeApp(repo, [adapter]);
        ws.config.prices['json-agent/test-model'] = { input: 2, cached: 0.5, output: 4 };
        const t = await ws.createTask(newTask);
        expect((await post(app, `/api/tasks/${t.id}/assign`, { adapter: 'json-agent', role: 'implementer' })).status).toBe(202);
        for (let i = 0; i < 400 && !(await ws.events(t.id).read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(50);
        const stored = await ws.events(t.id).read();
        const call = stored.find((e) => e.type === 'agent.tool_call');
        expect(call?.payload).toMatchObject({ tool: 'write_file', callId: 'c1', args: { path: 'src/app.ts' } });
        const result = stored.find((e) => e.type === 'agent.tool_result');
        expect(result?.payload).toMatchObject({ tool: 'write_file', callId: 'c1', ok: true, summary: 'wrote src/app.ts' });
        expect(stored.filter((e) => e.type === 'agent.message').map((e) => e.payload.text)).toEqual(['Starting the limiter work.', 'Done.']);
        expect(stored.some((e) => e.type === 'runtime.unclassified' && e.payload.originalType === 'mystery')).toBe(true);
        const finished = stored.find((e) => e.type === 'run.finished');
        const expected = priceUsage({ input: 2, cached: 0.5, output: 4 }, { inputTokens: 2000, cachedTokens: 500, outputTokens: 400 });
        expect(expected).not.toBeNull();
        expect(finished?.payload).toMatchObject({ endedBy: 'completed', sessionId: 'sess-1', cost: { inputTokens: 2000, cachedTokens: 500, outputTokens: 400, usd: expected } });
        expect(stored.some((e) => e.type === 'cost.unpriced')).toBe(false);
      });
    } finally {
      tmp.cleanup();
    }
  }, 120_000);

  test('the mapper reads dotted paths, keeps unknown kinds unclassified, and names the in-flight call', () => {
    expect(getPath({ a: { b: [{ c: 7 }] } }, 'a.b.0.c')).toBe(7);
    const m = new ManifestMapper(events as NonNullable<AgentDef['events']>);
    expect(m.map('not json')).toEqual([{ type: 'runtime.unclassified', payload: { originalType: 'unparsable', excerpt: 'not json' } }]);
    m.map('{"kind":"tool_call","tool":"bash","args":{"command":"bun test"},"id":"c9","session_id":"s2"}');
    expect(m.inFlight()).toBe('bash');
    expect(m.sessionId).toBe('s2');
    m.map('{"kind":"usage","usage":{"input":10,"output":3}}');
    expect(m.usage).toEqual({ inputTokens: 10, cachedTokens: 0, outputTokens: 3 });
    expect(m.map('{"kind":"later","x":1}')[0]?.payload.originalType).toBe('later');
  });

  test('cliAgents builds only the cli harness, and permissions flags are added to the command line', () => {
    const base = { prompt: 'stdin' as const, roles: ['implementer' as const], vendor: 'other' as const, enabled: true };
    const built = cliAgents({
      agents: {
        plain: { ...base, command: ['plain-bin'], harness: 'cli' },
        native: { ...base, command: ['claude'], harness: 'claude-code' },
        off: { ...base, command: ['off-bin'], harness: 'cli', enabled: false },
      },
    });
    expect(built.map((a) => a.id)).toEqual(['plain']);
    const def: AgentDef = { command: ['agent'], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'cli', permissions: { flags: ['--read-only'] } };
    expect(agentArgv(def, { prompt: 'do it', promptPath: '/w/prompt.md' })).toEqual(['agent', '--read-only']);
  });

  test('a direct run goes through ctx.wrap, the run sandbox', async () => {
    const tmp = tempDir();
    try {
      const script = join(tmp.dir, 'plain.sh');
      writeFileSync(script, '#!/bin/sh\ncat > /dev/null\necho hello\n');
      chmodSync(script, 0o755);
      const def: AgentDef = { command: [script], prompt: 'stdin', roles: ['implementer'], vendor: 'other', enabled: true, harness: 'cli' };
      const seen: string[][] = [];
      const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const result = await cliAgent('plain', def).run({
        task: { id: 'T-0042' } as never,
        run: 'r1',
        role: 'implementer',
        worktree: tmp.dir,
        prompt: 'do it',
        promptPath: join(tmp.dir, 'prompt.md'),
        budget: { tokens: 1000 },
        env: { PATH: process.env.PATH ?? '' },
        wrap: (argv) => {
          seen.push(argv);
          return argv;
        },
        signal: new AbortController().signal,
        emit: async (e) => {
          emitted.push(e);
        },
        transcript: async (line) => ({ pointer: 'transcript.jsonl:1', byteLen: line.length }),
      });
      expect(seen).toEqual([[script]]);
      expect(result.endedBy).toBe('completed');
      expect(emitted.map((e) => e.payload.text)).toEqual(['hello']);
    } finally {
      tmp.cleanup();
    }
  });
});
