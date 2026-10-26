import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Adapter, Availability, EndedBy, Enrichment, RunContext, RunResult } from '@stint-dev/core';
import { MuseMapper } from './mapper';

export { MuseMapper } from './mapper';
export type { MuseRecord, MuseTerminal } from './mapper';

const DEFAULT_MODEL = 'muse-spark-1.3';
const CAPPED = /step|budget|limit|max/i;

/**
 * The arguments for a daemon-driven run. Muse's own approval policy and sandbox stay on: Stint does not
 * bypass them. Reminder agents are off so the metered cost is the run's own; personal skills from
 * other projects are excluded so a run depends on the repository, not on this machine.
 */
export function museArgs(o: { promptPath: string; model: string; steps: number; sessionId?: string; outputSchema?: string }): string[] {
  return [
    'exec',
    '--json',
    '--prompt-file',
    o.promptPath,
    '--model',
    o.model,
    '--max-model-steps',
    String(o.steps),
    '--trust-workspace',
    '--disable-reminders',
    '--no-foreign-personal-context',
    ...(o.sessionId ? ['--session-id', o.sessionId] : []),
    ...(o.outputSchema ? ['--output-schema', o.outputSchema] : []),
  ];
}

/** How a run ended, from what Muse reported and what happened to the process. */
export function endedBy(o: { terminal: { kind: string; reason: string | null } | null; aborted: boolean; signal: NodeJS.Signals | null; exitCode: number | null }): EndedBy {
  if (o.aborted || o.signal === 'SIGKILL' || o.signal === 'SIGTERM') return 'killed';
  const t = o.terminal;
  if (!t) return 'failed';
  if (t.reason && CAPPED.test(t.reason)) return 'capped';
  if (t.kind === 'completed') return 'completed';
  if (t.kind === 'cancelled') return 'failed';
  return 'failed';
}

async function museVersion(): Promise<string | null> {
  try {
    const p = Bun.spawn(['muse', '--version'], { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

/** Runs one `muse exec --json` in the worktree and streams it into the daemon. */
async function exec(ctx: RunContext, extra: { sessionId?: string } = {}): Promise<RunResult> {
  const model = ctx.model ?? DEFAULT_MODEL;
  const steps = ctx.budget.steps ?? 60;
  const argv = ['muse', ...museArgs({ promptPath: ctx.promptPath, model, steps, ...extra })];
  const [cmd, ...args] = (ctx.wrap?.(argv) ?? argv) as [string, ...string[]];
  const child = spawn(cmd, args, {
    cwd: ctx.worktree,
    env: ctx.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

  const mapper = new MuseMapper();
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
  for (const e of mapper.flushText()) await ctx.emit(e);
  if (timer) clearTimeout(timer);
  ctx.signal.removeEventListener('abort', kill);
  const ended = endedBy({ terminal: mapper.terminal, aborted, signal: exit.signal, exitCode: exit.code });
  if (ended === 'failed' && stderr.trim()) await ctx.emit({ type: 'agent.message', payload: { text: `Muse Code stopped: ${stderr.trim().split('\n').at(-1)}`, stderr: true } });
  const u = mapper.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  return {
    endedBy: ended,
    cost: { ...u, usd: null, ...(mapper.usage ? {} : { estimated: true }) },
    model,
    host: 'local-cli',
    inFlight: ended === 'killed' ? mapper.inFlight() : null,
    lastMessage: mapper.terminal?.text ?? '',
    ...(mapper.sessionId ? { sessionId: mapper.sessionId } : {}),
  };
}

export const museCodeAdapter: Adapter = {
  id: 'muse-code',
  vendor: 'meta',
  roles: ['planner', 'implementer', 'reviewer'],
  capabilities: { editsFiles: true, runsCommands: true, resumable: true, structuredOutput: true, offline: false },
  async available(): Promise<Availability> {
    const version = await museVersion();
    if (!version) return { ok: false, reason: 'the muse CLI is not installed (https://dev.meta.ai/install.sh)' };
    return { ok: true, version };
  },
  // Stint classifies Muse Code's tool calls but cannot stop one yet: the gate is observed.
  gate: () => 'observed',
  run: (ctx) => exec(ctx),
  resume: (ctx) => exec(ctx, { sessionId: ctx.sessionId }),
  async enrich(): Promise<Enrichment> {
    // A killed session cannot be asked; R-012 calls this only for a live, resumable session.
    return {};
  },
};
