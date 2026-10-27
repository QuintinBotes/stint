import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { countTokens, renderHandoff } from '../src/index';
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
  problems.push(...measuredProblems(text));
  return problems;
}

type Mode = { runs: number; meanPromptTokens: number; meanInputTokens: number; meanUsd: number | null; passRate: number };
const json = <T>(path: string) => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
const n = (s: string) => Number(s.replace(/[,$]/g, ''));

/** The live numbers the README quotes, each checked against the result file it came from (R-056). */
export function measuredProblems(text: string): string[] {
  const problems: string[] = [];
  const bench = json<{ byMode: Record<string, Mode> }>('bench/results.json');
  const digest = json<{ byMode: Record<string, Mode> }>('bench/digest/results.json');
  const rows: Array<[string, Mode | undefined]> = [
    ['the transcript', bench.byMode.transcript],
    ['the packet', bench.byMode.packet],
    ['the packet with the diff digest', digest.byMode.packet],
  ];
  for (const [label, m] of rows) {
    const row = new RegExp(`^\\| ${label} \\| ([\\d,]+) tokens \\| ([\\d,]+) \\| \\$([\\d.]+) \\| (\\d+) of (\\d+) \\|$`, 'm').exec(text);
    if (!row || !m) {
      problems.push(`the bench table has no row for ${label}`);
      continue;
    }
    const [, prompt, input, usd, passed, runs] = row as unknown as string[];
    if (n(prompt as string) !== Math.round(m.meanPromptTokens)) problems.push(`${label}: hand-over prompt ${prompt}, results say ${Math.round(m.meanPromptTokens)}`);
    if (n(input as string) !== Math.round(m.meanInputTokens)) problems.push(`${label}: input ${input}, results say ${Math.round(m.meanInputTokens)}`);
    if (m.meanUsd === null || Math.abs(n(usd as string) - m.meanUsd) > 0.0005 + 1e-9) problems.push(`${label}: cost $${usd}, results say ${m.meanUsd}`);
    if (Number(passed) !== Math.round(m.passRate * m.runs) || Number(runs) !== m.runs) problems.push(`${label}: ${passed} of ${runs} green, results say ${Math.round(m.passRate * m.runs)} of ${m.runs}`);
  }
  const golden = json<{ passAt1: number; passPowK: number; k: number; cost: { usd: number }; tasks: Array<{ runs: unknown[] }> }>('bench/golden-results.json');
  const tries = golden.tasks.reduce((s, t) => s + t.runs.length, 0);
  const line = /The golden set: (\d+) of (\d+) tries passed, pass\^(\d+) (\d+)%, \$([\d.]+)/.exec(text);
  if (!line) problems.push('the golden line is missing');
  else {
    const [, ok, all, k, powk, usd] = line;
    if (Number(all) !== tries || Number(ok) !== Math.round(golden.passAt1 * tries)) problems.push(`golden: ${ok} of ${all}, results say ${Math.round(golden.passAt1 * tries)} of ${tries}`);
    if (Number(k) !== golden.k || Number(powk) !== Math.round(golden.passPowK * 100)) problems.push(`golden: pass^${k} ${powk}%, results say pass^${golden.k} ${Math.round(golden.passPowK * 100)}%`);
    if (Math.abs(Number(usd) - golden.cost.usd) > 0.005 + 1e-9) problems.push(`golden: $${usd}, results say ${golden.cost.usd}`);
  }
  // the live packet shown inline is the stored one, rendered, at the size the README says
  const shown = /<summary>The live packet, as the next agent read it<\/summary>\n\n```\n([\s\S]*?)```/.exec(text)?.[1];
  const stored = renderHandoff(json('bench/digest/runs/bench-01-rate-limit-packet/handoff.json'));
  if (shown === undefined || shown.trimEnd() !== stored.trimEnd()) problems.push('the live packet in the README is not the stored one, rendered');
  const said = /from these (\d+) tokens/.exec(text)?.[1];
  if (Number(said) !== countTokens(stored)) problems.push(`says the live packet is ${said} tokens; it renders to ${countTokens(stored)}`);
  return problems;
}

test('every test, link, image and packet size the README cites exists in the repository', () => {
  expect(readmeProblems(readme)).toEqual([]);
});

test('the measured numbers fail the check when one is changed by hand', () => {
  expect(measuredProblems(readme)).toEqual([]);
  expect(measuredProblems(readme.replace('| 4,418 tokens |', '| 4,000 tokens |'))).toEqual([expect.stringContaining('hand-over prompt 4,000')]);
  expect(measuredProblems(readme.replace(/9 of 9 tries/, '8 of 9 tries'))).toEqual([expect.stringContaining('golden: 8 of 9')]);
  expect(measuredProblems(readme.replace('from these 394 tokens', 'from these 300 tokens'))).toEqual([expect.stringContaining('300 tokens')]);
});

test('the check fails when a README number is changed by hand', () => {
  expect(readmeProblems(readme.replace(/packet is \d+ tokens/, 'packet is 99 tokens'))).toEqual([expect.stringContaining('says the packet is 99 tokens')]);
  expect(readmeProblems(`${readme}\nSee packages/daemon/test/nothing.test.ts.`)).toEqual([expect.stringContaining('nothing.test.ts')]);
});
