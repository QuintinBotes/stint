import {
  type Cost,
  type EndedBy,
  type Handoff,
  HandoffSchema,
  type HostId,
  HostIdSchema,
  type Refusal,
  type Role,
  type StintEvent,
  type Vendor,
  VendorSchema,
  countTokens,
  renderHandoff,
} from '@stint-dev/core';
import { hashHandoff } from '@stint-dev/core/node';
import type { Enrichment } from './adapter';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git } from './git';

export const PACKET_TOKEN_LIMIT = 600;
const LIST = 12;
const ITEM = 200;

type Source = 'events' | 'diff' | 'plan' | 'enrich' | 'digest';
export type HandoffMeta = { fields: Record<string, { from: Source; eventIds: string[] }>; reason: string; enriched: string[]; trimmed?: TrimLevel };

type TrimLevel = { list: number; item: number; summary: number; files: number };
const TRIM_LEVELS: TrimLevel[] = [
  { list: 8, item: 160, summary: 320, files: 12 },
  { list: 5, item: 120, summary: 240, files: 8 },
  { list: 3, item: 90, summary: 180, files: 5 },
  { list: 2, item: 70, summary: 140, files: 3 },
];

/** The packet with shorter lists: the first items stay (the in-flight step leads leftOut), the biggest file changes stay. */
function trimDraft(d: Omit<Handoff, 'hash'>, level: TrimLevel): Omit<Handoff, 'hash'> {
  const cut = (xs: string[]) => xs.slice(0, level.list).map((x) => clip(x, level.item));
  const files = [...d.changedFiles].sort((a, b) => b.added + b.removed - (a.added + a.removed)).slice(0, level.files);
  const dropped =
    d.changedFiles.length - files.length +
    [d.done, d.open, d.risks, d.leftOut].reduce((n, xs) => n + Math.max(0, xs.length - level.list), 0) +
    Math.max(0, d.decisions.length - level.list) +
    Math.max(0, (d.refusals ?? []).length - level.list);
  const note = `Trimmed to fit ${PACKET_TOKEN_LIMIT} tokens: ${dropped} items and file entries are not listed; the diff and the task's log have them`;
  return {
    ...d,
    summary: clip(d.summary, level.summary),
    done: cut(d.done),
    open: cut(d.open),
    risks: cut(d.risks),
    leftOut: [...cut(d.leftOut).slice(0, Math.max(1, level.list - 1)), note],
    decisions: d.decisions.slice(0, level.list).map((x) => ({ ...x, text: clip(x.text, level.item) })),
    refusals: (d.refusals ?? []).slice(-level.list).map((r) => ({ ...r, action: clip(r.action, level.item), ...(r.reason ? { reason: clip(r.reason, level.item) } : {}) })),
    changedFiles: files,
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
};
const list = (items: string[]) => [...new Set(items.map((i) => clip(i, ITEM)).filter(Boolean))].slice(0, LIST);
// a credential an agent echoed into its own words never reaches a packet
const SECRET = /\b([A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/g;
const scrub = (s: string) => s.replace(SECRET, '$1=[redacted]');

/** A run's events, and the events of the whole task up to its end. */
export function runSlice(events: StintEvent[], run: string) {
  const started = events.find((e) => e.type === 'run.started' && e.run === run);
  if (!started) throw new DaemonError('not_found', `no run ${run}`);
  const finished = events.find((e) => e.type === 'run.finished' && e.run === run);
  // a run's tail reaches its verification and last snapshot, which come after run.finished, up to the next run
  const from = events.indexOf(started);
  const next = events.findIndex((e, i) => i > from && e.type === 'run.started');
  const upto = events.slice(0, next < 0 ? events.length : next);
  return { started, finished, own: upto.filter((e) => e.run === run), upto };
}

function vendorOf(v: unknown): Vendor {
  const r = VendorSchema.safeParse(v);
  return r.success ? r.data : 'local';
}

function hostOf(v: unknown): HostId | undefined {
  const r = HostIdSchema.safeParse(v);
  return r.success ? r.data : undefined;
}

export type BuildOptions = { to?: { adapter: string; role: Role }; enrich?: Enrichment | null; reason?: string; /** Who wrote the enrichment: the leaving agent, or a model reading the diff. */ enrichedBy?: 'agent' | 'digest' };

/**
 * Derives the packet for one run from the event log, the plan and the diff. It reads agent messages and tool-call
 * names and arguments, never tool-result bodies, so a credential printed by a tool cannot reach it.
 */
export async function deriveHandoff(ctx: DaemonContext, taskId: string, run: string, opts: BuildOptions = {}): Promise<{ handoff: Handoff; meta: HandoffMeta }> {
  const ws = ctx.ws;
  const task = await ws.readTask(taskId);
  const events = await ws.events(taskId).read();
  const { started, finished, own, upto } = runSlice(events, run);
  const plan = await ws.readPlan(taskId);
  const ids = (es: StintEvent[]) => es.map((e) => e.id);
  const meta: HandoffMeta = { fields: {}, reason: opts.reason || str(finished?.payload.endedBy) || 'handed', enriched: [] };

  const endedBy = (str(finished?.payload.endedBy) || 'handed') as EndedBy;
  const toolCalls = own.filter((e) => e.type === 'agent.tool_call');
  const messages = own.filter((e) => e.type === 'agent.message' && !e.payload.stderr);
  const changes = upto.filter((e) => e.type === 'file.changed');
  const verifications = upto.filter((e) => e.type === 'verification.ran');
  const verified = verifications.filter((e) => e.run === run).at(-1) ?? verifications.at(-1);

  // the change as git has it on the task branch
  const numstat = (await ctx.worktrees.diff(task, 'json')) as Array<{ path: string; added: number; removed: number }>;
  const lastRunFor = (path: string) => [...changes].reverse().find((e) => e.payload.path === path)?.run;
  const changedFiles = numstat.slice(0, 50).map((f) => ({ ...f, ...(lastRunFor(f.path) ? { run: lastRunFor(f.path) as string } : {}) }));
  const changed = new Set(numstat.map((f) => f.path));
  const head = (await git(ws.root, ['rev-parse', '--verify', '-q', task.branch])).stdout.trim() || task.baseCommit;

  const green = verified?.payload.status === 'green';
  const steps = plan?.steps ?? [];
  const reached = steps.filter((s) => s.files.length > 0 && s.files.every((f) => changed.has(f)) && green);
  const notReached = steps.filter((s) => !reached.includes(s));
  const done = list([
    ...reached.map((s) => s.text),
    ...(verified ? [`Verification by the daemon: ${Number(verified.payload.passed)} passed, ${Number(verified.payload.failed)} failed`] : []),
  ]);
  const inFlight = endedBy === 'killed' ? str(finished?.payload.inFlight) || (toolCalls.length && !own.some((e) => e.type === 'agent.tool_result' && e.payload.callId === toolCalls.at(-1)?.payload.callId) ? str(toolCalls.at(-1)?.payload.tool) : '') : '';
  const scenarioFailing = Array.isArray(verified?.payload.scenarioFailing) ? (verified.payload.scenarioFailing as string[]) : [];
  const tamperFiles = (verified?.payload.tamper as { files?: string[] } | null | undefined)?.files ?? [];
  const open = list([
    ...notReached.map((s) => s.text),
    ...(verified && !green && verified.payload.reason === 'tampered'
      ? [`Locked test files changed without a tests: decision: ${tamperFiles.join(', ')}. Restore them, or say on a decision: line why they had to change.`]
      : verified && !green && verified.payload.reason === 'scenarios'
        ? [`Held-out scenarios failed${scenarioFailing.length ? `: ${scenarioFailing.slice(0, 3).join('; ')}` : ''}. Their source is held out; the names are all you get.`]
        : verified && !green
          ? [`Make the failing tests pass (${Number(verified.payload.failed)} failed${Array.isArray(verified.payload.failing) && verified.payload.failing.length ? `: ${(verified.payload.failing as string[]).slice(0, 3).join('; ')}` : ''})`]
          : []),
  ]);
  const leftOut = list([
    ...(inFlight ? [`In-flight step unknown: ${inFlight}`] : []),
    ...(plan?.filesToTouch ?? []).filter((f) => !changed.has(f)).map((f) => `${f} was planned but not touched`),
  ]);

  // refusals cross every hop, attributed to the agent they happened to
  const refusals: Refusal[] = upto
    .filter((e) => e.type === 'rule.blocked' || e.type === 'run.refused')
    .map((e) => {
      const by = e.type === 'rule.blocked' ? ('stint-rules' as const) : ('runtime' as const);
      const who = events.find((x) => x.type === 'run.started' && x.run === e.run);
      const action = e.type === 'rule.blocked' ? str(e.payload.action) : `start ${e.run ?? 'a run'}`;
      return {
        action: clip(action, ITEM),
        by,
        ...(str(e.payload.reason || e.payload.message) ? { reason: clip(str(e.payload.reason || e.payload.message), ITEM) } : {}),
        ...(e.run && e.run !== run && who ? { carriedFrom: `${who.adapter ?? 'agent'} ${e.run}` } : {}),
      };
    })
    .slice(-LIST);

  const decisions = (await ws.decisions(taskId).validAt()).slice(0, LIST).map((d) => ({ id: d.id, text: clip(d.text, ITEM) }));
  const risks = list((plan?.risks ?? []).map((r) => r.text));
  const lastMessage = str(messages.at(-1)?.payload.text);
  const summary = clip(scrub(lastMessage || `${started.adapter ?? 'The agent'} ${endedBy} after ${toolCalls.length} tool calls.`), 400);
  const nextStep = open[0] ? `Next: ${open[0]}.` : green ? 'Review the change against the plan, the decisions and AGENTS.md.' : 'Run the tests and make them pass.';
  const askOfNext = clip(inFlight ? `Check the unknown step first. ${nextStep}` : nextStep, 400);
  const cost = (finished?.payload.cost as Cost | undefined) ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true };
  // the last fact the packet covers, so a rebuild of the same log has the same hash
  const createdAt = (upto.filter((e) => e.type !== 'handoff.created').at(-1) ?? started).ts;

  const v = verified?.payload;
  let draft: Omit<Handoff, 'hash'> = {
    version: 'stint.handoff/1',
    task: taskId,
    from: {
      adapter: started.adapter ?? 'agent',
      vendor: vendorOf(started.vendor),
      model: str(finished?.payload.model) || str(started.payload.model) || 'unknown',
      role: (str(started.payload.role) || 'implementer') as Role,
      run,
      endedBy,
      ...(str(finished?.payload.sessionId) ? { sessionId: str(finished?.payload.sessionId) } : {}),
      ...(hostOf(finished?.payload.host ?? started.payload.host) ? { host: hostOf(finished?.payload.host ?? started.payload.host) as HostId } : {}),
    },
    ...(opts.to ? { to: opts.to } : {}),
    summary,
    done,
    open,
    leftOut,
    refusals,
    decisions,
    risks,
    changedFiles,
    diffRef: { base: task.baseCommit, head },
    verification: v
      ? { command: str(v.command), exitCode: Number(v.exitCode), passed: Number(v.passed), failed: Number(v.failed), durationMs: Number(v.durationMs), runBy: 'daemon', status: v.status === 'green' ? 'green' : 'red' }
      : null,
    askOfNext,
    cost,
    createdAt,
  };
  meta.fields = {
    summary: { from: 'events', eventIds: ids(messages.slice(-1)) },
    done: { from: plan ? 'plan' : 'events', eventIds: ids(verified ? [verified] : []) },
    open: { from: plan ? 'plan' : 'events', eventIds: ids(verified ? [verified] : []) },
    leftOut: { from: 'events', eventIds: ids(finished ? [finished] : []) },
    refusals: { from: 'events', eventIds: ids(upto.filter((e) => e.type === 'rule.blocked' || e.type === 'run.refused')) },
    decisions: { from: 'events', eventIds: ids(upto.filter((e) => e.type === 'decision.recorded')) },
    risks: { from: 'plan', eventIds: [] },
    changedFiles: { from: 'diff', eventIds: ids(changes.slice(-LIST)) },
    verification: { from: 'events', eventIds: ids(verified ? [verified] : []) },
    askOfNext: { from: 'events', eventIds: ids(finished ? [finished] : []) },
    cost: { from: 'events', eventIds: ids(finished ? [finished] : []) },
  };

  // the leaving agent may improve four fields; the daemon keeps its own value for any that do not validate
  if (opts.enrich) {
    const e = opts.enrich;
    const tryField = (field: 'summary' | 'leftOut' | 'risks' | 'askOfNext', next: Omit<Handoff, 'hash'>) => {
      if (HandoffSchema.safeParse({ ...next, hash: `sha256:${'0'.repeat(64)}` }).success) {
        draft = next;
        meta.fields[field] = { from: opts.enrichedBy === 'digest' ? 'digest' : 'enrich', eventIds: [] };
        meta.enriched.push(field);
      }
    };
    if (e.summary) tryField('summary', { ...draft, summary: scrub(e.summary) });
    if (e.leftOut?.length) tryField('leftOut', { ...draft, leftOut: [...new Set([...draft.leftOut, ...e.leftOut.map(scrub)])] });
    if (e.risks?.length) tryField('risks', { ...draft, risks: [...new Set([...draft.risks, ...e.risks.map(scrub)])] });
    if (e.askOfNext) tryField('askOfNext', { ...draft, askOfNext: inFlight && !e.askOfNext.startsWith('Check the unknown step first.') ? `Check the unknown step first. ${scrub(e.askOfNext)}` : scrub(e.askOfNext) });
  }

  // a packet always fits: trim in steps (fewer items, shorter items, fewer files) and say so, before refusing
  let handoff = HandoffSchema.parse({ ...draft, hash: hashHandoff(draft) });
  let tokens = countTokens(renderHandoff(handoff));
  for (const level of TRIM_LEVELS) {
    if (tokens <= PACKET_TOKEN_LIMIT) break;
    const trimmed = trimDraft(draft, level);
    handoff = HandoffSchema.parse({ ...trimmed, hash: hashHandoff(trimmed) });
    tokens = countTokens(renderHandoff(handoff));
    meta.trimmed = level;
  }
  if (tokens > PACKET_TOKEN_LIMIT) {
    const fields = Object.entries(draft)
      .filter(([, val]) => Array.isArray(val) || typeof val === 'string')
      .map(([k, val]) => ({ field: k, tokens: countTokens(JSON.stringify(val)) }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 4);
    throw new DaemonError('packet_too_large', `the packet renders to ${tokens} tokens; the limit is ${PACKET_TOKEN_LIMIT}`, { tokens, limit: PACKET_TOKEN_LIMIT, fields });
  }
  return { handoff, meta };
}

/** Earlier hops as the multi-hop rule carries them: only who held the task and how it ended. */
export async function earlierHops(ctx: DaemonContext, taskId: string, beforeRun: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await ctx.ws.handoffs(taskId).names()) {
    const h = await ctx.ws.handoffs(taskId).read(name);
    if (!h || h.from.run === beforeRun || Number(h.from.run.slice(1)) >= Number(beforeRun.slice(1))) continue;
    out.push(`Before that it was with ${h.from.adapter} ${h.from.run}, which ended ${h.from.endedBy}.`);
  }
  return out.slice(-3);
}

/** Builds, stores and announces the packet for a run (every ending builds one). */
export async function buildHandoff(ctx: DaemonContext, taskId: string, run: string, opts: BuildOptions = {}): Promise<{ name: string; handoff: Handoff; meta: HandoffMeta; tokens: number; bytes: number }> {
  const { handoff, meta } = await deriveHandoff(ctx, taskId, run, opts);
  const name = await ctx.ws.handoffs(taskId).write(handoff, meta);
  const text = renderHandoff(handoff);
  const tokens = countTokens(text);
  const bytes = new TextEncoder().encode(text).length;
  await ctx.ws.events(taskId).append({
    task: taskId,
    run,
    vendor: 'daemon',
    type: 'handoff.created',
    payload: { name, hash: handoff.hash, from: handoff.from, to: handoff.to ?? null, tokens, bytes, reason: meta.reason, enriched: meta.enriched, packet: handoff },
    links: [{ kind: 'handoff', ref: name }],
  });
  return { name, handoff, meta, tokens, bytes };
}
