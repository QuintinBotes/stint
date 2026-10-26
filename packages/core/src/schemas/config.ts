import { z } from 'zod';

const HostModelRef = z.string().regex(/^[a-z0-9-]+\/.+$/, 'expected host/model');

export const HostConfigSchema = z.strictObject({
  baseURL: z.string().optional(),
  /** Env var holding the base URL, for hosts whose endpoint is per account (Modal). */
  baseURLEnv: z.string().optional(),
  keyEnv: z.string().optional(),
  /** Short model name used in routes and prices to the id the host expects. */
  models: z.record(z.string(), z.string()).default({}),
  offline: z.boolean().default(false),
  structuredOutput: z.enum(['enforced', 'accepted', 'prompt-only']).default('accepted'),
  cachedInput: z.boolean().default(false),
  tpm: z.int().positive().optional(),
  rpm: z.int().positive().optional(),
});
export type HostConfig = z.infer<typeof HostConfigSchema>;

export const PriceSchema = z.strictObject({ input: z.number().min(0), cached: z.number().min(0), output: z.number().min(0) });
export type Price = z.infer<typeof PriceSchema>;

export const ConfigSchema = z.strictObject({
  version: z.literal('stint.config/1'),
  port: z.int().min(0).max(65535),
  adapters: z.record(z.string(), z.looseObject({ enabled: z.boolean().default(true) })),
  budgets: z.strictObject({
    planner: z.int().min(0),
    implementer: z.int().min(0),
    reviewer: z.int().min(0),
    learn: z.int().min(0),
  }),
  testCommand: z.string().min(1),
  hosts: z.record(z.string(), HostConfigSchema),
  routes: z.strictObject({
    planner: z.array(HostModelRef),
    reviewer: z.array(HostModelRef),
    learn: z.array(HostModelRef),
    summary: z.array(HostModelRef),
    embed: z.array(HostModelRef).optional(),
  }),
  /** USD per million tokens, keyed by `host/model`. */
  prices: z.record(z.string(), PriceSchema),
  /** Partner and hackathon balances the human enters; metered spend is subtracted from them. */
  credits: z.record(z.string(), z.number().min(0)),
  allowDirectEvents: z.boolean().optional(),
  branchRetentionDays: z.int().min(0).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

const SPARK_OPEN_PRICE = { input: 1.25, cached: 0.15, output: 4.25 };

export const DEFAULT_CONFIG: Config = {
  version: 'stint.config/1',
  port: 0,
  adapters: {
    'muse-code': { enabled: true, model: 'muse-spark-1.3', maxModelSteps: 60, timeoutMs: 900_000 },
    'claude-code': { enabled: true, maxTurns: 40 },
    replay: { enabled: true },
  },
  budgets: { planner: 40_000, implementer: 150_000, reviewer: 30_000, learn: 20_000 },
  testCommand: 'bun test',
  hosts: {
    'meta-api': {
      baseURL: 'https://api.meta.ai/v1',
      keyEnv: 'META_API_KEY',
      models: { 'muse-wonder-1.0': 'muse-wonder-1.0', 'muse-spark-1.3': 'muse-spark-1.3' },
      offline: false,
      structuredOutput: 'enforced',
      cachedInput: true,
    },
    fireworks: {
      baseURL: 'https://api.fireworks.ai/inference/v1',
      keyEnv: 'FIREWORKS_API_KEY',
      models: { 'muse-spark-open': 'accounts/fireworks/models/muse-spark-open' },
      offline: false,
      structuredOutput: 'enforced',
      cachedInput: true,
    },
    baseten: {
      baseURL: 'https://inference.baseten.co/v1',
      keyEnv: 'BASETEN_API_KEY',
      models: { 'muse-spark-open': 'meta-models/muse-spark-open' },
      offline: false,
      structuredOutput: 'accepted',
      cachedInput: true,
      tpm: 2_000_000,
    },
    modal: {
      baseURLEnv: 'MODAL_BASE_URL',
      keyEnv: 'MODAL_API_KEY',
      models: { 'muse-spark-open': 'meta-models/Muse-Spark-Open-816B-A42B' },
      offline: false,
      structuredOutput: 'accepted',
      cachedInput: true,
    },
    ollama: {
      baseURL: 'http://localhost:11434/v1',
      models: { 'muse-glimmer:30b-mlx': 'muse-glimmer:30b-mlx' },
      offline: true,
      structuredOutput: 'enforced',
      cachedInput: false,
    },
  },
  routes: {
    planner: ['meta-api/muse-wonder-1.0', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'],
    reviewer: ['ollama/muse-glimmer:30b-mlx', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open'],
    learn: ['baseten/muse-spark-open', 'meta-api/muse-spark-1.3', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'],
    summary: ['ollama/muse-glimmer:30b-mlx', 'baseten/muse-spark-open'],
  },
  prices: {
    'meta-api/muse-spark-1.3': { input: 1.25, cached: 0.15, output: 5 },
    'meta-api/muse-wonder-1.0': { input: 4, cached: 0.2, output: 20 },
    'baseten/muse-spark-open': SPARK_OPEN_PRICE,
    'fireworks/muse-spark-open': SPARK_OPEN_PRICE,
    'modal/muse-spark-open': SPARK_OPEN_PRICE,
    'ollama/muse-glimmer:30b-mlx': { input: 0, cached: 0, output: 0 },
  },
  credits: { baseten: 100, fireworks: 25, modal: 100, 'meta-api': 150 },
  branchRetentionDays: 7,
};
