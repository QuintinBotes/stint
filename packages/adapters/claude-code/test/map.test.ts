import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentDef, StintEventSchema, classifyEvent } from '@stint-dev/core';
import { tempDir } from '../../../core/test/fixture';
import { ClaudeMapper, claudeArgs, claudeCode } from '../src/index';

// Synthetic fixture written from the documented stream-json format: https://code.claude.com/docs/en/headless
const fixture = join(import.meta.dir, 'fixtures', 'stream.synthetic.jsonl');
const lines = readFileSync(fixture, 'utf8').trim().split('\n');

const asStored = (e: { type: string; payload: Record<string, unknown> }, seq: number) =>
  classifyEvent({ ...e, id: '01KAB3XQ7Z8M4N2P6R9S0T1V3W', seq, ts: '2026-10-26T15:00:00Z', task: 'T-0042', run: 'r2', adapter: 'claude-code', vendor: 'anthropic' as const });

const def: AgentDef = {
  command: ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
  prompt: 'stdin',
  roles: ['implementer', 'reviewer'],
  vendor: 'anthropic',
  model: 'muse-glimmer:30b-mlx',
  enabled: true,
  harness: 'claude-code',
  host: 'ollama',
  env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'],
  resume: { flag: '--resume' },
  capabilities: { resume: true, schemaOutput: true, sandbox: false, costReporting: true },
};

describe('Claude Code mapper', () => {
  test('Recorded stream fixtures for each map to the expected events and a priced run', async () => {
    const m = new ClaudeMapper();
    const events = [...lines, JSON.stringify({ type: 'future_thing', x: 1 })].flatMap((l) => m.map(l));
    events.forEach((e, i) => expect(StintEventSchema.safeParse(asStored(e, i + 1)).success).toBe(true));
    expect(events.map((e) => e.type)).toEqual(['agent.message', 'agent.tool_call', 'agent.tool_result', 'agent.message', 'runtime.unclassified']);
    expect(events[1]?.payload).toMatchObject({ tool: 'Edit', callId: 'toolu_01Synthetic00000000001', args: { file_path: 'src/lib/limiter.ts' } });
    expect(events[2]?.payload).toMatchObject({ tool: 'Edit', ok: true, summary: 'The file src/lib/limiter.ts has been updated.' });
    expect(m.sessionId).toBe('11111111-2222-3333-4444-555555555555');
    expect(m.usage).toEqual({ inputTokens: 1200, cachedTokens: 400, outputTokens: 250 });
    expect(m.totalCostUsd).toBe(0.0425);
    expect(m.inFlight()).toBeNull();

    const tmp = tempDir();
    const oldPath = process.env.PATH;
    try {
      const binDir = join(tmp.dir, 'bin');
      mkdirSync(binDir);
      const fake = join(binDir, 'claude');
      writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(tmp.dir, 'args.txt')}\ncat > /dev/null\ncat ${fixture}\n`);
      chmodSync(fake, 0o755);
      process.env.PATH = `${binDir}:${oldPath ?? ''}`;
      const adapter = claudeCode('claude-code', def);
      expect(adapter.gate()).toBe('observed');
      expect(adapter.needsEnv).toEqual(['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']);
      expect(await adapter.available()).toEqual({ ok: true, version: 'claude' });
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
        env: { PATH: `${binDir}:${oldPath ?? ''}`, ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'ollama' },
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
      expect(wrapped[0]).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', 'muse-glimmer:30b-mlx']);
      expect(readFileSync(join(tmp.dir, 'args.txt'), 'utf8')).toContain('stream-json');
      expect(emitted.map((e) => e.type)).toEqual(['agent.message', 'agent.tool_call', 'agent.tool_result', 'agent.message']);
      expect(result).toMatchObject({
        endedBy: 'completed',
        sessionId: '11111111-2222-3333-4444-555555555555',
        host: 'ollama',
        model: 'muse-glimmer:30b-mlx',
        cost: { inputTokens: 1200, cachedTokens: 400, outputTokens: 250, usd: 0.0425 },
      });
    } finally {
      process.env.PATH = oldPath;
      tmp.cleanup();
    }
  }, 60_000);

  test('a stream cut mid tool call leaves that call in flight', () => {
    const m = new ClaudeMapper();
    for (const l of lines.slice(0, 2)) m.map(l);
    expect(m.inFlight()).toBe('Edit');
  });

  test('the command line keeps acceptEdits, adds the model and resume session, and never bypasses permissions', () => {
    const args = claudeArgs({ model: 'muse-glimmer:30b-mlx', sessionId: 'sess-9' });
    expect(args).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', 'muse-glimmer:30b-mlx', '--resume', 'sess-9']);
    for (const flag of ['bypassPermissions', '--dangerously-skip-permissions', '--yolo']) expect(args.join(' ')).not.toContain(flag);
  });
});
