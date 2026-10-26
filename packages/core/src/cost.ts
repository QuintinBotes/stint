import type { Price } from './schemas/config';

export type Usage = { inputTokens: number; cachedTokens: number; outputTokens: number };

/**
 * USD for one call (D-012): inputTokens includes the cached ones, which are priced at the cached rate.
 * Returns null when there is no price, so a caller can say "unpriced" instead of showing $0.
 */
export function priceUsage(price: Price | undefined, u: Usage): number | null {
  if (!price) return null;
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  const usd = (fresh * price.input + u.cachedTokens * price.cached + u.outputTokens * price.output) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}
