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

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar date of an instant in this machine's time zone, which is the user's (R-011): YYYY-MM-DD. */
export function localDay(at: string | Date): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The week an instant falls in, Monday 00:00 to Sunday 24:00 local time (R-011), named by its Monday's date. */
export function weekOf(at: string | Date): string {
  const d = new Date(at);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
}
