import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Adapter, AgentDef, Availability, Config, RunContext, RunResult } from '@stint-dev/core';

const LINE_CAP = 2048;

/** The argv for a run: `{prompt}` becomes the prompt file's path, or the prompt itself when the agent takes it as an argument. */
export function agentArgv(def: AgentDef, ctx: Pick<RunContext, 'prompt' | 'promptPath' | 'model'>): string[] {
  const model = ctx.model ?? def.model;
  const argv: string[] = [];
  for (const part of def.command) {
    if (part.includes('{model}') && !model) continue;
    argv.push(part.replaceAll('{model}', model ?? '').replaceAll('{prompt}', def.prompt === 'arg' ? ctx.prompt : ctx.promptPath));
  }
  if (def.prompt === 'arg' && !def.command.some((p) => p.includes('{prompt}'))) argv.push(ctx.prompt);
  if (def.prompt === 'file' && !def.command.some((p) => p.includes('{prompt}'))) argv.push(ctx.promptPath);
  return argv;
}

/** Any coding agent with a command line, driven in the worktree; Stint observes it and verifies after (R-026). */
export function cliAgent(name: string, def: AgentDef): Adapter {
  async function run(ctx: RunContext): Promise<RunResult> {
    const [cmd, ...args] = agentArgv(def, ctx) as [string, ...string[]];
    const child = spawn(cmd, args, { cwd: ctx.worktree, env: ctx.env, detached: true, stdio: [def.prompt === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
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
    if (def.prompt === 'stdin') {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(ctx.prompt);
    }
    let lastErr = '';
    let lastOut = '';
    child.stderr?.on('data', (b: Buffer) => {
      const lines = b.toString('utf8').trim().split('\n');
      lastErr = lines.at(-1) ?? lastErr;
    });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
      child.on('error', (error) => resolve({ code: null, signal: null, error }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    if (child.stdout) {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.trim()) continue;
        await ctx.transcript(line);
        lastOut = line.trim();
        await ctx.emit({ type: 'agent.message', payload: { text: lastOut.slice(0, LINE_CAP) } });
      }
    }
    const e = await exit;
    if (timer) clearTimeout(timer);
    ctx.signal.removeEventListener('abort', kill);
    const endedBy = aborted || e.signal === 'SIGKILL' || e.signal === 'SIGTERM' ? 'killed' : e.code === 0 ? 'completed' : 'failed';
    if (endedBy === 'failed') await ctx.emit({ type: 'agent.message', payload: { text: `${name} exited ${e.error ? `before starting: ${e.error.message}` : `with code ${e.code}`}${lastErr ? `: ${lastErr.slice(0, 400)}` : ''}`, stderr: true } });
    // the agent's usage is not reported to Stint, so the run is unpriced rather than free
    return { endedBy, cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true }, host: 'local-cli', model: ctx.model ?? def.model ?? name, inFlight: null, lastMessage: lastOut };
  }

  return {
    id: name,
    vendor: def.vendor,
    roles: def.roles,
    capabilities: { editsFiles: true, runsCommands: true, resumable: false, structuredOutput: false, offline: def.vendor === 'local' },
    async available(): Promise<Availability> {
      const bin = def.command[0] as string;
      return Bun.which(bin) ? { ok: true, version: bin } : { ok: false, reason: `${bin} is not on PATH` };
    },
    gate: () => 'observed',
    run,
  };
}

/** The adapters for every enabled agent in config. */
export function cliAgents(config: Pick<Config, 'agents'>): Adapter[] {
  return Object.entries(config.agents ?? {})
    .filter(([, def]) => def.enabled)
    .map(([name, def]) => cliAgent(name, def));
}
