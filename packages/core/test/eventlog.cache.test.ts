import { afterAll, expect, spyOn, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../src/node';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);

const say = (log: EventLog, text: string) => log.append({ task: 'T-0004', vendor: 'daemon', type: 'agent.message', payload: { text } });

test('a second read with no append parses nothing, and what it returns cannot change the next read', async () => {
  const log = EventLog.at(join(tmp.dir, 'cached', 'events.jsonl'));
  for (const t of ['one', 'two', 'three']) await say(log, t);
  const first = await log.read();
  const parse = spyOn(JSON, 'parse');
  try {
    const second = await log.read();
    expect(parse).toHaveBeenCalledTimes(0);
    expect(second).toEqual(first);
    second.length = 0;
    expect(await log.read({ since: 1 })).toHaveLength(2);
  } finally {
    parse.mockRestore();
  }
});

test('an append is in the next read, and a write made outside the daemon is picked up', async () => {
  const log = EventLog.at(join(tmp.dir, 'outside', 'events.jsonl'));
  for (const t of ['one', 'two', 'three']) await say(log, t);
  await log.read();
  await say(log, 'four');
  expect((await log.read()).map((e) => e.payload.text)).toEqual(['one', 'two', 'three', 'four']);
  // someone edits the file by hand: the cache no longer matches its size and time, so it is read again
  const lines = readFileSync(log.path, 'utf8').trim().split('\n');
  writeFileSync(log.path, `${lines.slice(0, 2).join('\n')}\n`);
  expect((await log.read()).map((e) => e.payload.text)).toEqual(['one', 'two']);
});
