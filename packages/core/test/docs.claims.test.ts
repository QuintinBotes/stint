import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** Claims the README makes that a reader can check, each tied to something in the repository. */
export function readmeProblems(text: string): string[] {
  const problems: string[] = [];
  for (const path of new Set(text.match(/packages\/[\w./-]+\.test\.ts/g) ?? [])) if (!existsSync(join(root, path))) problems.push(`cites ${path}, which does not exist`);
  for (const link of new Set([...text.matchAll(/\]\(([^)#]+)\)/g)].map((m) => m[1] as string))) if (!/^https?:/.test(link) && !existsSync(join(root, link))) problems.push(`links to ${link}, which does not exist`);
  for (const img of new Set([...text.matchAll(/src="([^"]+)"/g)].map((m) => m[1] as string))) if (!existsSync(join(root, img))) problems.push(`shows ${img}, which does not exist`);
  // the killed packet's size must be the size the recording reports
  const packet = /packet is (\d+) tokens/.exec(text)?.[1];
  const recorded = [...readFileSync(join(root, 'demo', 'recording.jsonl'), 'utf8').matchAll(/"type":"handoff\.created".*?"tokens":(\d+)/g)].map((m) => m[1]);
  if (packet && !recorded.includes(packet)) problems.push(`says the packet is ${packet} tokens; the recording has ${recorded.join(', ')}`);
  return problems;
}

test('every test, link, image and packet size the README cites exists in the repository', () => {
  expect(readmeProblems(readme)).toEqual([]);
});

test('the check fails when a README number is changed by hand', () => {
  expect(readmeProblems(readme.replace(/packet is \d+ tokens/, 'packet is 99 tokens'))).toEqual([expect.stringContaining('says the packet is 99 tokens')]);
  expect(readmeProblems(`${readme}\nSee packages/daemon/test/nothing.test.ts.`)).toEqual([expect.stringContaining('nothing.test.ts')]);
});
