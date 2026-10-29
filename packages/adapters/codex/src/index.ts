import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Adapter, AgentDef, Availability, EndedBy, RunContext, RunResult } from '@stint-dev/core';
import { CodexMapper } from './mapper';

export { CodexMapper } from './mapper';
export type { CodexRecord } from './mapper';

/** A Stint host Codex should use instead of whatever its own config names: an OpenAI-compatible base URL and the variable its key is in. */
export type CodexProvider = { id: string; baseURL: string; keyEnv: string };

/**
 * The non-interactive command line (R-034); the sandbox stays at workspace-write. With a provider, Codex is pointed at that
 * host through `-c` overrides for this run only, so the person's own Codex config is never edited. Codex speaks only the
 * Responses API, which the Meta Model API serves.
 */
export function codexArgs(o: { model?: string; threadId?: string; bin?: string; provider?: CodexProvider }): string[] {
  const bin = o.bin ?? 'codex';
  const p = o.provider;
  const config = p ? ['-c', `model_provider="stint-${p.id}"`, '-c', `model_providers.stint-${p.id}={ name = "${p.id}", base_url = "${p.baseURL}", env_key = "${p.keyEnv}", wire_api = "responses" }`] : [];
  if (o.threadId) {
    return [bin, ...config, 'exec', 'resume', '--json', '--sandbox', 'workspace-write', ...(o.model ? ['--model', o.model] : []), o.threadId, '-'];
  }
  return [bin, ...config, 'exec', '--json', '--sandbox', 'workspace-write', ...(o.model ? ['--model', o.model] : []), '-'];
}

export function codexEndedBy(o: { failed: boolean; aborted: boolean; signal: NodeJS.Signals | null; exitCode: number | null }): EndedBy {
  if (o.aborted || o.signal === 'SIGKILL' || o.signal === 'SIGTERM') return 'killed';
  if (o.failed || o.exitCode !== 0) return 'failed';
  return 'completed';
}

/** Codex driven with `codex exec --json` in the worktree, observed by Stint and verified by the daemon after (R-034). */
export function codex(name: string, def: AgentDef, provider?: CodexProvider): Adapter {
  const bin = (def.command[0] as string) || 'codex';

  async function exec(ctx: RunContext, extra: { threadId?: string; prompt?: string } = {}): Promise<RunResult> {
    const model = ctx.model ?? def.model;
    const argv = codexArgs({ bin, ...(model ? { model } : {}), ...(extra.threadId ? { threadId: extra.threadId } : {}), ...(provider ? { provider } : {}) });
    const [cmd, ...args] = (ctx.wrap?.(argv) ?? argv) as [string, ...string[]];
    const child = spawn(cmd, args, { cwd: ctx.worktree, env: ctx.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const mapper = new CodexMapper();
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
    const ended = codexEndedBy({ failed: mapper.failed, aborted, signal: exit.signal, exitCode: exit.code });
    if (ended === 'failed' && stderr.trim()) {
      await ctx.emit({ type: 'agent.message', payload: { text: `Codex stopped: ${stderr.trim().split('\n').at(-1)}`, stderr: true } });
    }
    const u = mapper.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    return {
      endedBy: ended,
      // Usage without a price is priced by the daemon under <agent>/<model>.
      cost: { ...u, usd: null, ...(mapper.usage ? {} : { estimated: true }) },
      host: def.host ?? 'local-cli',
      ...(model ? { model } : {}),
      inFlight: ended === 'killed' ? mapper.inFlight() : null,
      lastMessage: mapper.lastMessage,
      ...(mapper.threadId ? { sessionId: mapper.threadId } : {}),
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
    // Stint classifies Codex tool calls but cannot stop one: the gate is observed.
    gate: () => 'observed',
    run: (ctx) => exec(ctx),
    resume: (ctx) => exec(ctx, { threadId: ctx.sessionId, prompt: ctx.instruction }),
  };
}

export const createCodex = codex;
