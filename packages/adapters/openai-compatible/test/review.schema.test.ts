import { expect, test } from 'bun:test';
import { NO_FINDINGS, ReviewSchema, countTokens, type HostConfig } from '@stint-dev/core';
import { buildReviewPrompt, capDiff, makeHost, normalizeReview } from '../src/index';

test("A review whose text is exactly `No actionable findings.` validates with `verdict: 'approve'` and empty `findings`", () => {
  const review = ReviewSchema.parse({
    version: 'stint.review/1',
    verdict: 'approve',
    summary: NO_FINDINGS,
    findings: [],
    blockers: [],
    model: 'ollama/muse-glimmer:30b-mlx',
    offline: true,
  });
  expect(review.summary).toBe('No actionable findings.');
  expect(review.verdict).toBe('approve');
  expect(review.findings).toEqual([]);
});

test('an empty findings answer from a model is normalised to the no-findings summary and approve', async () => {
  const prepared = normalizeReview(
    { version: 'stint.review/1', verdict: 'request_changes', summary: 'Nothing to say', findings: [], blockers: [] },
    { model: 'meta-api/muse-wonder-1.0', offline: false, cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } },
  );
  const parsed = ReviewSchema.parse(prepared);
  expect(parsed.summary).toBe('No actionable findings.');
  expect(parsed.verdict).toBe('approve');

  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'muse-wonder-1.0',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({ version: 'stint.review/1', verdict: 'block', summary: 'All good', findings: [], blockers: [] }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  });
  try {
    const hostConfig: HostConfig = {
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      keyEnv: 'META_API_KEY',
      models: { 'muse-wonder-1.0': 'muse-wonder-1.0' },
      offline: false,
      structuredOutput: 'enforced',
      cachedInput: true,
    };
    const host = makeHost('meta-api', hostConfig, { META_API_KEY: 'test-key' });
    const review = await host.review({ packetPrompt: 'packet', diff: 'diff --git a/x b/x', decisions: [], model: 'muse-wonder-1.0' });
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(review.summary).toBe('No actionable findings.');
    expect(review.verdict).toBe('approve');
    expect(review.findings).toEqual([]);
    expect(review.offline).toBe(false);
  } finally {
    server.stop(true);
  }
});

test('the review diff is capped at 3000 tokens, largest hunks first, with a left out line, and review-voice-policy leads the skills', () => {
  const big = `@@ -1,400 +1,400 @@\n${'big line of code here\n'.repeat(400)}`;
  const small = '@@ -1,1 +1,1 @@\n+tiny';
  const diff = `diff --git a/src/a.ts b/src/a.ts\n${small}\ndiff --git a/src/b.ts b/src/b.ts\n${big}\ndiff --git a/src/c.ts b/src/c.ts\n${big}`;
  const capped = capDiff(diff, 3000);
  expect(countTokens(capped.text)).toBeLessThanOrEqual(3000);
  expect(capped.leftOutHunks).toBeGreaterThan(0);
  expect(capped.text).toContain(`${capped.leftOutHunks} hunks left out to fit the 3000 token review cap.`);
  expect(capped.text).toContain('big line of code here');

  const prompt = buildReviewPrompt({
    packetPrompt: 'packet text',
    diff: 'diff --git a/x b/x\n@@ -1 +1 @@\n+one',
    decisions: [{ id: 'D3', text: 'Use a sliding window counter per tenant' }],
    skills: [
      { name: 'other-skill', description: 'Another skill' },
      { name: 'review-voice-policy', description: 'How findings are worded' },
    ],
  });
  expect(prompt.indexOf('review-voice-policy')).toBeLessThan(prompt.indexOf('other-skill'));
  expect(prompt).toContain('- D3: Use a sliding window counter per tenant');
  expect(prompt.trimEnd().endsWith('list any blocker texts in blockers.')).toBe(true);
});
