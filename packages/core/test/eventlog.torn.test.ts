import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../src/node';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);

/** Valid lines written by one log, copied to a new path so the log there starts with no cached tail. */
async function linesOf(name: string, n: number): Promise<string[]> {
  const log = EventLog.at(join(tmp.dir, `${name}-source`, 'events.jsonl'));
  for (let i = 0; i < n; i++) await log.append({ task: 'T-0003', vendor: 'daemon', type: 'agent.message', payload: { text: `line ${i + 1}` } });
  return readFileSync(log.path, 'utf8').trim().split('\n');
}

function at(name: string, text: string): string {
  const dir = join(tmp.dir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'events.jsonl');
  writeFileSync(path, text);
  return path;
}

test('a torn last line is kept aside, cut off, and appends go on after the valid events', async () => {
  const lines = await linesOf('torn', 3);
  const torn = (lines[2] as string).slice(0, 40);
  const path = at('torn', `${lines[0]}\n${lines[1]}\n${torn}`);
  const log = EventLog.at(path);
  const e = await log.append({ task: 'T-0003', vendor: 'daemon', type: 'agent.message', payload: { text: 'after the tear' } });
  expect(e.seq).toBe(3);
  expect((await log.read()).map((x) => x.payload.text)).toEqual(['line 1', 'line 2', 'after the tear']);
  expect(await log.verify()).toEqual({ ok: true });
  const kept = readdirSync(join(tmp.dir, 'torn')).filter((n) => n.startsWith('events.jsonl.torn-'));
  expect(kept).toHaveLength(1);
  expect(readFileSync(join(tmp.dir, 'torn', kept[0] as string), 'utf8').endsWith(torn)).toBe(true);
});

test('a garbage line in the middle is skipped by read, named by verify, and warned about once', async () => {
  const lines = await linesOf('garbage', 3);
  const path = at('garbage', `${lines[0]}\n{not json\n${lines[1]}\n${lines[2]}\n`);
  const log = EventLog.at(path);
  const warnings: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string) => {
    warnings.push(String(s));
    return true;
  }) as typeof process.stderr.write;
  try {
    expect((await log.read()).map((x) => x.payload.text)).toEqual(['line 1', 'line 2', 'line 3']);
    expect((await log.read()).map((x) => x.payload.text)).toEqual(['line 1', 'line 2', 'line 3']);
  } finally {
    process.stderr.write = write;
  }
  expect(warnings.filter((w) => w.includes(path))).toHaveLength(1);
  expect(await log.verify()).toEqual({ ok: false, brokenAt: 2 });
});
