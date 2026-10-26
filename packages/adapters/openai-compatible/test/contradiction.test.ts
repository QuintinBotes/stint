import { expect, test } from 'bun:test';
import { ReviewSchema } from '@stint-dev/core';
import { findContradictions } from '../src/index';

test('findContradictions marks the finding with `contradictsDecision: "D3"` and the negating finding, and not an unrelated one', () => {
  const decisions = [{ id: 'D3', text: 'Use a sliding window counter per tenant for the limiter' }];
  const review = ReviewSchema.parse({
    version: 'stint.review/1',
    verdict: 'request_changes',
    summary: 'Two findings touch D3.',
    findings: [
      {
        id: 'F1',
        severity: 'minor',
        text: 'A fixed window counter would use less memory per tenant.',
        contradictsDecision: 'D3',
      },
      {
        id: 'F2',
        severity: 'major',
        text: 'Replace the sliding window counter per tenant with a fixed window counter instead of keeping the log.',
      },
      {
        id: 'F3',
        severity: 'major',
        text: 'The limit of 60 per minute is hard-coded; read it from config like the other limits.',
      },
      {
        id: 'F4',
        severity: 'note',
        text: 'This finding names a decision that is not listed.',
        contradictsDecision: 'D9',
      },
    ],
    blockers: [],
    model: 'ollama/muse-glimmer:30b-mlx',
    offline: true,
  });

  const found = findContradictions(review, decisions);
  expect(found.map((finding) => finding.id)).toEqual(['F1', 'F2']);
});
