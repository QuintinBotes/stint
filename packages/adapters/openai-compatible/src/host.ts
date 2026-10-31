import OpenAI from 'openai';
import { z } from 'zod';
import {
  DEFAULT_CONFIG,
  NO_FINDINGS,
  PlanSchema,
  ReviewSchema,
  SkillProposalSchema,
  formatIssues,
  priceUsage,
  type Config,
  type Cost,
  type HostConfig,
  type Plan,
  type Price,
  type Review,
  type SkillProposal,
} from '@stint-dev/core';
import { HostError, StructuredOutputError } from './errors';
import { PLAN_JSON_SCHEMA, REVIEW_JSON_SCHEMA, SKILL_PROPOSAL_JSON_SCHEMA, modelFacingSchema, type JsonSchema } from './modelSchema';
import { buildPlanPrompt, buildReviewPrompt, type PlanTaskInput, type SimilarTaskInput, type SkillHint } from './prompts';

export type HostEvent = { type: string; payload: Record<string, unknown> };
export type RetryInfo = { host: string; model: string; errors: string; retries: number };
export type EmitFn = (event: HostEvent) => void | Promise<void>;
export type OnRetryFn = (info: RetryInfo) => void | Promise<void>;

export type AvailableResult = { ok: boolean; reason?: string; latencyMs?: number };

export type CompleteOptions = {
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  schemaName?: string;
  emit?: EmitFn;
  onRetry?: OnRetryFn;
};

export type CompleteResult<T> = {
  value: T;
  cost: Cost;
  host: string;
  model: string;
  retries: number;
  retryErrors?: string;
};

export type PlanInput = {
  task: PlanTaskInput;
  context?: unknown;
  similarTasks?: SimilarTaskInput[];
  skills?: SkillHint[];
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  emit?: EmitFn;
  onRetry?: OnRetryFn;
};

export type ReviewInput = {
  packetPrompt: string;
  diff: string;
  decisions: Array<{ id: string; text: string }>;
  skills?: SkillHint[];
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  emit?: EmitFn;
  onRetry?: OnRetryFn;
};

export type LearnInput =
  | string
  | { prompt: string; model?: string; timeoutMs?: number; maxTokens?: number; emit?: EmitFn; onRetry?: OnRetryFn };

export type Host = {
  id: string;
  vendor: 'meta';
  offline: boolean;
  structuredOutput: HostConfig['structuredOutput'];
  available: () => Promise<AvailableResult>;
  complete: {
    <T>(zodSchema: z.ZodType<T>, jsonSchema: JsonSchema, prompt: string, opts?: CompleteOptions): Promise<CompleteResult<T>>;
    <T>(zodSchema: z.ZodType<T>, prompt: string, opts?: CompleteOptions): Promise<CompleteResult<T>>;
  };
  plan: (input: PlanInput) => Promise<Plan>;
  review: (input: ReviewInput) => Promise<Review>;
  learn: (input: LearnInput) => Promise<SkillProposal>;
};

export type MakeHostOptions = { prices?: Record<string, Price>; config?: Config };

type UsageTotals = { inputTokens: number; cachedTokens: number; outputTokens: number };

const GLIMMER_MODEL = 'muse-glimmer:30b-mlx';
const DEFAULT_TIMEOUT_MS = 60_000;
const REVIEW_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitize(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join('[redacted]') : message;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? (fenced[1] as string) : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw firstError;
  }
}

/** Fill the daemon fields a kit schema expects, and normalise an empty review before validation. */
export function normalizeReview(raw: unknown, fill: { model: string; offline: boolean; cost: Cost }): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw, model: fill.model, offline: fill.offline, cost: fill.cost };
  if (out.createdAt === undefined) out.createdAt = new Date().toISOString();
  if (Array.isArray(out.findings) && out.findings.length === 0) {
    out.summary = NO_FINDINGS;
    out.verdict = 'approve';
    if (!Array.isArray(out.blockers)) out.blockers = [];
  }
  return out;
}

function autoFill(raw: unknown, fullSchema: JsonSchema, fill: { model: string; offline: boolean; cost: Cost }): unknown {
  if (!isRecord(raw)) return raw;
  if (fullSchema.title === 'stint.review/1') return normalizeReview(raw, fill);
  const props = isRecord(fullSchema.properties) ? fullSchema.properties : {};
  const out: Record<string, unknown> = { ...raw };
  if ('model' in props) out.model = fill.model;
  if ('offline' in props) out.offline = fill.offline;
  if ('createdAt' in props && out.createdAt === undefined) out.createdAt = new Date().toISOString();
  if ('cost' in props) out.cost = fill.cost;
  return out;
}

type HostInternals = {
  baseURL: () => string | undefined;
  missingBaseReason: () => string | undefined;
  apiKey: () => string | undefined;
  resolveModel: (model: string | undefined) => { short: string; providerId: string };
  costFor: (shortModel: string, usage: UsageTotals) => Cost;
};

function makeInternals(
  id: string,
  hostConfig: HostConfig,
  env: Record<string, string | undefined>,
  prices: Record<string, Price>,
): HostInternals {
  const baseURL = () => {
    if (hostConfig.baseURL) return hostConfig.baseURL.replace(/\/+$/, '');
    if (hostConfig.baseURLEnv) {
      const value = env[hostConfig.baseURLEnv];
      return value ? value.replace(/\/+$/, '') : undefined;
    }
    return undefined;
  };
  const missingBaseReason = () => {
    if (baseURL()) return undefined;
    if (hostConfig.baseURLEnv) return `${hostConfig.baseURLEnv} not set`;
    return 'no base URL configured';
  };
  const apiKey = () => (hostConfig.keyEnv ? env[hostConfig.keyEnv] : undefined);
  const resolveModel = (model: string | undefined) => {
    const models = hostConfig.models ?? {};
    let requested = model;
    if (requested && requested.startsWith(`${id}/`)) {
      const rest = requested.slice(id.length + 1);
      if (rest in models) requested = rest;
    }
    if (!requested) {
      const first = Object.keys(models)[0];
      if (!first) throw new HostError(id, 'no_model', `host ${id} has no model configured`);
      requested = first;
    }
    if (requested in models) return { short: requested, providerId: models[requested] as string };
    const byProvider = Object.entries(models).find(([, providerId]) => providerId === requested);
    if (byProvider) return { short: byProvider[0], providerId: requested };
    return { short: requested, providerId: requested };
  };
  const costFor = (shortModel: string, usage: UsageTotals): Cost => {
    if (id === 'ollama' || hostConfig.offline) {
      return { inputTokens: usage.inputTokens, cachedTokens: usage.cachedTokens, outputTokens: usage.outputTokens, usd: 0 };
    }
    const price = prices[`${id}/${shortModel}`] ?? DEFAULT_CONFIG.prices[`${id}/${shortModel}`];
    return {
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      usd: priceUsage(price, usage),
    };
  };
  return { baseURL, missingBaseReason, apiKey, resolveModel, costFor };
}

function originOf(baseURL: string): string {
  try {
    return new URL(baseURL).origin;
  } catch {
    return baseURL.replace(/\/v1$/, '');
  }
}

function httpReason(status: number): string {
  if (status === 429) return '429';
  if (status >= 500) return '5xx';
  return `http_${status}`;
}

function mapCallError(id: string, error: unknown, secret: string | undefined): HostError {
  if (error instanceof HostError) return error;
  const record = isRecord(error) ? error : {};
  const status = typeof record.status === 'number' ? record.status : undefined;
  const name = error instanceof Error ? error.name : '';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitize(rawMessage, secret);
  if (status !== undefined) return new HostError(id, httpReason(status), `host ${id} answered HTTP ${status}`, status);
  if (
    name === 'APIConnectionTimeoutError' ||
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(message)
  ) {
    return new HostError(id, 'timeout', `host ${id} timed out`);
  }
  return new HostError(id, 'unavailable', `host ${id} is unavailable: ${message}`);
}

/**
 * One OpenAI-compatible host. A host is a base URL and a key name, never a code path: the only
 * per-host differences are the structured output mode and Ollama's native chat endpoint.
 */
export function makeHost(
  id: string,
  hostConfig: HostConfig,
  env: Record<string, string | undefined> = process.env,
  opts: MakeHostOptions = {},
): Host {
  const prices = opts.prices ?? opts.config?.prices ?? DEFAULT_CONFIG.prices;
  const internals = makeInternals(id, hostConfig, env, prices);
  const isOllama = id === 'ollama';

  async function available(): Promise<AvailableResult> {
    const started = Date.now();
    try {
      if (hostConfig.keyEnv && !env[hostConfig.keyEnv]) {
        return { ok: false, reason: `${hostConfig.keyEnv} not set` };
      }
      const base = internals.baseURL();
      if (!base) return { ok: false, reason: internals.missingBaseReason() ?? 'no base URL configured' };
      const key = internals.apiKey();
      const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
      if (isOllama) {
        const response = await fetch(`${originOf(base)}/api/tags`, { headers, signal: AbortSignal.timeout(5000) });
        const latencyMs = Date.now() - started;
        if (!response.ok) return { ok: false, reason: `ollama answered HTTP ${response.status}; run ollama pull ${GLIMMER_MODEL}`, latencyMs };
        const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
        const listed = new Set((body.models ?? []).flatMap((m) => [m.name, m.model].filter(Boolean) as string[]));
        const expected = Object.values(hostConfig.models ?? {});
        const wanted = expected.includes(GLIMMER_MODEL) || expected.length === 0 ? GLIMMER_MODEL : (expected[0] as string);
        if (expected.length === 0 || expected.some((model) => listed.has(model))) return { ok: true, latencyMs };
        return { ok: false, reason: `model ${wanted} is not pulled; run ollama pull ${GLIMMER_MODEL}`, latencyMs };
      }
      const response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - started;
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, latencyMs };
      return { ok: true, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = sanitize(error instanceof Error ? error.message : String(error), internals.apiKey());
      const hint = isOllama ? `; run ollama pull ${GLIMMER_MODEL}` : '';
      return { ok: false, reason: `${message}${hint}`, latencyMs };
    }
  }

  type RawCall = { text: string; usage: UsageTotals };

  async function rawCall(args: {
    providerId: string;
    prompt: string;
    modelSchema: JsonSchema;
    schemaName: string;
    timeoutMs: number;
    maxTokens?: number;
  }): Promise<RawCall> {
    if (hostConfig.keyEnv && !internals.apiKey()) {
      throw new HostError(id, 'no_key', `${hostConfig.keyEnv} not set`);
    }
    const base = internals.baseURL();
    if (!base) throw new HostError(id, 'no_key', internals.missingBaseReason() ?? 'no base URL configured');
    const key = internals.apiKey();
    try {
      if (isOllama) {
        const ollamaChat = async (useFormat: boolean): Promise<Response> =>
          fetch(`${originOf(base)}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({
              model: args.providerId,
              messages: [
                {
                  role: 'user',
                  content: useFormat
                    ? args.prompt
                    : `${args.prompt}\n\nReturn only JSON that matches this JSON Schema:\n\`\`\`json\n${JSON.stringify(args.modelSchema)}\n\`\`\`\n`,
                },
              ],
              ...(useFormat ? { format: args.modelSchema } : {}),
              stream: false,
              think: false,
              ...(args.maxTokens ? { options: { num_predict: args.maxTokens } } : {}),
            }),
            signal: AbortSignal.timeout(args.timeoutMs),
          });
        let response = await ollamaChat(true);
        // Some runners answer 501 for grammar-constrained output. The schema then travels in
        // the prompt only, and zod validation plus the one retry still guard the answer.
        if (response.status === 501) response = await ollamaChat(false);
        if (!response.ok) throw new HostError(id, httpReason(response.status), `host ${id} answered HTTP ${response.status}`, response.status);
        const body = (await response.json()) as {
          message?: { content?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        return {
          text: body.message?.content ?? '',
          usage: { inputTokens: body.prompt_eval_count ?? 0, cachedTokens: 0, outputTokens: body.eval_count ?? 0 },
        };
      }
      const client = new OpenAI({ apiKey: key ?? 'no-key', baseURL: base, maxRetries: 0, timeout: args.timeoutMs });
      const promptWithSchema = `${args.prompt}\n\nReturn only JSON that matches this JSON Schema:\n\`\`\`json\n${JSON.stringify(args.modelSchema)}\n\`\`\`\n`;
      const completion = await client.chat.completions.create({
        model: args.providerId,
        messages: [{ role: 'user', content: promptWithSchema }],
        ...(hostConfig.structuredOutput !== 'prompt-only'
          ? { response_format: { type: 'json_schema' as const, json_schema: { name: args.schemaName, schema: args.modelSchema } } }
          : {}),
        ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
      });
      const usage = completion.usage;
      return {
        text: completion.choices[0]?.message?.content ?? '',
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      throw mapCallError(id, error, key);
    }
  }

  async function structured<T>(args: {
    zodSchema: z.ZodType<T>;
    jsonSchema: JsonSchema;
    prompt: string;
    model?: string;
    timeoutMs?: number;
    maxTokens?: number;
    schemaName?: string;
    emit?: EmitFn;
    onRetry?: OnRetryFn;
  }): Promise<CompleteResult<T>> {
    const { short, providerId } = internals.resolveModel(args.model);
    const modelSchema = modelFacingSchema(args.jsonSchema);
    const schemaName = args.schemaName ?? String(args.jsonSchema.title ?? 'stint_output').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const timeoutMs = Math.max(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, hostConfig.timeoutMs ?? 0);
    const totals: UsageTotals = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    let prompt = args.prompt;
    let retryErrors: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await rawCall({ providerId, prompt, modelSchema, schemaName, timeoutMs, maxTokens: args.maxTokens });
      totals.inputTokens += raw.usage.inputTokens;
      totals.cachedTokens += raw.usage.cachedTokens;
      totals.outputTokens += raw.usage.outputTokens;
      const cost = internals.costFor(short, totals);
      let errors: string;
      try {
        const parsed = parseJsonText(raw.text);
        const prepared = autoFill(parsed, args.jsonSchema, { model: `${id}/${short}`, offline: isOllama, cost });
        const result = args.zodSchema.safeParse(prepared);
        if (result.success) {
          return { value: result.data, cost, host: id, model: short, retries: attempt, ...(retryErrors ? { retryErrors } : {}) };
        }
        errors = formatIssues(result.error);
      } catch (error) {
        errors = error instanceof Error ? `invalid JSON: ${error.message}` : 'invalid JSON';
      }
      if (attempt === 1) throw new StructuredOutputError(id, errors, short, cost);
      retryErrors = errors;
      if (args.emit) await args.emit({ type: 'provider.retry', payload: { host: id, model: short, errors } });
      else if (args.onRetry) await args.onRetry({ host: id, model: short, errors, retries: 1 });
      prompt = `${args.prompt}\n\nThe previous answer did not validate. Fix these errors and return only JSON:\n${errors}\n`;
    }
    throw new StructuredOutputError(id, retryErrors ?? 'invalid output', short, internals.costFor(short, totals));
  }

  async function complete<T>(
    zodSchema: z.ZodType<T>,
    jsonSchemaOrPrompt: JsonSchema | string,
    promptOrOpts?: string | CompleteOptions,
    maybeOpts?: CompleteOptions,
  ): Promise<CompleteResult<T>> {
    if (typeof jsonSchemaOrPrompt === 'string') {
      const opts = (promptOrOpts as CompleteOptions | undefined) ?? {};
      let jsonSchema: JsonSchema = { type: 'object' };
      try {
        jsonSchema = z.toJSONSchema(zodSchema) as JsonSchema;
      } catch {
        jsonSchema = { type: 'object' };
      }
      return structured({ zodSchema, jsonSchema, prompt: jsonSchemaOrPrompt, ...opts });
    }
    const opts = maybeOpts ?? {};
    return structured({ zodSchema, jsonSchema: jsonSchemaOrPrompt, prompt: promptOrOpts as string, ...opts });
  }

  async function plan(input: PlanInput): Promise<Plan> {
    const result = await structured({
      zodSchema: PlanSchema,
      jsonSchema: PLAN_JSON_SCHEMA,
      prompt: buildPlanPrompt(input),
      model: input.model,
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      emit: input.emit,
      onRetry: input.onRetry,
    });
    return result.value;
  }

  async function review(input: ReviewInput): Promise<Review> {
    const result = await structured({
      zodSchema: ReviewSchema,
      jsonSchema: REVIEW_JSON_SCHEMA,
      prompt: buildReviewPrompt(input),
      model: input.model,
      timeoutMs: input.timeoutMs ?? REVIEW_TIMEOUT_MS,
      maxTokens: input.maxTokens,
      emit: input.emit,
      onRetry: input.onRetry,
    });
    return result.value;
  }

  async function learn(input: LearnInput): Promise<SkillProposal> {
    const normalized = typeof input === 'string' ? { prompt: input } : input;
    const result = await structured({
      zodSchema: SkillProposalSchema,
      jsonSchema: SKILL_PROPOSAL_JSON_SCHEMA,
      prompt: normalized.prompt,
      model: normalized.model,
      timeoutMs: normalized.timeoutMs,
      maxTokens: normalized.maxTokens,
      emit: normalized.emit,
      onRetry: normalized.onRetry,
    });
    return result.value;
  }

  return {
    id,
    vendor: 'meta',
    offline: hostConfig.offline ?? isOllama,
    structuredOutput: hostConfig.structuredOutput ?? 'accepted',
    available,
    complete,
    plan,
    review,
    learn,
  };
}

/** Build every host named in config.hosts, keyed by host id. */
export function hostsFromConfig(
  config: Config,
  env: Record<string, string | undefined> = process.env,
): Record<string, Host> {
  const out: Record<string, Host> = {};
  for (const [hostId, hostConfig] of Object.entries(config.hosts)) {
    out[hostId] = makeHost(hostId, hostConfig, env, { prices: config.prices });
  }
  return out;
}
