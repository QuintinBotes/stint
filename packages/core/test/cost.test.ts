import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG, priceUsage } from '../src/index';

const u = { inputTokens: 18420, cachedTokens: 11200, outputTokens: 3910 };

test('priceUsage prices cached tokens at the cached rate and returns null without a price', () => {
  expect(priceUsage(DEFAULT_CONFIG.prices['meta-api/muse-spark-1.3'], u)).toBe(0.0303);
  expect(priceUsage(DEFAULT_CONFIG.prices['ollama/muse-glimmer:30b-mlx'], u)).toBe(0);
  expect(priceUsage(undefined, u)).toBeNull();
});
