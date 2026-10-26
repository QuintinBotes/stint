import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DecisionLedger } from '../src/node';
import { tempDir } from './fixture';

const tmp = tempDir();
afterAll(tmp.cleanup);

test('A superseding decision sets validTo on the superseded one and both remain in the file', async () => {
  const ledger = new DecisionLedger(join(tmp.dir, 'decisions.md'), 'T-0042');
  const d1 = await ledger.append({ text: 'Count per tenant, not per source IP', by: 'meta-api/muse-wonder-1.0 r1' });
  const d2 = await ledger.append({ text: 'Fixed window counter', by: 'muse-code r2', evidence: ['T-0042/r2#ev1'] });
  await Bun.sleep(5);
  const d3 = await ledger.append({ text: 'Sliding window over fixed window', supersedes: 'D2', by: 'muse-code r2' });
  expect([d1.id, d2.id, d3.id]).toEqual(['D1', 'D2', 'D3']);

  const all = await ledger.read();
  expect(all.map((d) => d.id)).toEqual(['D1', 'D2', 'D3']);
  expect(all[1]?.validTo).toBe(d3.recordedAt);
  expect(all[1]?.evidence).toEqual(['T-0042/r2#ev1']);
  expect(all[0]?.validTo).toBeNull();
  expect(all[2]).toMatchObject({ supersedes: 'D2', validTo: null, text: 'Sliding window over fixed window' });

  const text = readFileSync(join(tmp.dir, 'decisions.md'), 'utf8');
  expect(text).toContain('Fixed window counter');
  expect(text).toContain('supersedes: D2');
  expect((await ledger.validAt()).map((d) => d.id)).toEqual(['D1', 'D3']);
  expect((await ledger.validAt(d2.recordedAt)).map((d) => d.id)).toEqual(['D1', 'D2']);
  await expect(ledger.append({ text: 'x', supersedes: 'D9', by: 'human' })).rejects.toThrow('D9');
});
