import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Adapter, AgentDef, Availability, EndedBy, PermissionOption, RunContext, RunResult } from '@stint-dev/core';

// Agent Client Protocol, protocol version 1: JSON-RPC 2.0, one JSON object per line on stdio.
// Method and field names checked against https://agentclientprotocol.com/protocol/v1/overview.md
// (initialize, session/new, session/prompt, session/cancel, session/update,
// session/request_permission, fs/read_text_file, fs/write_text_file, terminal/*).

const TEXT_CAP = 2048;
const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
const cap = (s: string) => (s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}...` : s);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** How a prompt stop reason ends a Stint run (R-033). */
export function endedByForStopReason(stopReason: string | undefined, aborted: boolean): EndedBy {
  if (aborted) return 'killed';
  switch (stopReason) {
    case 'end_turn':
      return 'completed';
    case 'max_tokens':
    case 'max_turn_requests':
      return 'capped';
    case 'refusal':
      return 'failed';
    case 'cancelled':
      return 'killed';
    default:
      return stopReason ? 'completed' : 'failed';
  }
}

// The same credential rule as the Stint agent refusal checks (packages/adapters/stint-agent/src/refusals.ts).
const CREDENTIAL_PATH = /(^|\/)(\.env(\.[\w.-]+)?|\.netrc|\.npmrc|id_(rsa|ed25519|ecdsa)(\.pub)?|\.ssh\/.*|\.aws\/.*|\.docker\/config\.json)$/;

/**
 * Resolves `p` inside the worktree, following symlinks on the part that exists.
 * Returns the absolute path and its worktree-relative form, or the reason it is refused.
 */
export function resolveInsideWorktree(worktree: string, p: unknown): { full: string; rel: string } | { reason: string } {
  if (typeof p !== 'string' || p.length === 0) return { reason: 'a path is required' };
  let wtReal = resolve(worktree);
  try {
    wtReal = realpathSync(wtReal);
  } catch {
    // the worktree is created by the daemon before a run, so this only guards odd test paths
  }
  const wanted = resolve(wtReal, p);
  const wantedRel = relative(wtReal, wanted);
  if (wantedRel.startsWith('..') || isAbsolute(wantedRel)) return { reason: `${p} is outside the worktree` };
  if (wantedRel.split(sep).includes('.git')) return { reason: 'the .git folder belongs to Stint' };
  if (wantedRel && CREDENTIAL_PATH.test(wantedRel.split(sep).join('/'))) return { reason: `${p} is a credential file` };
  let existing = wanted;
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    suffix.unshift(basename(existing));
    existing = parent;
  }
  let full = wanted;
  try {
    full = suffix.length ? join(realpathSync(existing), ...suffix) : realpathSync(existing);
  } catch {
    full = wanted;
  }
  const rel = relative(wtReal, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return { reason: `${p} is outside the worktree` };
  return { full, rel: rel || '.' };
}

type RpcId = string | number;
type RpcMessage = {
  jsonrpc?: string;
  id?: RpcId | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type TerminalState = {
  id: string;
  child: ChildProcess;
  output: string;
  truncated: boolean;
  limit: number;
  done: Promise<{ exitCode: number | null; signal: string | null }>;
  exit?: { exitCode: number | null; signal: string | null };
};

function envRecord(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const item of value) {
      const r = rec(item);
      if (str(r.name)) out[str(r.name)] = str(r.value);
    }
    return out;
  }
  const r = rec(value);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === 'string') out[k] = v;
  return out;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const r = rec(b);
        if (str(r.text)) return str(r.text);
        const inner = rec(r.content);
        return str(inner.text);
      })
      .filter(Boolean)
      .join('\n');
  }
  const r = rec(content);
  if (str(r.text)) return str(r.text);
  const inner = rec(r.content);
  if (str(inner.text)) return str(inner.text);
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

/** The argv that starts an agent ACP server: the configured command, with {model} and {prompt} filled in. */
export function acpArgv(def: AgentDef, ctx: Pick<RunContext, 'model' | 'promptPath'>): string[] {
  const model = ctx.model ?? def.model;
  const argv: string[] = [];
  for (const part of def.command) {
    if (part.includes('{model}') && !model) continue;
    argv.push(part.replaceAll('{model}', model ?? '').replaceAll('{prompt}', ctx.promptPath));
  }
  argv.push(...(def.permissions?.flags ?? []));
  return argv;
}

/** Any agent that speaks the Agent Client Protocol, with Stint as the client (R-033). */
export function acpAgent(name: string, def: AgentDef): Adapter {
  const bin = (def.command[0] as string) || name;

  async function exec(ctx: RunContext): Promise<RunResult> {
    const model = ctx.model ?? def.model;
    const argv = acpArgv(def, ctx);
    const [cmd, ...args] = (ctx.wrap?.(argv) ?? argv) as [string, ...string[]];
    const child = spawn(cmd, args, { cwd: ctx.worktree, env: ctx.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) ctx.onSpawn?.(child.pid);

    let aborted = false;
    let sessionId = '';
    let nextId = 1;
    let writeCounter = 0;
    let terminalCounter = 0;
    let permissionCounter = 0;
    let messageBuffer = '';
    let lastMessage = '';
    let stderr = '';
    const openCalls = new Map<string, string>();
    const pending = new Map<RpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const terminals = new Map<string, TerminalState>();

    const forceKill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    const kill = () => {
      if (aborted) return;
      aborted = true;
      if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      forceTimer = setTimeout(forceKill, 300);
    };
    if (ctx.signal.aborted) kill();
    ctx.signal.addEventListener('abort', kill, { once: true });
    const timer = ctx.budget.timeoutMs ? setTimeout(kill, ctx.budget.timeoutMs) : null;

    child.stdin.on('error', () => undefined);
    child.stderr.on('data', (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolveExit) => {
      child.on('error', (error) => resolveExit({ code: null, signal: null, error }));
      child.on('close', (code, signal) => resolveExit({ code, signal }));
    });
    void exitPromise.then(() => {
      for (const p of pending.values()) p.reject(new Error('the ACP agent stopped before answering'));
      pending.clear();
    });

    function send(msg: RpcMessage): void {
      const line = JSON.stringify(msg);
      void ctx.transcript(line).catch(() => undefined);
      try {
        child.stdin.write(`${line}\n`);
      } catch {
        // the agent is gone; the close handler settles every pending request
      }
    }
    function request(method: string, params: Record<string, unknown>): Promise<unknown> {
      const id = nextId++;
      return new Promise<unknown>((resolveReq, rejectReq) => {
        pending.set(id, { resolve: resolveReq, reject: rejectReq });
        send({ jsonrpc: '2.0', id, method, params });
      });
    }
    const reply = (id: RpcId, result: unknown) => send({ jsonrpc: '2.0', id, result });
    const replyError = (id: RpcId, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

    async function flushMessage(): Promise<void> {
      const text = messageBuffer.trim();
      messageBuffer = '';
      if (!text) return;
      lastMessage = text;
      await ctx.emit({ type: 'agent.message', payload: { text: cap(text) } });
    }

    async function blocked(action: string, path: unknown, reason: string): Promise<void> {
      await ctx.emit({ type: 'rule.blocked', payload: { by: 'stint-acp', action: `${action} ${str(path)}`.trim(), reason, path: str(path) } });
    }

    async function handleUpdate(params: Record<string, unknown>): Promise<void> {
      const update = rec(params.update);
      const kind = str(update.sessionUpdate);
      if (kind === 'agent_message_chunk') {
        messageBuffer += textOf(update.content);
        return;
      }
      // thoughts are the agent thinking out loud; the timeline keeps what it said and did
      if (kind === 'agent_thought_chunk') return;
      await flushMessage();
      if (kind === 'tool_call') {
        const callId = str(update.toolCallId) || `acp-call-${openCalls.size + 1}`;
        const tool = str(update.kind) || str(update.title) || 'tool';
        openCalls.set(callId, tool);
        const args = update.rawInput && typeof update.rawInput === 'object' && !Array.isArray(update.rawInput) ? (update.rawInput as Record<string, unknown>) : {};
        await ctx.emit({
          type: 'agent.tool_call',
          payload: { tool, args, callId, ...(str(update.title) ? { title: str(update.title) } : {}), ...(update.locations !== undefined ? { locations: update.locations } : {}), ...(str(update.status) ? { status: str(update.status) } : {}) },
        });
        return;
      }
      if (kind === 'tool_call_update') {
        const status = str(update.status);
        if (status !== 'completed' && status !== 'failed') return;
        const callId = str(update.toolCallId) || [...openCalls.keys()].at(-1) || 'acp-call-unknown';
        const tool = openCalls.get(callId) ?? str(update.kind) ?? 'tool';
        openCalls.delete(callId);
        const text = textOf(update.content) || textOf(update.rawOutput);
        await ctx.emit({ type: 'agent.tool_result', payload: { tool: tool || 'tool', callId, ok: status === 'completed', summary: cap((text.split('\n')[0] ?? '').slice(0, 200)), ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}) } });
        return;
      }
      if (kind === 'plan') {
        await ctx.emit({ type: 'agent.message', payload: { text: cap(textOf(update.content) || JSON.stringify(update).slice(0, 200)), plan: update } });
        return;
      }
      await ctx.emit({ type: 'runtime.unclassified', payload: { originalType: kind || 'session/update', excerpt: cap(JSON.stringify(update).slice(0, 400)) } });
    }

    async function handleFs(id: RpcId, method: string, params: Record<string, unknown>): Promise<void> {
      const checked = resolveInsideWorktree(ctx.worktree, params.path);
      if ('reason' in checked) {
        await blocked(method, params.path, checked.reason);
        replyError(id, -32602, checked.reason);
        return;
      }
      if (method === 'fs/read_text_file') {
        try {
          const content = await readFile(checked.full, 'utf8');
          const lines = content.split('\n');
          const from = Math.max(1, Math.round(num(params.line) ?? 1));
          const limit = num(params.limit);
          const sliced = lines.slice(from - 1, limit === undefined ? undefined : from - 1 + Math.max(0, Math.round(limit)));
          reply(id, { content: sliced.join('\n') });
        } catch (err) {
          replyError(id, -32603, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      const callId = `acp-write-${++writeCounter}`;
      await ctx.emit({ type: 'agent.tool_call', payload: { tool: 'write_file', args: { path: checked.rel }, callId } });
      try {
        await mkdir(dirname(checked.full), { recursive: true });
        await writeFile(checked.full, str(params.content), 'utf8');
        await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'write_file', callId, ok: true, summary: `wrote ${checked.rel}` } });
        reply(id, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.emit({ type: 'agent.tool_result', payload: { tool: 'write_file', callId, ok: false, summary: cap(message.slice(0, 200)) } });
        replyError(id, -32603, message);
      }
    }

    function killTerminal(t: TerminalState): void {
      try {
        if (t.child.pid) process.kill(-t.child.pid, 'SIGKILL');
      } catch {
        t.child.kill('SIGKILL');
      }
    }

    async function handleTerminal(id: RpcId, method: string, params: Record<string, unknown>): Promise<void> {
      if (method === 'terminal/create') {
        const command = str(params.command);
        if (!command) {
          replyError(id, -32602, 'a command is required');
          return;
        }
        const cwdChecked = params.cwd === undefined ? { full: ctx.worktree, rel: '.' } : resolveInsideWorktree(ctx.worktree, params.cwd);
        if ('reason' in cwdChecked) {
          await blocked(method, params.cwd, cwdChecked.reason);
          replyError(id, -32602, cwdChecked.reason);
          return;
        }
        const args = Array.isArray(params.args) ? params.args.map((a) => String(a)) : [];
        const termArgv = [command, ...args];
        const [tcmd, ...targs] = (ctx.wrap?.(termArgv) ?? termArgv) as [string, ...string[]];
        const limit = Math.max(1, Math.round(num(params.outputByteLimit) ?? DEFAULT_OUTPUT_LIMIT));
        const termChild = spawn(tcmd, targs, { cwd: cwdChecked.full, env: { ...ctx.env, ...envRecord(params.env) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const tid = `terminal-${++terminalCounter}`;
        const state: TerminalState = {
          id: tid,
          child: termChild,
          output: '',
          truncated: false,
          limit,
          done: new Promise((resolveDone) => {
            termChild.on('error', () => resolveDone({ exitCode: null, signal: null }));
            termChild.on('close', (code, signal) => resolveDone({ exitCode: code, signal: signal ?? null }));
          }),
        };
        const onData = (b: Buffer) => {
          state.output += b.toString('utf8');
          if (Buffer.byteLength(state.output, 'utf8') > state.limit) {
            state.truncated = true;
            const buf = Buffer.from(state.output, 'utf8');
            state.output = buf.subarray(buf.length - state.limit).toString('utf8');
          }
        };
        termChild.stdout?.on('data', onData);
        termChild.stderr?.on('data', onData);
        void state.done.then((exit) => {
          state.exit = exit;
        });
        terminals.set(tid, state);
        reply(id, { terminalId: tid });
        return;
      }
      const t = terminals.get(str(params.terminalId));
      if (!t) {
        replyError(id, -32602, `no terminal ${str(params.terminalId)}`);
        return;
      }
      if (method === 'terminal/output') {
        reply(id, { output: t.output, truncated: t.truncated, ...(t.exit ? { exitStatus: { exitCode: t.exit.exitCode, signal: t.exit.signal } } : {}) });
      } else if (method === 'terminal/wait_for_exit') {
        const exit = await t.done;
        t.exit = exit;
        reply(id, { exitCode: exit.exitCode, signal: exit.signal });
      } else if (method === 'terminal/kill') {
        killTerminal(t);
        reply(id, null);
      } else if (method === 'terminal/release') {
        killTerminal(t);
        terminals.delete(t.id);
        reply(id, null);
      } else {
        replyError(id, -32601, `method not found: ${method}`);
      }
    }

    async function handlePermission(id: RpcId, params: Record<string, unknown>): Promise<void> {
      const toolCall = rec(params.toolCall);
      const title = str(toolCall.title) || str(params.title) || 'Run a tool';
      const tool = str(toolCall.kind) || str(toolCall.title) || str(params.tool) || 'tool';
      const rawOptions = Array.isArray(params.options) ? params.options : [];
      const options: PermissionOption[] = rawOptions.map((o) => {
        const r = rec(o);
        return { optionId: str(r.optionId), name: str(r.name) || str(r.optionId), kind: str(r.kind) || 'allow_once' };
      });
      if (!ctx.askPermission) {
        reply(id, { outcome: { outcome: 'cancelled' } });
        return;
      }
      const requestId = `perm-${++permissionCounter}`;
      let answer: { optionId: string } | 'cancelled';
      try {
        answer = await ctx.askPermission({ requestId, tool, title, options });
      } catch {
        answer = 'cancelled';
      }
      if (answer === 'cancelled') reply(id, { outcome: { outcome: 'cancelled' } });
      else reply(id, { outcome: { outcome: 'selected', optionId: answer.optionId } });
    }

    async function handleAgentRequest(msg: RpcMessage): Promise<void> {
      const id = msg.id as RpcId;
      const method = msg.method as string;
      const params = rec(msg.params);
      try {
        if (method === 'fs/read_text_file' || method === 'fs/write_text_file') await handleFs(id, method, params);
        else if (method.startsWith('terminal/')) await handleTerminal(id, method, params);
        else if (method === 'session/request_permission') await handlePermission(id, params);
        else replyError(id, -32601, `method not found: ${method}`);
      } catch (err) {
        replyError(id, -32603, err instanceof Error ? err.message : String(err));
      }
    }

    const lines = createInterface({ input: child.stdout });
    let chain = Promise.resolve();
    lines.on('line', (line) => {
      if (!line.trim()) return;
      chain = chain.then(async () => {
        const raw = await ctx.transcript(line).catch(() => ({ pointer: 'transcript.jsonl:0', byteLen: line.length }));
        void raw;
        let msg: RpcMessage;
        try {
          msg = JSON.parse(line) as RpcMessage;
        } catch {
          await ctx.emit({ type: 'runtime.unclassified', payload: { originalType: 'acp.unparsable', excerpt: cap(line.slice(0, 400)) } });
          return;
        }
        if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`));
            else p.resolve(msg.result ?? null);
          }
          return;
        }
        if (msg.method === 'session/update') {
          await handleUpdate(rec(msg.params));
          return;
        }
        if (msg.method && msg.id !== undefined && msg.id !== null) {
          await handleAgentRequest(msg);
          return;
        }
        if (msg.method) {
          await ctx.emit({ type: 'runtime.unclassified', payload: { originalType: msg.method, excerpt: cap(line.slice(0, 400)) } });
        }
      });
    });

    let stopReason: string | undefined;
    let failure = '';
    try {
      if (aborted) throw new Error('stopped before the ACP session started');
      await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      const created = rec(await request('session/new', { cwd: ctx.worktree, mcpServers: [] }));
      sessionId = str(created.sessionId);
      if (!sessionId) throw new Error('the ACP agent did not return a sessionId');
      if (aborted) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      const prompted = rec(await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: ctx.prompt }] }));
      stopReason = str(prompted.stopReason) || undefined;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    await flushMessage().catch(() => undefined);
    // the agent may exit on its own after answering; give it a moment, then make sure it is gone
    const exited = await Promise.race([exitPromise.then(() => true), Bun.sleep(250).then(() => false)]);
    if (!exited) forceKill();
    const exit = await exitPromise;
    await chain.catch(() => undefined);
    await flushMessage().catch(() => undefined);
    if (timer) clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    ctx.signal.removeEventListener('abort', kill);
    for (const t of terminals.values()) killTerminal(t);
    terminals.clear();

    let endedBy = endedByForStopReason(stopReason, aborted);
    if (!stopReason && !aborted) endedBy = exit.code === 0 && !failure ? 'completed' : 'failed';
    if (endedBy === 'failed' && (failure || stderr.trim())) {
      const detail = (failure || stderr.trim().split('\n').at(-1) || '').slice(0, 400);
      if (detail) await ctx.emit({ type: 'agent.message', payload: { text: `${name} stopped: ${detail}`, stderr: true } }).catch(() => undefined);
    }
    return {
      endedBy,
      // ACP version 1 does not report token usage, so the run stays unpriced rather than free
      cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true },
      host: def.host ?? 'local-cli',
      ...(model ? { model } : {}),
      inFlight: endedBy === 'killed' ? ([...openCalls.values()].at(-1) ?? null) : null,
      lastMessage,
      ...(sessionId ? { sessionId } : {}),
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
      resumable: def.capabilities?.resume ?? false,
      structuredOutput: def.capabilities?.schemaOutput ?? false,
      offline: def.vendor === 'local' || def.host === 'ollama',
    },
    async available(): Promise<Availability> {
      return Bun.which(bin) ? { ok: true, version: bin } : { ok: false, reason: `${bin} is not on PATH` };
    },
    // Stint answers file, terminal and permission calls, but the agent process itself is observed.
    gate: () => 'observed',
    run: (ctx) => exec(ctx),
  };
}

