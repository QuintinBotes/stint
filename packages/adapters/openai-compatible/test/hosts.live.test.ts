import { expect, test } from 'bun:test';
import { DEFAULT_CONFIG, PlanSchema, ReviewSchema } from '@stint-dev/core';
import { PLAN_JSON_SCHEMA, buildPlanPrompt, hostsFromConfig } from '../src/index';

const live = process.env.STINT_LIVE === '1';
const missingKeys = ['FIREWORKS_API_KEY', 'BASETEN_API_KEY'].filter((key) => !process.env[key]);
const skipReason = !live ? 'STINT_LIVE is not 1' : missingKeys.length > 0 ? `${missingKeys.join(' and ')} not set` : '';
const liveTest = skipReason ? test.skip : test;

liveTest(
  `With \`STINT_LIVE=1\` and both partner keys set, one real plan on \`fireworks/muse-spark-open\` and one real review on \`baseten/muse-spark-open\` validate, and the Fireworks usage object reports cached tokens on the second identical-prefix call${skipReason ? ` (skipped: ${skipReason})` : ''}`,
  async () => {
    const hosts = hostsFromConfig(DEFAULT_CONFIG);
    const fireworks = hosts.fireworks as NonNullable<(typeof hosts)['fireworks']>;
    const baseten = hosts.baseten as NonNullable<(typeof hosts)['baseten']>;

    const prompt = buildPlanPrompt({
      task: { id: 'T-0042', title: 'Rate limit webhooks', goal: 'Limit webhook posts per tenant', acceptance: ['Excess posts get 429'] },
      skills: [{ name: 'limits-from-config', description: 'Read limits from config' }],
    });
    const first = await fireworks.complete(PlanSchema, PLAN_JSON_SCHEMA, prompt, { model: 'muse-spark-open', timeoutMs: 120_000 });
    expect(PlanSchema.parse(first.value)).toEqual(first.value);
    expect(first.host).toBe('fireworks');

    const second = await fireworks.complete(PlanSchema, PLAN_JSON_SCHEMA, prompt, { model: 'muse-spark-open', timeoutMs: 120_000 });
    expect(second.cost.cachedTokens).toBeGreaterThan(0);

    const review = await baseten.review({
      packetPrompt: 'Task T-0042. A limiter was added.',
      diff: 'diff --git a/src/lib/limiter.ts b/src/lib/limiter.ts\n@@ -0,0 +1,2 @@\n+export const LIMIT = 60;\n+export function allow() { return true; }',
      decisions: [{ id: 'D3', text: 'Use a sliding window counter per tenant' }],
      model: 'muse-spark-open',
      timeoutMs: 120_000,
    });
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(review.model).toBe('baseten/muse-spark-open');
    expect(review.offline).toBe(false);
  },
  300_000,
);
