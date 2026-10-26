import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../src/node';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);

test('1,000 concurrent append calls from 8 async producers produce 1,000 lines, seq 1..1000 with no gaps, and verify() is ok', async () => {
  const log = EventLog.at(join(tmp.dir, 'T-0001', 'events.jsonl'));
  const producer = async (p: number) => {
    const pending = [];
    for (let i = 0; i < 125; i++) {
      pending.push(log.append({ task: 'T-0001', vendor: 'daemon', type: 'agent.message', payload: { producer: p, i } }));
    }
    return Promise.all(pending);
  };
  await Promise.all(Array.from({ length: 8 }, (_, p) => producer(p)));
  const lines = readFileSync(log.path, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(1000);
  expect(lines.map((l) => JSON.parse(l).seq)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  expect(await log.verify()).toEqual({ ok: true });
});
