import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const writeup = readFileSync(join(import.meta.dir, '..', '..', '..', 'docs', 'writeup.md'), 'utf8');

test('docs/writeup.md contains the five required parts: pitch, claims with evidence, real vs replayed, Meta tech, roadmap', () => {
  const headings = [...writeup.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  expect(headings).toEqual(expect.arrayContaining(['Pitch', 'What it proves', 'Real and replayed', 'Meta technology, where it is used', 'Roadmap']));
  // the claims table pairs every claim with its evidence
  const claims = writeup.slice(writeup.indexOf('## What it proves'), writeup.indexOf('## Real and replayed'));
  const rows = claims.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Claim') && !l.startsWith('|---'));
  expect(rows.length).toBeGreaterThanOrEqual(3);
  for (const r of rows) expect(r.split('|').filter((c) => c.trim()).length).toBeGreaterThanOrEqual(2);
});
