import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStintAgent } from '../src/index';
import { callTool, configFor, fakeHost, say } from './fake';

test("a Stint agent run's transcript holds each tool's whole output beside the model's responses", async () => {
  const wt = mkdtempSync(join(tmpdir(), 'stint-transcript-'));
  writeFileSync(join(wt, 'notes.txt'), 'line one\nline two\n');
  const host = fakeHost([{ body: callTool('read_file', { path: 'notes.txt' }) }, { body: say('done') }]);
  try {
    const lines: string[] = [];
    await createStintAgent(configFor({ 'meta-api': host.url }), { META_API_KEY: 'k' }).run({
      task: {} as never,
      run: 'r1',
      role: 'implementer',
      worktree: wt,
      prompt: 'p',
      promptPath: join(wt, 'p.md'),
      budget: { tokens: 1e6 },
      env: { PATH: process.env.PATH ?? '' },
      signal: new AbortController().signal,
      emit: async () => undefined,
      transcript: async (line) => {
        lines.push(line);
        return { pointer: String(lines.length), byteLen: line.length };
      },
    });
    const records = lines.map((l) => JSON.parse(l) as { kind: string; output?: string; tool?: string });
    expect(records.filter((r) => r.kind === 'response').length).toBeGreaterThanOrEqual(2);
    const result = records.find((r) => r.kind === 'tool_result');
    expect(result).toMatchObject({ tool: 'read_file' });
    expect(result?.output).toContain('line two');
  } finally {
    host.stop();
    rmSync(wt, { recursive: true, force: true });
  }
});
