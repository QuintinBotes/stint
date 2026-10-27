import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Adapter, Availability, EndedBy, Enrichment, RunContext, RunResult } from '@stint-dev/core';
import { MuseMapper } from './mapper';

export { MuseMapper } from './mapper';
export type { MuseRecord, MuseTerminal, MuseUsage } from './mapper';

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

const ENRICH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'leftOut', 'risks', 'askOfNext'],
  properties: { summary: { type: 'string' }, leftOut: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, askOfNext: { type: 'string' } },
};
const ENRICH_PROMPT = `Your run on this task is over and another agent will continue from a short packet. Do not change files or run commands. Answer in JSON:
- summary: where the work stands, in at most two sentences.
- leftOut: what you did not finish or did not check, one short item each.
- risks: what could be wrong in what you did, one short item each.
- askOfNext: the one thing the next agent should do first.`;
const ENRICH_TIMEOUT_MS = 20_000;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 200)).slice(0, 8) : []);

/**
 * The one structured question for the leaving session (R-009): resumed by id, a few steps, the four fields the
 * packet takes from an agent. Anything malformed or late comes back as `{}`, and the daemon builds the packet
 * from events alone. shortcut: the call's tokens are not added to the run's cost; count them when enrich is metered.
 */
export async function askSession(sessionId: string, worktree: string, model: string): Promise<Enrichment> {
  const dir = mkdtempSync(join(tmpdir(), 'stint-enrich-'));
  try {
    const promptPath = join(dir, 'prompt.md');
    const outputSchema = join(dir, 'schema.json');
    writeFileSync(promptPath, ENRICH_PROMPT);
    writeFileSync(outputSchema, JSON.stringify(ENRICH_SCHEMA));
    // resolved on the current PATH, as the daemon resolves gh, so a test can put a fake first
    const bin = Bun.which('muse', { PATH: process.env.PATH ?? '' });
    if (!bin) return {};
    const p = Bun.spawn([bin, ...museArgs({ promptPath, model, steps: 3, sessionId, outputSchema })], { cwd: worktree, stdout: 'pipe', stderr: 'ignore', timeout: ENRICH_TIMEOUT_MS });
    const mapper = new MuseMapper();
    for (const line of (await new Response(p.stdout).text()).split('\n')) if (line.trim()) mapper.map(line);
    if ((await p.exited) !== 0 || mapper.terminal?.kind !== 'completed') return {};
    const a = JSON.parse(mapper.terminal.text) as Record<string, unknown>;
    const out: Enrichment = {};
    if (typeof a.summary === 'string' && a.summary.trim()) out.summary = a.summary.trim().slice(0, 400);
    if (typeof a.askOfNext === 'string' && a.askOfNext.trim()) out.askOfNext = a.askOfNext.trim().slice(0, 400);
    const leftOut = strings(a.leftOut);
    const risks = strings(a.risks);
    if (leftOut.length) out.leftOut = leftOut;
    if (risks.length) out.risks = risks;
    return out;
  } catch {
    return {};
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs one `muse exec --json` in the worktree and streams it into the daemon. */
async function exec(ctx: RunContext, extra: { sessionId?: string; promptPath?: string } = {}): Promise<RunResult> {
  const model = ctx.model ?? DEFAULT_MODEL;
  const steps = ctx.budget.steps ?? 60;
  const argv = ['muse', ...museArgs({ promptPath: extra.promptPath ?? ctx.promptPath, model, steps, ...(extra.sessionId ? { sessionId: extra.sessionId } : {}) })];
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
  // a resumed session already has the first prompt: it gets only the new instruction, in its own prompt file
  resume: async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), 'stint-resume-'));
    try {
      const promptPath = join(dir, 'instruction.md');
      writeFileSync(promptPath, ctx.instruction);
      return await exec(ctx, { sessionId: ctx.sessionId, promptPath });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  enrich: (ctx) => (ctx.sessionId ? askSession(ctx.sessionId, ctx.worktree, ctx.model ?? DEFAULT_MODEL) : Promise.resolve({})),
};
