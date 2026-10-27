import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentDef, StintEventSchema, classifyEvent, priceUsage } from '@stint-dev/core';
import { priceKey } from '@stint-dev/daemon';
import { tempDir } from '../../../core/test/fixture';
import { CodexMapper, codex, codexArgs } from '../src/index';

// Synthetic fixture written from the documented JSONL format: https://developers.openai.com/codex/noninteractive
const fixture = join(import.meta.dir, 'fixtures', 'stream.synthetic.jsonl');
const lines = readFileSync(fixture, 'utf8').trim().split('\n');

const asStored = (e: { type: string; payload: Record<string, unknown> }, seq: number) =>
  classifyEvent({ ...e, id: '01KAB3XQ7Z8M4N2P6R9S0T1V3W', seq, ts: '2026-10-26T15:00:00Z', task: 'T-0042', run: 'r2', adapter: 'codex', vendor: 'openai' as const });

const def: AgentDef = {
  command: ['codex', 'exec', '--json', '--sandbox', 'workspace-write', '-'],
  prompt: 'stdin',
  roles: ['implementer', 'reviewer'],
  vendor: 'openai',
  model: 'test-model',
  enabled: true,
  harness: 'codex',
  env: ['OPENAI_API_KEY'],
  resume: { flag: 'resume' },
  capabilities: { resume: true, schemaOutput: true, sandbox: true, costReporting: true },
};

describe('Codex mapper', () => {
  test('Recorded stream fixtures for each map to the expected events and a priced run', async () => {
    const m = new CodexMapper();
    const events = [...lines, JSON.stringify({ type: 'future.thing' })].flatMap((l) => m.map(l));
    events.forEach((e, i) => expect(StintEventSchema.safeParse(asStored(e, i + 1)).success).toBe(true));
    expect(events.map((e) => e.type)).toEqual([
      'agent.tool_call',
      'agent.tool_result',
      'agent.tool_call',
      'agent.tool_result',
      'agent.tool_call',
      'agent.tool_result',
      'agent.message',
      'runtime.unclassified',
    ]);
    expect(events[0]?.payload).toMatchObject({ tool: 'command_execution', callId: 'item_1', args: { command: 'bun test' } });
    expect(events[1]?.payload).toMatchObject({ tool: 'command_execution', ok: true, summary: '27 pass, 0 fail' });
    expect(events[3]?.payload).toMatchObject({ tool: 'file_change', summary: 'src/lib/limiter.ts' });
    expect(events[4]?.payload).toMatchObject({ tool: 'stint/task', args: { id: 'T-0042' } });
    expect(m.threadId).toBe('thread-synthetic-0001');
    expect(m.usage).toEqual({ inputTokens: 3000, cachedTokens: 1000, outputTokens: 500 });
    expect(m.inFlight()).toBeNull();

    const tmp = tempDir();
    const oldPath = process.env.PATH;
    try {
      const binDir = join(tmp.dir, 'bin');
      mkdirSync(binDir);
      const fake = join(binDir, 'codex');
      writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(tmp.dir, 'args.txt')}\ncat > /dev/null\ncat ${fixture}\n`);
      chmodSync(fake, 0o755);
      process.env.PATH = `${binDir}:${oldPath ?? ''}`;
      const adapter = codex('codex', def);
      expect(adapter.gate()).toBe('observed');
      expect(adapter.needsEnv).toEqual(['OPENAI_API_KEY']);
      expect(await adapter.available()).toEqual({ ok: true, version: 'codex' });
      const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const wrapped: string[][] = [];
      const result = await adapter.run({
        task: { id: 'T-0042' } as never,
        run: 'r1',
        role: 'implementer',
        worktree: tmp.dir,
        prompt: 'do the task',
        promptPath: join(tmp.dir, 'prompt.md'),
        budget: { tokens: 10_000, timeoutMs: 30_000 },
        env: { PATH: `${binDir}:${oldPath ?? ''}`, OPENAI_API_KEY: 'test-key' },
        wrap: (argv) => {
          wrapped.push(argv);
          return argv;
        },
        signal: new AbortController().signal,
        emit: async (e) => {
          emitted.push(e);
        },
        transcript: async (line) => ({ pointer: 'transcript.jsonl:1', byteLen: line.length }),
      });
      expect(wrapped[0]).toEqual(['codex', 'exec', '--json', '--sandbox', 'workspace-write', '--model', 'test-model', '-']);
      expect(readFileSync(join(tmp.dir, 'args.txt'), 'utf8')).toContain('workspace-write');
      expect(emitted.filter((e) => e.type === 'agent.tool_call')).toHaveLength(3);
      expect(result).toMatchObject({ endedBy: 'completed', sessionId: 'thread-synthetic-0001', model: 'test-model', cost: { inputTokens: 3000, cachedTokens: 1000, outputTokens: 500, usd: null } });
      // The daemon prices usage with no reported cost under <agent>/<model>.
      expect(priceKey('codex', result.host, result.model)).toBe('codex/test-model');
      expect(priceUsage({ input: 2, cached: 0.5, output: 4 }, result.cost)).toBe(0.0065);
    } finally {
      process.env.PATH = oldPath;
      tmp.cleanup();
    }
  }, 60_000);

  test('a stream cut mid item leaves that call in flight, and a failed turn is reported', () => {
    const m = new CodexMapper();
    for (const l of lines.slice(0, 3)) m.map(l);
    expect(m.inFlight()).toBe('command_execution');
    const failed = new CodexMapper();
    const out = failed.map('{"type":"turn.failed","error":{"message":"the model stopped"}}');
    expect(failed.failed).toBe(true);
    expect(out[0]?.payload).toMatchObject({ text: 'the model stopped', stderr: true });
  });

  test('resume names the thread, and the command line never turns the sandbox off', () => {
    expect(codexArgs({ threadId: 'thread-9' })).toEqual(['codex', 'exec', 'resume', '--json', '--sandbox', 'workspace-write', 'thread-9', '-']);
    const args = codexArgs({});
    for (const flag of ['--full-auto', 'danger-full-access', '--yolo']) expect(args.join(' ')).not.toContain(flag);
  });
});

describe('a real Codex stream (R-057)', () => {
  // Recorded 27 Oct 2026: codex exec on Muse Spark 1.3 through the Meta Model API's Responses endpoint, in a throwaway
  // repository and home, paths scrubbed. Codex speaks only the Responses API now, which the Meta Model API serves.
  const recorded = readFileSync(join(import.meta.dir, 'fixtures', 'stream.recorded.jsonl'), 'utf8').trim().split('\n');

  test('maps to its messages, the command and the file change with their results, and the usage and thread it reported', () => {
    const m = new CodexMapper();
    const events = recorded.flatMap((l) => m.map(l));
    events.forEach((e, i) => expect(StintEventSchema.safeParse(asStored(e, i + 1)).success).toBe(true));
    expect(events.filter((e) => e.type === 'agent.tool_call').map((e) => e.payload.tool)).toEqual(['command_execution', 'file_change']);
    expect(events.filter((e) => e.type === 'agent.tool_result').every((e) => e.payload.ok === true)).toBe(true);
    expect(events.filter((e) => e.type === 'agent.message')).toHaveLength(3);
    // Codex's warning that it has no metadata for the model is kept, unclassified, and does not fail the run
    expect(events.filter((e) => e.type === 'runtime.unclassified')).toHaveLength(1);
    expect(m.usage).toEqual({ inputTokens: 29819, cachedTokens: 19411, outputTokens: 653 });
    expect(m.threadId).toBe('01a17d75-d23c-7b90-b601-a363a900f545');
    expect(m.failed).toBe(false);
    expect(m.inFlight()).toBeNull();
  });
});
