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
        task: { id: 'T-0042', testCommand: 'bun run test' } as never,
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
      // the task's own test command is the one shell command the run may use without asking
      expect(wrapped[0]).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', 'muse-glimmer:30b-mlx', '--allowedTools', 'Bash(bun run test:*)']);
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

  test('the task test command is allowed as one prefix rule, and everything else still asks', () => {
    const args = claudeArgs({ testCommand: 'bun run test' });
    expect(args.slice(-2)).toEqual(['--allowedTools', 'Bash(bun run test:*)']);
    expect(args).toContain('acceptEdits');
    for (const flag of ['bypassPermissions', '--dangerously-skip-permissions', '--disallowedTools']) expect(args.join(' ')).not.toContain(flag);
    expect(claudeArgs({})).not.toContain('--allowedTools');
  });
});

describe('a real Claude Code stream (R-057)', () => {
  // Recorded 27 Oct 2026: claude -p on Muse Glimmer 30B through Ollama, in a throwaway repository and home, paths scrubbed
  const recordedPath = join(import.meta.dir, 'fixtures', 'stream.recorded.jsonl');
  const recorded = readFileSync(recordedPath, 'utf8').trim().split('\n');

  test('maps to its tool calls, their results and the closing message, with the usage and session it reported', () => {
    const m = new ClaudeMapper();
    const events = recorded.flatMap((l) => m.map(l));
    events.forEach((e, i) => expect(StintEventSchema.safeParse(asStored(e, i + 1)).success).toBe(true));
    const tally = (type: string) => events.filter((e) => e.type === type).length;
    expect(tally('agent.tool_call')).toBe(3);
    expect(tally('agent.tool_result')).toBe(3);
    expect(tally('agent.message')).toBe(1);
    // the stream's own bookkeeping (thinking-token counters, the init record) is not news for the timeline
    expect(tally('runtime.unclassified')).toBe(0);
    expect(m.sessionId).toBe('211f711e-6ae8-4100-bb7d-506a9a88652b');
    expect(m.usage).toEqual({ inputTokens: 74196, cachedTokens: 55538, outputTokens: 558 });
    expect(m.inFlight()).toBeNull();
  });

  test('Claude Code prices a local model at its own rates; Stint records a keyless local host as free and keeps the figure only on Anthropic', async () => {
    const tmp = tempDir();
    const oldPath = process.env.PATH;
    try {
      const binDir = join(tmp.dir, 'bin');
      mkdirSync(binDir);
      writeFileSync(join(binDir, 'claude'), `#!/bin/sh\ncat > /dev/null\ncat ${recordedPath}\n`);
      chmodSync(join(binDir, 'claude'), 0o755);
      process.env.PATH = `${binDir}:${oldPath ?? ''}`;
      const run = (host?: { id: string; baseURL?: string; keyless: boolean }) =>
        claudeCode('claude-code', def, host).run({
          task: { id: 'T-0042' } as never,
          run: 'r1',
          role: 'implementer',
          worktree: tmp.dir,
          prompt: 'do the task',
          promptPath: join(tmp.dir, 'prompt.md'),
          budget: { tokens: 10_000, timeoutMs: 30_000 },
          env: { PATH: `${binDir}:${oldPath ?? ''}` },
          signal: new AbortController().signal,
          emit: async () => undefined,
          transcript: async (line) => ({ pointer: 'transcript.jsonl:1', byteLen: line.length }),
        });
      expect((await run({ id: 'ollama', baseURL: 'http://localhost:11434/v1', keyless: true })).cost.usd).toBe(0);
      expect((await run({ id: 'litellm', baseURL: 'https://gateway.example/v1', keyless: false })).cost.usd).toBeNull();
      expect((await run()).cost.usd).toBe(0.0968996);
    } finally {
      process.env.PATH = oldPath;
      tmp.cleanup();
    }
  }, 60_000);
});
