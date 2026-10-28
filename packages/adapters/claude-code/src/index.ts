import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Adapter, AgentDef, Availability, EndedBy, RunContext, RunResult } from '@stint-dev/core';
import { ClaudeMapper } from './mapper';

export { ClaudeMapper } from './mapper';
export type { ClaudeRecord } from './mapper';

/**
 * The headless command line (R-034); approvals stay at acceptEdits, never a bypass mode. The task's own test command
 * is the one shell command allowed, so the agent can check its work before the daemon verifies it; any other still asks.
 */
export function claudeArgs(o: { model?: string; sessionId?: string; bin?: string; testCommand?: string }): string[] {
  return [
    o.bin ?? 'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    ...(o.model ? ['--model', o.model] : []),
    ...(o.sessionId ? ['--resume', o.sessionId] : []),
    ...(o.testCommand ? ['--allowedTools', `Bash(${o.testCommand}:*)`] : []),
  ];
}

export function claudeEndedBy(o: { failed: boolean; aborted: boolean; signal: NodeJS.Signals | null; exitCode: number | null }): EndedBy {
  if (o.aborted || o.signal === 'SIGKILL' || o.signal === 'SIGTERM') return 'killed';
  if (o.failed || o.exitCode !== 0) return 'failed';
  return 'completed';
}

/** The address Claude Code's Anthropic client wants for a host: the host's base URL without its `/v1`. */
export function anthropicBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Where the preset's host is, for a run: the base URL always, and for a keyless local host a placeholder token
 * (Ollama takes any). A value the person already set wins. A keyed host's token is passed only through `env`.
 */
export function hostEnv(env: Record<string, string>, host?: { id: string; baseURL?: string; keyless: boolean }): Record<string, string> {
  if (!host?.baseURL) return env;
  return {
    ...env,
    ...(env.ANTHROPIC_BASE_URL ? {} : { ANTHROPIC_BASE_URL: anthropicBase(host.baseURL) }),
    ...(host.keyless && !env.ANTHROPIC_AUTH_TOKEN ? { ANTHROPIC_AUTH_TOKEN: host.id } : {}),
  };
}

/** Claude Code driven headless in the worktree, observed by Stint and verified by the daemon after (R-034). */
export function claudeCode(name: string, def: AgentDef, host?: { id: string; baseURL?: string; keyless: boolean }): Adapter {
  const bin = (def.command[0] as string) || 'claude';

  async function exec(ctx: RunContext, extra: { sessionId?: string; prompt?: string } = {}): Promise<RunResult> {
    const model = ctx.model ?? def.model;
    const argv = claudeArgs({ bin, ...(model ? { model } : {}), ...(extra.sessionId ? { sessionId: extra.sessionId } : {}), testCommand: ctx.task.testCommand });
    const [cmd, ...args] = (ctx.wrap?.(argv) ?? argv) as [string, ...string[]];
    const child = spawn(cmd, args, { cwd: ctx.worktree, env: hostEnv(ctx.env, host), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) ctx.onSpawn?.(child.pid);
    let aborted = false;
    const kill = () => {
      aborted = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    if (ctx.signal.aborted) kill();
    ctx.signal.addEventListener('abort', kill, { once: true });
    const timer = ctx.budget.timeoutMs ? setTimeout(kill, ctx.budget.timeoutMs) : null;
    child.stdin.on('error', () => undefined);
    child.stdin.end(extra.prompt ?? ctx.prompt);
    const mapper = new ClaudeMapper();
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    let chain = Promise.resolve();
    lines.on('line', (line) => {
      chain = chain.then(async () => {
        const raw = await ctx.transcript(line);
        for (const e of mapper.map(line)) {
          await ctx.emit({ ...e, raw: { kind: 'transcript', pointer: raw.pointer, byteLen: raw.byteLen, redacted: false } });
        }
      });
    });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
    await chain;
    if (timer) clearTimeout(timer);
    ctx.signal.removeEventListener('abort', kill);
    const ended = claudeEndedBy({ failed: mapper.failed, aborted, signal: exit.signal, exitCode: exit.code });
    if (ended === 'failed' && stderr.trim()) {
      await ctx.emit({ type: 'agent.message', payload: { text: `Claude Code stopped: ${stderr.trim().split('\n').at(-1)}`, stderr: true } });
    }
    const u = mapper.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    return {
      endedBy: ended,
      // Claude Code prices every model at its own rates, a local one too: a keyless local host costs nothing, another
      // host is priced by the daemon from Stint's prices, and only a run on Anthropic's own API keeps Claude Code's figure
      cost: { ...u, usd: host ? (host.keyless ? 0 : null) : mapper.totalCostUsd, ...(mapper.usage || mapper.totalCostUsd !== null ? {} : { estimated: true }) },
      host: def.host ?? 'local-cli',
      ...(model ? { model } : {}),
      inFlight: ended === 'killed' ? mapper.inFlight() : null,
      lastMessage: mapper.lastMessage,
      ...(mapper.sessionId ? { sessionId: mapper.sessionId } : {}),
    };
  }

  return {
    id: name,
    vendor: def.vendor,
    roles: def.roles,
    ...(def.env ? { needsEnv: def.env } : {}),
    capabilities: {
      editsFiles: true,
      runsCommands: true,
      resumable: def.capabilities?.resume ?? true,
      structuredOutput: def.capabilities?.schemaOutput ?? true,
      offline: def.vendor === 'local' || def.host === 'ollama',
    },
    async available(): Promise<Availability> {
      // the PATH as it is now, not as the process started: a test or a launcher may have changed it
      return Bun.which(bin, { PATH: process.env.PATH ?? '' }) ? { ok: true, version: bin } : { ok: false, reason: `${bin} is not on PATH` };
    },
    // Stint classifies Claude Code tool calls but cannot stop one: the gate is observed.
    gate: () => 'observed',
    run: (ctx) => exec(ctx),
    resume: (ctx) => exec(ctx, { sessionId: ctx.sessionId, prompt: ctx.instruction }),
  };
}

export const createClaudeCode = claudeCode;
