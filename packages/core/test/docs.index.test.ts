import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const docs = join(import.meta.dir, '..', '..', '..', 'docs');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [relative(docs, full)];
  });
}

test('R-058 Acceptance 5: docs/README.md lists every file under docs/ and nothing else', () => {
  const index = readFileSync(join(docs, 'README.md'), 'utf8');
  const listed = [...index.matchAll(/^- \[`([^`]+)`\]\(([^)]+)\): \S/gm)].map((m) => {
    expect(m[1]).toBe(m[2] as string);
    return m[1] as string;
  });
  const present = files(docs).filter((f) => f !== 'README.md');
  expect([...listed].sort()).toEqual([...present].sort());
  for (const f of listed) expect(existsSync(join(docs, f))).toBe(true);
  expect(index).not.toMatch(/arrives? in R-/);
});
