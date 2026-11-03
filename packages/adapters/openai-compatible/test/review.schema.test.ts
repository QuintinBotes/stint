import { expect, test } from 'bun:test';
import { NO_FINDINGS, ReviewSchema, countTokens, type HostConfig } from '@stint-dev/core';
import { StructuredOutputError, buildReviewPrompt, capDiff, makeHost, normalizeReview } from '../src/index';

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

const FILL = { model: 'meta-api/muse-wonder-1.0', offline: false, cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd: 0 } };

test('an empty approve from a model is normalised to the no-findings summary', () => {
  const parsed = ReviewSchema.parse(normalizeReview({ version: 'stint.review/1', verdict: 'approve', summary: 'Nothing to say', findings: [] }, FILL));
  expect(parsed).toMatchObject({ verdict: 'approve', summary: 'No actionable findings.', findings: [], blockers: [] });
});

test('a review with blockers and no findings keeps its verdict, and its blockers become its findings', () => {
  for (const verdict of ['block', 'request_changes']) {
    const parsed = ReviewSchema.parse(
      normalizeReview({ version: 'stint.review/1', verdict, summary: 'It drops traffic.', findings: [], blockers: ['The limiter drops every request.'] }, FILL),
    );
    expect(parsed).toMatchObject({
      verdict,
      summary: 'It drops traffic.',
      findings: [{ id: 'F1', severity: 'blocker', text: 'The limiter drops every request.' }],
      blockers: ['The limiter drops every request.'],
    });
  }
});

test('an approve that lists blockers and no findings becomes a block, so the gate stays shut', () => {
  const parsed = ReviewSchema.parse(
    normalizeReview({ version: 'stint.review/1', verdict: 'approve', summary: 'Looks fine.', findings: [], blockers: ['The limiter drops every request.'] }, FILL),
  );
  expect(parsed).toMatchObject({ verdict: 'block', findings: [{ id: 'F1', severity: 'blocker', text: 'The limiter drops every request.' }] });
});

test('a block with no findings and no blockers is asked for again and then refused, never turned into an approve', async () => {
  const prompts: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/v1/models') return Response.json({ object: 'list', data: [] });
      prompts.push(JSON.stringify(await req.json()));
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
    // the refusal is what moves the reviewer chain on to its next host
    const refused = await host.review({ packetPrompt: 'packet', diff: 'diff --git a/x b/x', decisions: [], model: 'muse-wonder-1.0' }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(StructuredOutputError);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('The previous answer did not validate.');
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

  const review = (offline: boolean) => buildReviewPrompt({ packetPrompt: 'packet text', diff, decisions: [], offline });
  expect(review(false)).toContain('hunks left out to fit the 3000 token review cap.');
  expect(review(true)).not.toContain('hunks left out');
  expect(review(true).split('big line of code here').length - 1).toBe(800);
});
