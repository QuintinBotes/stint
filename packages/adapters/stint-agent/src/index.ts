import { type Adapter, type Availability, type Config, type Cost, DEFAULT_CONFIG, type RunContext, type RunResult } from '@stint-dev/core';
import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { TOOLS, checkCall, runTool } from './tools';

/** Malformed tool calls in a row before the run ends as failed: enough for a retry or two, not a loop. */
const MAX_INVALID = 3;

export { checkCommand, checkPath } from './refusals';
export { TOOLS, runTool } from './tools';

/** The tool contract the agent works under; the task itself arrives as prompt.md. */
export const SYSTEM_PROMPT = `You are the Stint agent, a coding agent that works on one task in a git worktree.
Use the tools to read, change and test the code. Paths are relative to the repository root.
Stint checks every tool call; a refused call comes back with the reason, so choose another way.
Do not push, switch branches or rewrite history: the person merges through Stint.
When a decision should not be silently reversed, write it on its own line as: decision: <the decision>
When you are done, reply without a tool call: say what you did, what you did not finish and what you did not look at.`;

/** The system prompt for one run: the tool contract plus the skills mounted for the run, when any are. */
export function systemPromptFor(skills: Array<{ name: string; description: string }> = []): string {
  if (skills.length === 0) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\nSkills mounted for this run (their files are under .agents/skills/; read one when its description fits the work):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`;
}

const DEFAULT_CHAIN = ['meta-api/muse-spark-1.3', 'fireworks/muse-spark-open', 'baseten/muse-spark-open', 'modal/muse-spark-open', 'ollama/muse-glimmer:30b-mlx'];
const CALL_TIMEOUT_MS = 120_000;

export type HostCall = { host: string; model: string; providerId: string; client: OpenAI };

class HostError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/** The client for one `host/model` entry, or the reason it cannot be used. */
export function hostCall(entry: string, config: Config, env: Record<string, string | undefined>): HostCall | { unavailable: string } {
  const [host, ...rest] = entry.split('/');
  const model = rest.join('/');
  const h = config.hosts[host as string];
  if (!h) return { unavailable: `no host ${host} in config` };
  const key = h.keyEnv ? env[h.keyEnv] : undefined;
  if (h.keyEnv && !key) return { unavailable: `${h.keyEnv} not set` };
  const baseURL = h.baseURL ?? (h.baseURLEnv ? env[h.baseURLEnv] : undefined);
  if (!baseURL) return { unavailable: `${h.baseURLEnv ?? 'baseURL'} not set` };
  return { host: host as string, model, providerId: h.models[model] ?? model, client: new OpenAI({ apiKey: key ?? 'none', baseURL, maxRetries: 0, timeout: CALL_TIMEOUT_MS }) };
}

function reasonOf(err: unknown): string | null {
  const status = (err as { status?: number }).status;
  if (status === 429) return '429';
  if (typeof status === 'number' && status >= 500) return '5xx';
  const name = (err as { name?: string }).name ?? '';
  if (/timeout/i.test(name) || /timed out/i.test(String(err))) return 'timeout';
  if (/ECONNREFUSED|fetch failed|Connection error/i.test(String(err))) return 'unreachable';
  return null;
}

const short = (args: Record<string, unknown>) => String(args.path ?? args.command ?? args.pattern ?? '').slice(0, 120);

let gateFired = false;

/** Stint's own agent: a tool-calling loop on a Meta model by default (any configured host/model on request), with every call checked by Stint before it runs. */
export function createStintAgent(config: Config = DEFAULT_CONFIG, env: Record<string, string | undefined> = process.env): Adapter {
  const chain = (config.routes as { agent?: string[] }).agent ?? DEFAULT_CHAIN;
  const settings = (config.adapters['stint-agent'] ?? {}) as Record<string, unknown>;

  async function run(ctx: RunContext): Promise<RunResult> {
    const maxTurns = ctx.budget.maxTurns ?? Number(settings.maxTurns ?? 40);
    // `host/model` runs exactly that model (any model on any configured host); a short name starts at its
    // entry in the chain; a name that is in neither is refused rather than swapped for another model
    const explicit = ctx.model?.includes('/') && config.hosts[ctx.model.split('/')[0] as string] ? [ctx.model] : null;
    const entries = explicit ?? chain;
    let at = explicit || !ctx.model ? 0 : entries.findIndex((e) => e.endsWith(`/${ctx.model}`));
    if (at < 0) {
      await ctx.emit({ type: 'agent.message', payload: { text: `The Stint agent has no host for ${ctx.model}; name it as host/model, for example fireworks/${ctx.model}.`, stderr: true } });
      return { endedBy: 'failed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 }, host: 'none', model: ctx.model ?? 'none', inFlight: null };
    }
    const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptFor(ctx.skills ?? []) },
      { role: 'user', content: ctx.prompt },
    ];
    const state: { answered: HostCall | null } = { answered: null };
    // the model drives this shell: keys stay out of it, so an `env` cannot put one in a transcript
    const shellEnv = Object.fromEntries(Object.entries(ctx.env).filter(([k]) => !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(k)));
    let inFlight: string | null = null;
    let lastText = '';
    let invalid = 0;
    const done = (endedBy: RunResult['endedBy']): RunResult => ({
      endedBy,
      cost: { ...usage, usd: null } as Cost,
      host: state.answered?.host ?? entries[at]?.split('/')[0] ?? 'meta-api',
      model: state.answered?.model ?? entries[at]?.split('/').slice(1).join('/') ?? 'muse-spark-1.3',
      inFlight: endedBy === 'killed' ? inFlight : null,
      lastMessage: lastText,
    });

    const complete = async (): Promise<ChatCompletion> => {
      for (; at < entries.length; at++) {
        const entry = entries[at] as string;
        const call = hostCall(entry, config, env);
        const next = entries[at + 1] ?? null;
        if ('unavailable' in call) {
          if (next) await ctx.emit({ type: 'provider.fallback', payload: { role: 'implementer', from: entry, to: next, reason: call.unavailable } });
          continue;
        }
        try {
          const res = await call.client.chat.completions.create(
            { model: call.providerId, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 4096 },
            { signal: ctx.signal },
          );
          state.answered = call;
          return res;
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          const reason = reasonOf(err);
          if (!reason) throw new HostError('error', `${entry}: ${err instanceof Error ? err.message : String(err)}`);
          if (next) await ctx.emit({ type: 'provider.fallback', payload: { role: 'implementer', from: entry, to: next, reason } });
        }
      }
      throw new HostError('exhausted', 'no host in the chain could answer');
    };

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (ctx.signal.aborted) return done('killed');
        if (usage.inputTokens - usage.cachedTokens + usage.outputTokens > ctx.budget.tokens) return done('capped');
        const res = await complete();
        await ctx.transcript(JSON.stringify({ kind: 'response', host: state.answered?.host, model: state.answered?.model, body: res }));
        usage.inputTokens += res.usage?.prompt_tokens ?? 0;
        usage.cachedTokens += res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
        usage.outputTokens += res.usage?.completion_tokens ?? 0;
        const msg = res.choices[0]?.message;
        if (!msg) return done('failed');
        if (msg.content?.trim()) {
          lastText = msg.content.trim();
          await ctx.emit({ type: 'agent.message', payload: { text: lastText.slice(0, 2048) } });
        }
        messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
        const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
        if (calls.length === 0) return done('completed');
        for (const call of calls) {
          const tool = call.function.name;
          const checked = checkCall(tool, call.function.arguments);
          if (!checked.ok) {
            // never run a malformed call: say what was wrong and let the model call again, a few times at most
            invalid += 1;
            await ctx.emit({ type: 'agent.tool_call', payload: { tool, args: { raw: call.function.arguments.slice(0, 500) }, callId: call.id, invalid: checked.reason } });
            await ctx.emit({ type: 'agent.tool_result', payload: { tool, callId: call.id, ok: false, summary: `not run: ${checked.reason}` } });
            messages.push({ role: 'tool', tool_call_id: call.id, content: `That call was not run: ${checked.reason}. Call ${tool} again with arguments that match its definition.` });
            if (invalid > MAX_INVALID) {
              await ctx.emit({ type: 'agent.message', payload: { text: `The Stint agent stopped: ${invalid} tool calls in a row were not valid.`, stderr: true } });
              return done('failed');
            }
            continue;
          }
          invalid = 0;
          const args = checked.args;
          await ctx.emit({ type: 'agent.tool_call', payload: { tool, args, callId: call.id } });
          inFlight = `${tool} ${short(args)}`.trim();
          const out = await runTool(tool, args, ctx.worktree, shellEnv, ctx.signal, ctx.wrap);
          if (ctx.signal.aborted) return done('killed');
          inFlight = null;
          if (out.refused) {
            gateFired = true;
            await ctx.emit({ type: 'rule.blocked', payload: { action: tool === 'bash' ? String(args.command) : `${tool} ${short(args)}`, reason: out.refused, by: 'stint-rules', tool, gate: 'enforced' } });
          }
          await ctx.emit({ type: 'agent.tool_result', payload: { tool, callId: call.id, ok: out.ok, args: out.args, summary: out.summary } });
          // the timeline keeps the summary; the transcript keeps the whole output the model saw
          await ctx.transcript(JSON.stringify({ kind: 'tool_result', tool, callId: call.id, ok: out.ok, output: out.output }));
          messages.push({ role: 'tool', tool_call_id: call.id, content: out.output });
        }
      }
      return done('capped');
    } catch (err) {
      if (ctx.signal.aborted) return done('killed');
      await ctx.emit({ type: 'agent.message', payload: { text: `The Stint agent stopped: ${err instanceof Error ? err.message : String(err)}`, stderr: true } });
      return done('failed');
    }
  }

  return {
    id: 'stint-agent',
    vendor: 'meta',
    roles: ['implementer', 'reviewer'],
    capabilities: { editsFiles: true, runsCommands: true, resumable: false, structuredOutput: true, offline: false },
    async available(): Promise<Availability> {
      const reasons: string[] = [];
      for (const entry of chain) {
        const call = hostCall(entry, config, env);
        if ('unavailable' in call) {
          reasons.push(`${entry}: ${call.unavailable}`);
          continue;
        }
        // a host without a key is local: ask it, briefly, rather than assume it is running
        if (!config.hosts[call.host]?.keyEnv) {
          const up = await fetch(new URL('/api/version', call.client.baseURL).toString(), { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false);
          if (!up) {
            reasons.push(`${entry}: not running`);
            continue;
          }
        }
        return { ok: true, version: `${entry} first` };
      }
      return { ok: false, reason: reasons.join('; ') };
    },
    // Stint runs every call itself, but the gate is reported enforced only once a refusal has fired
    gate: () => (gateFired ? 'enforced' : 'observed'),
    run,
  };
}

export const stintAgentAdapter = createStintAgent();
