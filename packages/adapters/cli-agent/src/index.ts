import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Adapter, AdapterEvent, AgentDef, AgentEvents, Availability, Config, RunContext, RunResult, Usage } from '@stint-dev/core';

const LINE_CAP = 2048;
const cap = (s: string) => (s.length > LINE_CAP ? `${s.slice(0, LINE_CAP)}...` : s);

/** Reads a dotted path such as `message.content` or `usage.input_tokens` out of a JSON value. */
export function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const asArgs = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* a plain string argument */
    }
    return { value: v.slice(0, 400) };
  }
  return {};
};
const asCount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);

/** Maps one agent's JSONL lines onto Stint events from its manifest paths, in the Muse mapper's style (R-032). */
export class ManifestMapper {
  sessionId: string | null = null;
  usage: Usage | null = null;
  private openCalls = new Map<string, string>();
  private counter = 0;

  constructor(private readonly events: AgentEvents) {}

  private readUsage(obj: unknown): void {
    const u = this.events.usage;
    if (!u) return;
    const input = asCount(getPath(obj, u.input));
    const output = asCount(getPath(obj, u.output));
    if (input === null || output === null) return;
    const cached = u.cached ? (asCount(getPath(obj, u.cached)) ?? 0) : 0;
    // A usage line carries the running total, as Muse reports it; the last one wins.
    this.usage = { inputTokens: input, cachedTokens: cached, outputTokens: output };
  }

  map(line: string): AdapterEvent[] {
    let obj: unknown;
    try {
      obj = JSON.parse(line) as unknown;
    } catch {
      return [{ type: 'runtime.unclassified', payload: { originalType: 'unparsable', excerpt: cap(line.slice(0, 400)) } }];
    }
    const session = asText(getPath(obj, this.events.session));
    if (session) this.sessionId = session;
    this.readUsage(obj);
    const kind = asText(getPath(obj, this.events.type));
    const kinds = this.events.kinds;
    if (kinds.usage.includes(kind)) return [];
    if (kinds.message.includes(kind)) {
      const text = asText(getPath(obj, this.events.text));
      return text.trim() ? [{ type: 'agent.message', payload: { text: cap(text.trim()) } }] : [];
    }
    if (kinds.tool_call.includes(kind)) {
      const tool = asText(getPath(obj, this.events.tool)) || 'tool';
      const callId = asText(getPath(obj, this.events.callId)) || `call-${++this.counter}`;
      this.openCalls.set(callId, tool);
      return [{ type: 'agent.tool_call', payload: { tool, args: asArgs(getPath(obj, this.events.args)), callId } }];
    }
    if (kinds.tool_result.includes(kind)) {
      const callId = asText(getPath(obj, this.events.callId)) || [...this.openCalls.keys()].at(-1) || `call-${++this.counter}`;
      const tool = asText(getPath(obj, this.events.tool)) || this.openCalls.get(callId) || 'tool';
      this.openCalls.delete(callId);
      const raw = getPath(obj, this.events.result) ?? getPath(obj, this.events.text);
      const summary = cap((asText(raw) || (raw === undefined ? '' : JSON.stringify(raw))).split('\n')[0]?.slice(0, 200) ?? '');
      return [{ type: 'agent.tool_result', payload: { tool, callId, ok: true, summary } }];
    }
    return [{ type: 'runtime.unclassified', payload: { originalType: kind || 'unknown', excerpt: cap(JSON.stringify(obj).slice(0, 400)) } }];
  }

  /** The last tool call with no result: what a kill interrupts. */
  inFlight(): string | null {
    return [...this.openCalls.values()].at(-1) ?? null;
  }
}

/** The argv for a run: `{prompt}` becomes the prompt file's path, or the prompt itself when the agent takes it as an argument. */
export function agentArgv(def: AgentDef, ctx: Pick<RunContext, 'prompt' | 'promptPath' | 'model'>): string[] {
  const model = ctx.model ?? def.model;
  const argv: string[] = [];
  for (const part of def.command) {
    if (part.includes('{model}') && !model) continue;
    argv.push(part.replaceAll('{model}', model ?? '').replaceAll('{prompt}', def.prompt === 'arg' ? ctx.prompt : ctx.promptPath));
  }
  argv.push(...(def.permissions?.flags ?? []));
  if (def.prompt === 'arg' && !def.command.some((p) => p.includes('{prompt}'))) argv.push(ctx.prompt);
  if (def.prompt === 'file' && !def.command.some((p) => p.includes('{prompt}'))) argv.push(ctx.promptPath);
  return argv;
}

/** Any coding agent with a command line, driven in the worktree; Stint observes it and verifies after (R-026). */
export function cliAgent(name: string, def: AgentDef): Adapter {
  async function exec(ctx: RunContext, extra: string[] = [], promptOverride?: string): Promise<RunResult> {
    const prompt = promptOverride ?? ctx.prompt;
    const argv = [...agentArgv(def, { ...ctx, prompt }), ...extra];
    const [cmd, ...args] = (ctx.wrap?.(argv) ?? argv) as [string, ...string[]];
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
      child.stdin?.end(prompt);
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
    const mapper = def.events ? new ManifestMapper(def.events) : null;
    if (child.stdout) {
      for await (const line of createInterface({ input: child.stdout })) {
        if (!line.trim()) continue;
        const raw = await ctx.transcript(line);
        lastOut = line.trim();
        if (mapper) {
          for (const e of mapper.map(line)) {
            await ctx.emit({ ...e, raw: { kind: 'transcript', pointer: raw.pointer, byteLen: raw.byteLen, redacted: false } });
            if (e.type === 'agent.message') lastOut = String(e.payload.text ?? lastOut);
          }
        } else {
          await ctx.emit({ type: 'agent.message', payload: { text: lastOut.slice(0, LINE_CAP) } });
        }
      }
    }
    const e = await exit;
    if (timer) clearTimeout(timer);
    ctx.signal.removeEventListener('abort', kill);
    const endedBy = aborted || e.signal === 'SIGKILL' || e.signal === 'SIGTERM' ? 'killed' : e.code === 0 ? 'completed' : 'failed';
    if (endedBy === 'failed') await ctx.emit({ type: 'agent.message', payload: { text: `${name} exited ${e.error ? `before starting: ${e.error.message}` : `with code ${e.code}`}${lastErr ? `: ${lastErr.slice(0, 400)}` : ''}`, stderr: true } });
    const model = ctx.model ?? def.model ?? name;
    // Generic agents bill under <agent>/<model>; the daemon maps local-cli to that key. The manifest host stays in health.
    const host = 'local-cli';
    const usage = mapper?.usage ?? null;
    // With reported usage the daemon prices the run under <agent>/<model>; without it the run is unpriced, not free.
    const cost = usage ? { ...usage, usd: null } : { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true };
    return {
      endedBy,
      cost,
      host,
      model,
      inFlight: endedBy === 'killed' ? (mapper?.inFlight() ?? null) : null,
      lastMessage: lastOut,
      ...(mapper?.sessionId ? { sessionId: mapper.sessionId } : {}),
    };
  }

  const adapter: Adapter = {
    id: name,
    vendor: def.vendor,
    roles: def.roles,
    ...(def.env ? { needsEnv: def.env } : {}),
    capabilities: {
      editsFiles: true,
      runsCommands: true,
      resumable: def.capabilities?.resume ?? !!def.resume,
      structuredOutput: def.capabilities?.schemaOutput ?? !!def.events,
      offline: def.vendor === 'local',
    },
    async available(): Promise<Availability> {
      const bin = def.command[0] as string;
      return Bun.which(bin) ? { ok: true, version: bin } : { ok: false, reason: `${bin} is not on PATH` };
    },
    gate: () => 'observed',
    run: (ctx) => exec(ctx),
  };
  if (def.resume) {
    adapter.resume = (ctx) => exec(ctx, [def.resume?.flag as string, ctx.sessionId], ctx.instruction);
  }
  return adapter;
}

/** The adapters for every enabled generic (`cli` harness) agent in config; native harnesses are built by the daemon. */
export function cliAgents(config: Pick<Config, 'agents'>): Adapter[] {
  return Object.entries(config.agents ?? {})
    .filter(([, def]) => def.enabled && !def.acp && (def.harness ?? 'cli') === 'cli')
    .map(([name, def]) => cliAgent(name, def));
}
