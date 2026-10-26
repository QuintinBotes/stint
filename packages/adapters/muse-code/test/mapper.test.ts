import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StintEventSchema, classifyEvent } from '@stint-dev/core';
import { MuseMapper, endedBy, museArgs } from '../src/index';

const lines = readFileSync(join(import.meta.dir, 'fixtures', 'exec-run.jsonl'), 'utf8').trim().split('\n');

/** Events as the daemon would store them: the adapter's event plus the fields the log assigns. */
const asStored = (e: { type: string; payload: Record<string, unknown> }, seq: number) =>
  classifyEvent({ ...e, id: '01KAB3XQ7Z8M4N2P6R9S0T1V3W', seq, ts: '2026-10-26T15:00:00Z', task: 'T-0042', run: 'r2', adapter: 'muse-code', vendor: 'meta' as const });

describe('Muse Code mapper', () => {
  test('Mapping the recorded JSONL fixture yields events that validate and contain at least one agent.tool_call and one agent.tool_result; an injected unknown line becomes runtime.unclassified', () => {
    const m = new MuseMapper();
    const events = [...lines, JSON.stringify({ payload_type: 'muse.future_thing', payload: { x: 1 } })].flatMap((l) => m.map(l));
    events.forEach((e, i) => expect(StintEventSchema.safeParse(asStored(e, i + 1)).success).toBe(true));
    const types = events.map((e) => e.type);
    expect(types).toContain('agent.tool_call');
    expect(types).toContain('agent.tool_result');
    expect(types).toContain('agent.message');
    const unknown = events.filter((e) => e.type === 'runtime.unclassified');
    expect(unknown.at(-1)?.payload.originalType).toBe('muse.future_thing');
  });

  test('every tool call gets its result, the write names its file, and usage, session and terminal are read', () => {
    const m = new MuseMapper();
    const events = lines.flatMap((l) => m.map(l));
    const calls = events.filter((e) => e.type === 'agent.tool_call').map((e) => e.payload.callId);
    const results = events.filter((e) => e.type === 'agent.tool_result').map((e) => e.payload.callId);
    for (const c of calls) expect(results).toContain(c);
    const write = events.find((e) => e.type === 'agent.tool_result' && e.payload.tool === 'write_file');
    expect(write?.payload.args).toEqual({ path: 'test/health.test.ts' });
    expect(m.usage).toEqual({ inputTokens: 202200, cachedTokens: 144437, outputTokens: 788 });
    expect(m.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.terminal?.kind).toBe('completed');
    expect(m.inFlight()).toBeNull();
  });

  test('a killed stream leaves the started call in flight', () => {
    const m = new MuseMapper();
    const cut = lines.findIndex((l) => l.includes('"tool.result"') && l.includes('test/health.test.ts'));
    for (const l of lines.slice(0, cut)) m.map(l);
    expect(m.inFlight()).toBe('write_file');
  });

  test('endedBy: completed, capped on a step limit, killed on SIGKILL or a stop, failed otherwise', () => {
    expect(endedBy({ terminal: { kind: 'completed', reason: null }, aborted: false, signal: null, exitCode: 0 })).toBe('completed');
    expect(endedBy({ terminal: { kind: 'completed', reason: 'max model steps reached' }, aborted: false, signal: null, exitCode: 0 })).toBe('capped');
    expect(endedBy({ terminal: null, aborted: false, signal: 'SIGKILL', exitCode: null })).toBe('killed');
    expect(endedBy({ terminal: null, aborted: true, signal: null, exitCode: 1 })).toBe('killed');
    expect(endedBy({ terminal: { kind: 'failed', reason: 'provider error' }, aborted: false, signal: null, exitCode: 1 })).toBe('failed');
  });

  test('the run keeps Muse\'s approvals and sandbox on', () => {
    const args = museArgs({ promptPath: 'prompt.md', model: 'muse-spark-1.3', steps: 60 });
    for (const flag of ['--yolo', '--disable-approval', '--disable-sandbox']) expect(args).not.toContain(flag);
    expect(args).toEqual(expect.arrayContaining(['exec', '--json', '--prompt-file', 'prompt.md', '--max-model-steps', '60']));
  });
});
