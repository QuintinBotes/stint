/**
 * Deterministic token estimate: characters / 3.6, rounded up. It is an approximation of a
 * cl100k-style BPE on English prose and code, not a tokenizer; every limit in Stint (the
 * 600-token packet) is checked with this same function, so the numbers are comparable.
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
