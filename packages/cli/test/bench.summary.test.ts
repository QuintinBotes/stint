import { expect, test } from 'bun:test';
import { type BenchRowFile, buildResults, formatSummary } from '../src/bench/results';

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
    'transcript 2 runs, mean input 50000 tokens, mean prompt 25000 tokens, mean $0.0500, pass rate 100% (verified by the daemon)',
    'packet     2 runs, mean input 10000 tokens, mean prompt 5000 tokens, mean $0.0100, pass rate 50% (verified by the daemon)',
    'review leg 1 runs, mean input 3000 tokens, mean $0.0030, pass rate 100%',
    'Ratio (transcript over packet mean input tokens): 5.00x',
    'Packet mode passed less often than transcript mode: leftOut and askOfNext are the fields to improve.',
  ]);
});

test('R-021 Req 4: with one mode there is no ratio and no comparison sentence', () => {
  const lines = formatSummary(buildResults({ replay: false, rows: [row('packet', 8_000, false, { usd: null })] }));
  expect(lines.slice(1)).toEqual(['packet     1 runs, mean input 8000 tokens, mean prompt 4000 tokens, mean unpriced, pass rate 0% (verified by the daemon)', 'Ratio: not available (it needs both modes)']);
  expect(lines[0]).toBe('Bench results (live): 1 continued runs, implementer muse-code, continuer stint-agent');
});
