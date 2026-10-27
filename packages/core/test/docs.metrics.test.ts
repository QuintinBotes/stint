import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METRIC_DEFS, METRIC_IDS } from '../src/index';

const doc = readFileSync(join(import.meta.dir, '..', '..', '..', 'docs', 'metrics.md'), 'utf8');

test('R-061 Acceptance 4: every id in metrics() has a section in docs/metrics.md with that anchor, and every section is an id', () => {
  const anchors = [...doc.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1] as string);
  const headings = doc
    .split('\n')
    .filter((l) => l.startsWith('### '))
    .map((l) => l.slice(4).trim());
  expect([...anchors].sort()).toEqual([...METRIC_IDS].sort());
  expect([...headings].sort()).toEqual([...METRIC_IDS].sort());
  // The registry the projection runs from names the same ids, so docs and code cannot drift apart.
  expect(METRIC_DEFS.map((d) => d.id).sort()).toEqual([...METRIC_IDS].sort());
  for (const def of METRIC_DEFS) {
    const start = doc.indexOf(`### ${def.id}`);
    const section = doc.slice(start, doc.indexOf('\n### ', start + 1) > 0 ? doc.indexOf('\n### ', start + 1) : doc.length);
    for (const word of ['Definition:', 'Population:', 'Unit:', 'What moves it:', 'Reads:']) expect(section).toContain(word);
  }
});
