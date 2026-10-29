import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askSession } from '../src/index';

const dirs: string[] = [];
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A `muse` on PATH that records its argv and prints a usage record when given one, then one terminal record with `text`, then exits with `code`. */
function fakeMuse(text: string, code = 0, usage?: { input_tokens: number; cached_tokens: number; output_tokens: number }): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-fake-muse-'));
  dirs.push(dir);
  const record = JSON.stringify({ stream: { kind: 'session', id: 'sess-1' }, record_type: 'event', payload_type: 'run.terminal.completed', payload: { kind: 'run_terminal', terminal: 'completed', text } });
  const used = usage ? `${JSON.stringify({ stream: { kind: 'exec.usage', id: 'u1' }, record_type: 'status', payload_type: 'run.usage', payload: { kind: 'run_usage', models: [{ model: 'muse-spark-1.3', ...usage }] } })}\n` : '';
  writeFileSync(join(dir, 'record.jsonl'), `${used}${record}\n`);
  writeFileSync(join(dir, 'muse'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv"\ncat "${dir}/record.jsonl"\nexit ${code}\n`);
  chmodSync(join(dir, 'muse'), 0o755);
  process.env.PATH = `${dir}:${path}`;
  return dir;
}

test('enrich resumes the leaving session for one structured answer and keeps the four packet fields', async () => {
  const dir = fakeMuse(JSON.stringify({ summary: 'The limiter is wired; the env read is not.', leftOut: ['the env variable', ''], risks: ['window off by one'], askOfNext: 'Read the limit from config.' }));
  const out = await askSession('sess-1', tmpdir(), 'muse-wonder-1.0');
  expect(out).toEqual({ summary: 'The limiter is wired; the env read is not.', leftOut: ['the env variable'], risks: ['window off by one'], askOfNext: 'Read the limit from config.' });
  const argv = readFileSync(join(dir, 'argv'), 'utf8').split('\n');
  expect(argv).toEqual(expect.arrayContaining(['exec', '--json', '--session-id', 'sess-1', '--model', 'muse-wonder-1.0', '--output-schema', '--max-model-steps', '3']));
  // approvals and the sandbox stay on: no bypass flag is ever passed
  expect(argv.some((a) => /yolo|dangerously|disable-approval|yes-always/.test(a))).toBe(false);
});

test('a malformed answer or a failed call gives nothing, and the packet is built from events alone', async () => {
  fakeMuse('not json');
  expect(await askSession('sess-1', tmpdir(), 'muse-spark-1.3')).toEqual({});
  fakeMuse(JSON.stringify({ summary: 'fine' }), 1);
  expect(await askSession('sess-1', tmpdir(), 'muse-spark-1.3')).toEqual({});
});

test('the question\'s tokens come back with the answer, and with an unusable answer too, since the call was paid for (D-060)', async () => {
  const usage = { input_tokens: 18420, cached_tokens: 11200, output_tokens: 390 };
  fakeMuse(JSON.stringify({ summary: 'Wired.', leftOut: [], risks: [], askOfNext: 'Run the suite.' }), 0, usage);
  expect(await askSession('sess-1', tmpdir(), 'muse-spark-1.3')).toEqual({ summary: 'Wired.', askOfNext: 'Run the suite.', cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 390, usd: null } });
  fakeMuse('not json', 0, usage);
  expect(await askSession('sess-1', tmpdir(), 'muse-spark-1.3')).toEqual({ cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 390, usd: null } });
  fakeMuse(JSON.stringify({ summary: 'fine' }), 1, usage);
  expect(await askSession('sess-1', tmpdir(), 'muse-spark-1.3')).toEqual({ cost: { inputTokens: 18420, cachedTokens: 11200, outputTokens: 390, usd: null } });
});
