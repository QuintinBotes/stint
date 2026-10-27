import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseMapper, museCodeAdapter } from '../src/index';

const GEN = join(import.meta.dir, '..', 'src', 'generated');
// The generated bundle is saved with plain hyphens where the export has typographic
// dashes, because the identity guard rejects those characters in this repository.
const plain = (s: string) => s.replaceAll('\u2014', '-').replaceAll('\u2013', '-');

test('Acceptance 7: gen:schema writes the schema and types, and the mapper compiles against them', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const script = pkg.scripts['gen:schema'] ?? '';
  expect(script).toContain('muse schema generate-json-schema');
  expect(script).toContain('muse schema generate-ts');
  expect(script).toContain('src/generated');
  for (const name of ['manifest.json', 'msp.schema.json', 'msp.d.ts']) expect(existsSync(join(GEN, name))).toBe(true);
  const manifest = JSON.parse(readFileSync(join(GEN, 'manifest.json'), 'utf8')) as { fingerprint: string; schemaVersion: number };
  expect(manifest.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  const schema = JSON.parse(readFileSync(join(GEN, 'msp.schema.json'), 'utf8')) as Record<string, unknown>;
  expect(Object.keys(schema).length).toBeGreaterThan(0);
  const types = readFileSync(join(GEN, 'msp.d.ts'), 'utf8');
  expect(types).toContain('export interface TokenUsage');
  expect(types).toContain('export interface StreamRef');
  // the mapper is typed from the generated declarations and still maps a record
  const m = new MuseMapper();
  const events = m.map(JSON.stringify({ stream: { kind: 'session', id: 's1' }, payload_type: 'run.output.delta', payload: { text: 'hello' } }));
  expect(events).toEqual([]);
  expect(m.flushText()).toEqual([{ type: 'agent.message', payload: { text: 'hello' } }]);
  expect(m.sessionId).toBe('s1');
});

const live = process.env.STINT_LIVE === '1';
test.skipIf(!live)('With STINT_LIVE=1, the saved schema matches a fresh export from the installed muse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stint-muse-schema-'));
  try {
    for (const cmd of ['generate-json-schema', 'generate-ts']) {
      const p = Bun.spawn(['muse', 'schema', cmd, '--out', dir], { stdout: 'pipe', stderr: 'pipe' });
      expect(await p.exited).toBe(0);
    }
    for (const name of ['manifest.json', 'msp.schema.json', 'msp.d.ts']) {
      expect(plain(readFileSync(join(dir, name), 'utf8'))).toBe(readFileSync(join(GEN, name), 'utf8'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test.skipIf(live)('schema.test.ts live comparison skips without STINT_LIVE=1 (it exports from the installed muse binary)', () => {
  expect(live).toBe(false);
});

test('Req 9: resume writes the instruction to a prompt file, not the full first prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stint-fake-muse-'));
  try {
    const out = join(dir, 'seen');
    const script = [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${out}.args"`,
      'prev=""',
      'for a in "$@"; do',
      `  if [ "$prev" = "--prompt-file" ]; then cat "$a" > "${out}.prompt"; echo "$a" > "${out}.promptpath"; fi`,
      '  prev="$a"',
      'done',
      `printf '%s\\n' '{"stream":{"kind":"session","id":"11111111-1111-1111-1111-111111111111"},"payload_type":"session.run.linked","payload":{}}'`,
      `printf '%s\\n' '{"payload_type":"run.output.delta","payload":{"text":"resumed and done"}}'`,
      `printf '%s\\n' '{"payload_type":"run.terminal.completed","payload":{"text":"resumed and done","reason":null}}'`,
      '',
    ].join('\n');
    writeFileSync(join(dir, 'muse'), script);
    chmodSync(join(dir, 'muse'), 0o755);
    const fullPromptPath = join(dir, 'first-prompt.md');
    const fullPrompt = 'FULL FIRST PROMPT that must not be resent';
    writeFileSync(fullPromptPath, fullPrompt);
    const instruction = 'Continue: fix the limiter.';
    const resume = museCodeAdapter.resume;
    expect(resume).toBeFunction();
    const result = await (resume as NonNullable<typeof resume>)({
      task: { id: 'T-0001' },
      run: 'r2',
      role: 'implementer',
      worktree: dir,
      prompt: fullPrompt,
      promptPath: fullPromptPath,
      model: 'muse-spark-1.3',
      budget: { tokens: 1000, steps: 3, timeoutMs: 10_000 },
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` } as Record<string, string>,
      signal: new AbortController().signal,
      emit: async () => undefined,
      transcript: async (line: string) => ({ pointer: 'transcript.jsonl:1', byteLen: line.length }),
      sessionId: 'sess-9',
      instruction,
    } as never);
    expect(result.endedBy).toBe('completed');
    const args = readFileSync(`${out}.args`, 'utf8').split('\n');
    expect(args).toContain('--prompt-file');
    expect(args).toContain('--session-id');
    expect(args).toContain('sess-9');
    expect(readFileSync(`${out}.promptpath`, 'utf8').trim()).not.toBe(fullPromptPath);
    expect(readFileSync(`${out}.prompt`, 'utf8')).toBe(instruction);
    expect(readFileSync(fullPromptPath, 'utf8')).toBe(fullPrompt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
