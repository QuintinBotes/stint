import { expect, test } from 'bun:test';
import { type BenchRowFile, buildResults, formatSummary, heldOut } from '../src/bench/results';

const row = (mode: 'transcript' | 'packet', inputTokens: number, verified: boolean, extra: Partial<BenchRowFile> = {}): BenchRowFile => ({
  task: `bench-0${inputTokens % 7}`,
  mode,
  host: 'baseten',
  model: 'muse-spark-1.3',
  inputTokens,
  cachedTokens: 0,
  outputTokens: 100,
  usd: inputTokens / 1_000_000,
  wallMs: 1000,
  verified,
  promptTokens: inputTokens / 2,
  repeat: 1,
  ...extra,
});

test('R-021 Req 4: the one-screen summary gives each mode its mean input, mean USD and pass rate, the ratio, and names the fields to fix when packets lose', () => {
  const results = buildResults({
    replay: true,
    rows: [
      row('transcript', 40_000, true),
      row('transcript', 60_000, true),
      row('packet', 8_000, true),
      row('packet', 12_000, false),
      row('packet', 3_000, true, { leg: 'review' }),
    ],
  });
  expect(formatSummary(results)).toEqual([
    'Bench results (replay): 4 continued runs, implementer muse-code, continuer stint-agent',
    "transcript 2 runs, mean input 50000 tokens, mean prompt 25000 tokens, mean $0.0500, the daemon's verdict green 100%",
    "packet     2 runs, mean input 10000 tokens, mean prompt 5000 tokens, mean $0.0100, the daemon's verdict green 50%",
    'review leg 1 runs, mean input 3000 tokens, mean $0.0030, pass rate 100%',
    'Ratio (transcript over packet mean input tokens): 5.00x',
    'Packet mode passed less often than transcript mode: leftOut and askOfNext are the fields to improve.',
  ]);
});

test('R-021 Req 4: with one mode there is no ratio and no comparison sentence', () => {
  const lines = formatSummary(buildResults({ replay: false, rows: [row('packet', 8_000, false, { usd: null })] }));
  expect(lines.slice(1)).toEqual(["packet     1 runs, mean input 8000 tokens, mean prompt 4000 tokens, mean unpriced, the daemon's verdict green 0%", 'Ratio: not available (it needs both modes)']);
  expect(lines[0]).toBe('Bench results (live): 1 continued runs, implementer muse-code, continuer stint-agent');
});

test('a run the daemon held red whose held-out tests all passed is graded green on them, and the summary names the verdict and the held-out tests apart', () => {
  const results = buildResults({ replay: false, rows: [row('packet', 8_000, false, heldOut(false, { passed: 5, failed: 0 })), row('packet', 9_000, true, heldOut(true, { passed: 4, failed: 1 }))] });
  expect(results.rows.map((r) => [r.hidden, r.result])).toEqual([
    ['green', "the daemon's verdict red; held-out tests passed 5 of 5"],
    ['red', "the daemon's verdict green; held-out tests passed 4 of 5"],
  ]);
  expect(formatSummary(results)[1]).toBe("packet     2 runs, mean input 8500 tokens, mean prompt 4250 tokens, mean $0.0085, the daemon's verdict green 50%, held-out tests passed 50% of 2 graded");
});
