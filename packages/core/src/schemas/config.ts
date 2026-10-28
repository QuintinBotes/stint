import { z } from 'zod';
import { METRIC_IDS } from '../metrics/ids';
import { CheckSchema } from './task';

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

/** How a configured agent prints its work, as dotted paths into each JSON line (R-032). */
export const AgentEventsSchema = z.strictObject({
  format: z.literal('jsonl'),
  /** Dotted path of the field that says what kind of line this is, such as `type`. */
  type: z.string().min(1),
  text: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  args: z.string().min(1).optional(),
  callId: z.string().min(1).optional(),
  result: z.string().min(1).optional(),
  session: z.string().min(1).optional(),
  usage: z
    .strictObject({ input: z.string().min(1), output: z.string().min(1), cached: z.string().min(1).optional() })
    .optional(),
  /** The values of the `type` field that mean each Stint event; any other value is kept unclassified. */
  kinds: z.strictObject({
    message: z.array(z.string().min(1)).default([]),
    tool_call: z.array(z.string().min(1)).default([]),
    tool_result: z.array(z.string().min(1)).default([]),
    usage: z.array(z.string().min(1)).default([]),
  }),
});
export type AgentEvents = z.infer<typeof AgentEventsSchema>;

/** Any coding agent with a command line (R-026): `{prompt}` and `{model}` in `command` are substituted. */
export const AgentDefSchema = z.strictObject({
  command: z.array(z.string().min(1)).min(1),
  prompt: z.enum(['file', 'stdin', 'arg']),
  roles: z.array(z.enum(['planner', 'implementer', 'reviewer', 'tester', 'learn'])).min(1),
  vendor: z.enum(['meta', 'openai', 'anthropic', 'local', 'other']),
  model: z.string().optional(),
  enabled: z.boolean().default(false),
  /** Which harness runs this agent; `cli` is the generic command line adapter (R-032, R-033, R-034). */
  harness: z.enum(['cli', 'claude-code', 'codex', 'acp']).default('cli'),
  /** Shorthand for `harness: 'acp'` (R-033); the ACP adapter runs the agent when this is true. */
  acp: z.boolean().optional(),
  /** A configured host this agent talks to, when it has one; it must be named in `hosts`. */
  host: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
  events: AgentEventsSchema.optional(),
  resume: z.strictObject({ flag: z.string().min(1) }).optional(),
  permissions: z.strictObject({ flags: z.array(z.string().min(1)).max(20) }).optional(),
  capabilities: z
    .strictObject({
      resume: z.boolean().optional(),
      schemaOutput: z.boolean().optional(),
      sandbox: z.boolean().optional(),
      costReporting: z.boolean().optional(),
    })
    .optional(),
  /** Credential variables this agent needs passed through, such as its API key. */
  env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(20).optional(),
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
      /** Write failing acceptance tests first and lock them before the build (R-027). */
      testsFirst: z.boolean().optional(),
      /** Put every new task on autopilot as soon as it is created. */
      onCreate: z.boolean().optional(),
      /** After this many failed verifications, hand to the escalate list instead of the next implementer (R-035). */
      escalateAfter: z.int().min(1).max(5).optional(),
      escalate: z.array(z.string().min(1)).optional(),
      /** Build with this many implementers from the same packet and let the reviewer pick (R-035). */
      bestOf: z.int().min(1).max(3).optional(),
    })
    .optional(),
  /** The verify suite beside testCommand, and what a changed locked test does (R-029). */
  verify: z
    .strictObject({
      checks: z.array(CheckSchema).max(8),
      tamper: z.enum(['off', 'warn', 'fail']),
      coverage: z.boolean().optional(),
    })
    .optional(),
  /** Held-out scenarios: kept outside every worktree, run by the daemon after the tests (R-037). */
  scenarios: z.strictObject({ dir: z.string().min(1), command: z.string().min(1).optional() }).optional(),
  /** Review lenses and best-of-n reviews; a reviewer may not be the implementer's harness and model (R-035, R-038). */
  review: z
    .strictObject({
      lenses: z.array(z.enum(['general', 'security', 'spec-fit'])).min(1),
      bestOf: z.int().min(1).max(3),
      crossVendor: z.boolean(),
    })
    .optional(),
  /** Risk tiers and the auto-approve lane, earned in shadow mode first; off unless a person turns it on (R-039). */
  risk: z
    .strictObject({
      highPaths: z.array(z.string()).max(50),
      autoApprove: z.strictObject({ enabled: z.boolean(), tiers: z.array(z.enum(['low', 'medium'])), shadowDays: z.int().min(0).max(90) }),
    })
    .optional(),
  /** A sandbox per run and a default-deny egress proxy (R-040). */
  sandbox: z
    .strictObject({
      kind: z.enum(['none', 'docker', 'sandbox-exec']),
      image: z.string().optional(),
      /** More paths an agent may write besides its worktree, temp and its own state. */
      writable: z.array(z.string()).max(20).optional(),
      egress: z.strictObject({ mode: z.enum(['off', 'proxy']), allow: z.array(z.string()).max(100) }),
    })
    .optional(),
  /** Where tasks come from besides a person typing them (R-041). */
  intake: z
    .strictObject({
      github: z.strictObject({ repo: z.string().optional(), label: z.string().optional() }).optional(),
      linear: z.strictObject({ team: z.string().optional(), keyEnv: z.string() }).optional(),
    })
    .optional(),
  /** Approve merges locally, or opens a pull request and follows its checks (R-042). */
  release: z.strictObject({ mode: z.enum(['merge', 'pr']), remote: z.string(), base: z.string().optional() }).optional(),
  /** OpenTelemetry export of runs, model calls and evals (R-043). */
  otel: z.strictObject({ endpoint: z.string().optional(), headersEnv: z.string().optional(), serviceName: z.string() }).optional(),
  /** Scheduled upkeep tasks that go through the same queue (R-044). */
  gardening: z
    .strictObject({
      schedule: z.enum(['off', 'daily', 'weekly']),
      tasks: z.array(z.strictObject({ title: z.string().min(1).max(120), goal: z.string().min(1).max(2000) })).max(10),
    })
    .optional(),
  /** Pick the implementer by the configured order, or learn it from outcomes (R-045). */
  routing: z.strictObject({ mode: z.enum(['chains', 'learned']), explore: z.number().min(0).max(1) }).optional(),
  /** The person's editor for "Open in your editor": `{path}` and `{line}` are filled in; unset, Stint finds Cursor, VS Code or Zed. */
  editor: z.array(z.string().min(1)).min(1).max(10).optional(),
  /** Other coding agents a person can hand a task to; off until enabled (R-026). */
  agents: z.record(z.string().regex(/^[a-z0-9-]+$/), AgentDefSchema).optional(),
  /** Skill mounting by similarity and where an approved skill is committed (R-055). */
  skills: z
    .strictObject({
      /** A skill also mounts when one of the three most similar tasks, at or above this score, is in its evidence. */
      similarity: z.number().min(0).default(0.5),
      /** The branch an approved skill is committed to; unset, the branch checked out in the main tree. */
      commitTo: z.string().min(1).optional(),
      /** Unknown and stale skills wait for review before they mount; unset keeps this on (R-060). */
      requireReview: z.boolean().optional(),
    })
    .optional(),
  /** Verification and outcome metrics: how long a merge is watched, and optional targets by metric id (R-061). */
  metrics: z
    .strictObject({
      outcomeWindowDays: z.number().min(0).default(7),
      targets: z.record(z.string(), z.strictObject({ min: z.number().optional(), max: z.number().optional() })).optional(),
    })
    .optional(),
  allowDirectEvents: z.boolean().optional(),
  branchRetentionDays: z.int().min(0).optional(),
}).superRefine((cfg, ctx) => {
  // A host named in a route or a manifest must be configured (R-032); say so in plain words at load.
  const known = Object.keys(cfg.hosts).sort();
  const list = known.length ? known.join(', ') : 'none';
  for (const [role, chain] of Object.entries(cfg.routes)) {
    for (const entry of chain ?? []) {
      const host = entry.split('/')[0] as string;
      if (!cfg.hosts[host]) {
        ctx.addIssue({ code: 'custom', path: ['routes', role], message: `route ${role} names host "${host}" which is not in hosts (configured hosts: ${list})` });
      }
    }
  }
  for (const [name, def] of Object.entries(cfg.agents ?? {})) {
    if (def.host && !cfg.hosts[def.host]) {
      ctx.addIssue({ code: 'custom', path: ['agents', name, 'host'], message: `agent "${name}" names host "${def.host}" which is not in hosts (configured hosts: ${list})` });
    }
  }
  for (const id of Object.keys(cfg.metrics?.targets ?? {})) {
    if (!(METRIC_IDS as readonly string[]).includes(id)) {
      ctx.addIssue({ code: 'custom', path: ['metrics', 'targets', id], message: `metrics target "${id}" is not a metric id (known ids: ${METRIC_IDS.join(', ')})` });
    }
  }
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
    // other places a model can run, ready for any route or agent that names them; no default route does (ADR-0001)
    lmstudio: { baseURL: 'http://localhost:1234/v1', models: {}, offline: true, structuredOutput: 'prompt-only', cachedInput: false },
    llamacpp: { baseURL: 'http://localhost:8080/v1', models: {}, offline: true, structuredOutput: 'prompt-only', cachedInput: false },
    litellm: { baseURLEnv: 'LITELLM_BASE_URL', keyEnv: 'LITELLM_API_KEY', models: {}, offline: false, structuredOutput: 'accepted', cachedInput: false },
  },
  routes: {
    planner: ['meta-api/muse-wonder-1.0', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'],
    reviewer: ['ollama/muse-glimmer:30b-mlx', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open', 'meta-api/muse-spark-1.3'],
    learn: ['baseten/muse-spark-open', 'meta-api/muse-spark-1.3', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'],
    summary: ['ollama/muse-glimmer:30b-mlx', 'meta-api/muse-spark-1.3', 'baseten/muse-spark-open'],
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
  // Meta's models are the default; these are here so a person can bring the agent they already use.
  // No preset bypasses approvals or turns off a sandbox (D-028); a person adds any further permission flags.
  agents: {
    // Native harness (R-034): https://code.claude.com/docs/en/headless
    'claude-code': {
      command: ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'],
      prompt: 'stdin',
      roles: ['implementer', 'reviewer'],
      vendor: 'anthropic',
      enabled: false,
      harness: 'claude-code',
      env: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS'],
      resume: { flag: '--resume' },
      capabilities: { resume: true, schemaOutput: true, sandbox: false, costReporting: true },
    },
    // Native harness (R-034): https://developers.openai.com/codex/noninteractive
    codex: {
      command: ['codex', 'exec', '--json', '--sandbox', 'workspace-write', '-'],
      prompt: 'stdin',
      roles: ['implementer', 'reviewer'],
      vendor: 'openai',
      enabled: false,
      harness: 'codex',
      env: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
      resume: { flag: 'resume' },
      capabilities: { resume: true, schemaOutput: true, sandbox: true, costReporting: true },
    },
    // goose as an ACP server: https://block.github.io/goose/docs/guides/acp-clients
    goose: {
      command: ['goose', 'acp'],
      prompt: 'stdin',
      roles: ['implementer', 'reviewer'],
      vendor: 'other',
      enabled: false,
      harness: 'acp',
      capabilities: { resume: false, schemaOutput: false, sandbox: false, costReporting: false },
    },
    // OpenCode as an ACP server: https://opencode.ai/docs/acp/
    opencode: {
      command: ['opencode', 'acp'],
      prompt: 'stdin',
      roles: ['implementer', 'reviewer'],
      vendor: 'other',
      enabled: false,
      harness: 'acp',
      capabilities: { resume: false, schemaOutput: false, sandbox: false, costReporting: false },
    },
    // Gemini CLI as an ACP server: https://geminicli.com/docs/cli/acp-mode/
    'gemini-acp': {
      command: ['gemini', '--experimental-acp'],
      prompt: 'stdin',
      roles: ['implementer', 'reviewer'],
      vendor: 'other',
      enabled: false,
      harness: 'acp',
      capabilities: { resume: false, schemaOutput: false, sandbox: false, costReporting: false },
    },
    // Gemini CLI headless prompt with the default approval mode: https://geminicli.com/docs/cli/tutorials/automation/
    'gemini-cli': {
      command: ['gemini', '-p', '{prompt}', '--output-format', 'json', '--approval-mode', 'default'],
      prompt: 'arg',
      roles: ['implementer', 'reviewer'],
      vendor: 'other',
      enabled: false,
      harness: 'cli',
      capabilities: { resume: false, schemaOutput: false, sandbox: false, costReporting: false },
    },
    // Aider one message from a file, leaving commits to Stint: https://aider.chat/docs/config/options.html
    aider: {
      command: ['aider', '--message-file', '{prompt}', '--no-auto-commits'],
      prompt: 'file',
      roles: ['implementer', 'reviewer'],
      vendor: 'other',
      enabled: false,
      harness: 'cli',
      capabilities: { resume: false, schemaOutput: false, sandbox: false, costReporting: false },
    },
  },
  metrics: { outcomeWindowDays: 7 },
  branchRetentionDays: 7,
};
