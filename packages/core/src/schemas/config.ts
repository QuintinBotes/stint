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

/** Any coding agent with a command line (R-026): `{prompt}` and `{model}` in `command` are substituted. */
export const AgentDefSchema = z.strictObject({
  command: z.array(z.string().min(1)).min(1),
  prompt: z.enum(['file', 'stdin', 'arg']),
  roles: z.array(z.enum(['planner', 'implementer', 'reviewer'])).min(1),
  vendor: z.enum(['meta', 'openai', 'anthropic', 'local', 'other']),
  model: z.string().optional(),
  enabled: z.boolean().default(false),
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

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
    /** The Stint agent's hosts, in order (R-013). */
    agent: z.array(HostModelRef).optional(),
    /** The packet quiz: who writes facts from the full record, and who answers them from the packet alone. */
    quiz: z.array(HostModelRef).optional(),
    recall: z.array(HostModelRef).optional(),
  }),
  /** USD per million tokens, keyed by `host/model`. */
  prices: z.record(z.string(), PriceSchema),
  /** Partner and hackathon balances the human enters; metered spend is subtracted from them. */
  credits: z.record(z.string(), z.number().min(0)),
  /** A task on autopilot drives itself to the approval gate (R-025). */
  autopilot: z
    .strictObject({
      implementers: z.array(z.string().min(1)).min(1),
      maxHops: z.int().min(0).max(10),
      parallel: z.int().min(1).max(8),
    })
    .optional(),
  /** Other coding agents a person can hand a task to; off until enabled (R-026). */
  agents: z.record(z.string().regex(/^[a-z0-9-]+$/), AgentDefSchema).optional(),
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
    'stint-agent': { enabled: true, maxTurns: 40, model: 'muse-spark-1.3' },
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
    agent: ['meta-api/muse-spark-1.3', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'],
    quiz: ['meta-api/muse-wonder-1.0', 'meta-api/muse-spark-1.3', 'fireworks/muse-spark-open', 'baseten/muse-spark-open'],
    recall: ['ollama/muse-glimmer:30b-mlx', 'meta-api/muse-spark-1.3', 'baseten/muse-spark-open'],
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
  autopilot: { implementers: ['muse-code', 'stint-agent'], maxHops: 3, parallel: 2 },
  // Meta's models are the default; these are here so a person can bring the agent they already use
  agents: {
    'claude-code': { command: ['claude', '-p', '--permission-mode', 'acceptEdits'], prompt: 'stdin', roles: ['implementer', 'reviewer'], vendor: 'anthropic', enabled: false },
    codex: { command: ['codex', 'exec', '--full-auto', '-'], prompt: 'stdin', roles: ['implementer', 'reviewer'], vendor: 'openai', enabled: false },
  },
  branchRetentionDays: 7,
};
