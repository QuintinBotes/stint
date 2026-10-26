import type { Finding, Review } from '@stint-dev/core';

export type DecisionRef = { id: string; text: string };

const REVERSAL_WORDS = [
  'instead of',
  'replace',
  'switch to',
  'rather than',
  'revert',
  'reverse',
  'undo',
  'drop the',
  'remove the',
  'move away from',
];

// Known opposite pairs: a finding naming one side against a decision naming the other negates it.
const OPPOSITE_PAIRS: Array<[string, string]> = [['sliding window', 'fixed window']];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'use', 'uses', 'using',
  'used', 'is', 'are', 'be', 'per', 'by', 'from', 'this', 'that', 'should', 'must', 'will',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

function negates(findingText: string, decisionText: string): boolean {
  const finding = findingText.toLowerCase();
  const decision = decisionText.toLowerCase();
  for (const [a, b] of OPPOSITE_PAIRS) {
    if ((decision.includes(a) && finding.includes(b)) || (decision.includes(b) && finding.includes(a))) return true;
  }
  // Simple check: the finding shares at least two content words with the decision and also
  // carries a reversal word, which reads as proposing the opposite of the decision.
  if (!REVERSAL_WORDS.some((word) => finding.includes(word))) return false;
  const decisionWords = new Set(contentWords(decisionText));
  const shared = contentWords(findingText).filter((word) => decisionWords.has(word));
  return new Set(shared).size >= 2;
}

/**
 * Findings that propose reversing a listed decision: an explicit contradictsDecision naming a
 * listed decision, or text that negates a decision by the simple check above. The daemon routes
 * these to the adjudication queue instead of applying them.
 */
export function findContradictions(review: Review, decisions: DecisionRef[]): Finding[] {
  const listed = new Map(decisions.map((d) => [d.id, d]));
  return review.findings.filter((finding) => {
    if (finding.contradictsDecision && listed.has(finding.contradictsDecision)) return true;
    return decisions.some((decision) => negates(finding.text, decision.text));
  });
}
