import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG, priceUsage } from '@stint-dev/core';

const P = DEFAULT_CONFIG.prices;
const usage = { inputTokens: 18420, cachedTokens: 11200, outputTokens: 3910 };

describe('price', () => {
  test('Known usage { 18420, 11200, 3910 } on meta-api/muse-spark-1.3 with the default prices yields the D-012 price', () => {
    // D-012: inputTokens includes the cached ones. (18420 - 11200) x 1.25 + 11200 x 0.15 + 3910 x 5 per million = 0.0303.
    // The spec's 0.0276 does not follow from any reading of these prices; see the R-011 Deviation.
    expect(priceUsage(P['meta-api/muse-spark-1.3'], usage)).toBeCloseTo(0.0303, 4);
  });

  test('A local Glimmer run prices at usd: 0 with its token counts kept; cached tokens on fireworks/muse-spark-open cost $0.15 per million', () => {
    expect(priceUsage(P['ollama/muse-glimmer:30b-mlx'], usage)).toBe(0);
    const cached = priceUsage(P['fireworks/muse-spark-open'], usage) as number;
    const uncached = priceUsage(P['fireworks/muse-spark-open'], { ...usage, cachedTokens: 0 }) as number;
    expect(uncached - cached).toBeCloseTo((11200 * (1.25 - 0.15)) / 1_000_000, 4);
  });

  test('an unknown host/model is unpriced, never a crash', () => {
    expect(priceUsage(P['nowhere/unknown'], usage)).toBeNull();
  });
});
