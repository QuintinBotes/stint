import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog, GENESIS } from '../src/node';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);

async function filled(name: string, n: number) {
  const log = EventLog.at(join(tmp.dir, name, 'events.jsonl'));
  for (let i = 0; i < n; i++) await log.append({ task: 'T-0002', vendor: 'daemon', type: 'agent.message', payload: { text: `line ${i + 1}` } });
  return log;
}

describe('the hash chain', () => {
  test('Flipping one byte in line 500 makes verify() return { ok: false, brokenAt: 500 }', async () => {
    const log = await filled('flip', 600);
    expect(await log.verify()).toEqual({ ok: true });
    const lines = readFileSync(log.path, 'utf8').split('\n');
    const line = lines[499] as string;
    const at = line.indexOf('line 500');
    lines[499] = `${line.slice(0, at)}line 501${line.slice(at + 'line 500'.length)}`;
    writeFileSync(log.path, lines.join('\n'));
    expect(await log.verify()).toEqual({ ok: false, brokenAt: 500 });
  });

  test('the first row links to the genesis hash and each row to the one before', async () => {
    const log = await filled('links', 3);
    const rows = await log.read();
    expect(rows[0]?.prev).toBe(GENESIS);
    expect(rows[1]?.prev).toBe(rows[0]?.hash as string);
    expect((await log.read({ since: 2 })).map((e) => e.seq)).toEqual([3]);
  });

  test('a deleted row breaks the chain at the row after it', async () => {
    const log = await filled('delete', 5);
    const lines = readFileSync(log.path, 'utf8').trim().split('\n');
    lines.splice(2, 1);
    writeFileSync(log.path, `${lines.join('\n')}\n`);
    expect(await log.verify()).toEqual({ ok: false, brokenAt: 3 });
  });

  test('an unknown event type is kept as runtime.unclassified, never dropped', async () => {
    const log = EventLog.at(join(tmp.dir, 'unknown', 'events.jsonl'));
    const e = await log.append({ task: 'T-0002', type: 'muse.compaction', payload: { tokens: 9 } });
    expect(e.type).toBe('runtime.unclassified');
    expect(e.payload.originalType).toBe('muse.compaction');
  });
});
