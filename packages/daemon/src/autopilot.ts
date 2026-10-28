import { type Host, hostsFromConfig } from '@stint-dev/adapter-openai-compatible';
import type { Config, StintEvent, Task } from '@stint-dev/core';
import { runsFromEvents } from '@stint-dev/core/node';
import { z } from 'zod';
import { lockAcceptance } from './acceptance';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { git, gitOk } from './git';
import { assign } from './lifecycle';
import { walkChain } from './route';
import { chooseLearned, recordsFor, workspaceRecords } from './routing';
import { planTask, reviewTask } from './routes/models';
import { verifyBranch } from './routes/work';

export type AutopilotSettings = NonNullable<Config['autopilot']>;
export const AUTOPILOT_DEFAULTS: AutopilotSettings = { implementers: ['muse-code', 'stint-agent'], maxHops: 3, parallel: 2 };

export type Step =
  | { kind: 'idle' }
  | { kind: 'wait'; reason: string }
  | { kind: 'plan' }
  | { kind: 'specify'; ask: string }
  | { kind: 'lock'; run: string; failing: string[] }
  | { kind: 'build'; adapter?: string; ask?: string; reason: string }
  | { kind: 'hand'; after: string; handoffFrom: string | null; reason: string }
  | { kind: 'escalate'; after: string; handoffFrom: string | null; failures: number; reason: string }
  | { kind: 'bestof'; n: number }
  | { kind: 'bestof-wait'; candidates: string[] }
  | { kind: 'adopt'; candidate: string }
  | { kind: 'children'; children: string[] }
  | { kind: 'review'; verified: string }
  | { kind: 'stop'; reason: string; needsYou: boolean };

/** The events since autopilot was last switched on, or null when it is off. */
export function autopilotTail(events: StintEvent[]): StintEvent[] | null {
  let start = -1;
  for (let i = 0; i < events.length; i++) {
    const t = (events[i] as StintEvent).type;
    if (t === 'autopilot.started') start = i;
    if (t === 'autopilot.stopped') start = -1;
  }
  return start < 0 ? null : events.slice(start);
}

/** What a board card shows: on or off, and the latest step or the reason it stopped. */
export function autopilotCard(events: StintEvent[]): { on: boolean; step: string | null; reason: string | null; queued: boolean } | null {
  const last = events.filter((e) => e.type.startsWith('autopilot.')).at(-1);
  if (!last) return null;
  if (last.type === 'autopilot.stopped') return { on: false, step: 'stopped', reason: String(last.payload.reason ?? ''), queued: false };
  return { on: true, step: last.type === 'autopilot.step' ? String(last.payload.step) : 'starting', reason: last.type === 'autopilot.step' ? String(last.payload.reason ?? '') : null, queued: !!last.payload.queued };
}

const SPECIFY_ASK = `Write tests for this task's acceptance criteria only. Put them where the repository keeps its tests and follow its test conventions. Do not change any file outside the tests: the tests must fail now, because the behaviour does not exist yet, and they must fail on an assertion, not on a missing import or a syntax error. Stint locks these tests; the build that follows must make them pass without changing them.`;

/** The specify leg: ask for the tests, then judge them by the daemon's own run of them. */
function specifyStep(tail: StintEvent[]): Step {
  const asked = tail.findIndex((e) => e.type === 'autopilot.step' && e.payload.step === 'specify');
  if (asked < 0) return { kind: 'specify', ask: SPECIFY_ASK };
  const run = runsFromEvents(tail.slice(asked)).find((r) => r.role === 'implementer');
  if (!run) return { kind: 'wait', reason: 'the tests are being written' };
  if (!run.endedBy) return { kind: 'wait', reason: `${run.run} is writing the tests` };
  const v = tail.filter((e) => e.type === 'verification.ran' && e.run === run.run).at(-1)?.payload;
  if (v?.status === 'green') return { kind: 'stop', reason: 'Needs you: the acceptance tests pass before any change, so the task may be done already, or the tests do not test it.', needsYou: true };
  const failing = (v?.failing as string[] | undefined) ?? [];
  if (!v || v.loadError || failing.length === 0) {
    return { kind: 'stop', reason: `Needs you: the new tests do not run${v?.loadError ? `: ${String(v.loadError)}` : ', so they cannot fail for the right reason'}.`, needsYou: true };
  }
  return { kind: 'lock', run: run.run, failing };
}

/**
 * The pick among green candidates: one green candidate wins outright; several are judged by the reviewer chain
 * on their diffs, and if no reviewer can answer, the smaller change wins.
 */
export async function pickCandidate(ctx: DaemonContext, parent: string, green: Array<{ id: string; branch: string }>): Promise<{ pick: string; reason: string }> {
  if (green.length === 1) return { pick: (green[0] as { id: string }).id, reason: 'the only candidate whose tests were green' };
  const task = await ctx.ws.readTask(parent);
  const diffs: Array<{ id: string; diff: string; lines: number }> = [];
  for (const g of green) {
    const diff = (await git(ctx.ws.root, ['diff', `${task.baseCommit}..${g.branch}`])).stdout;
    diffs.push({ id: g.id, diff: diff.slice(0, 6000), lines: diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length });
  }
  const smallest = [...diffs].sort((a, b) => a.lines - b.lines)[0] as (typeof diffs)[number];
  try {
    const prompt = `Several agents built the same task and all of their tests pass. Pick the one a careful reviewer would merge: correct, simplest, consistent with the codebase. Answer with its id and one sentence why.\n\nTask: ${task.title}. ${task.goal}\n\n${diffs.map((d) => `### ${d.id}\n${d.diff}`).join('\n\n')}`;
    const r = await walkChain<{ value: { pick: string; reason: string } }>({
      role: 'reviewer',
      chain: ctx.ws.config.routes.reviewer,
      hosts: hostsFromConfig(ctx.ws.config) as Record<string, Host>,
      call: (h, model, c) => h.complete(PickSchema, prompt, { model, timeoutMs: c.timeoutMs, emit: c.emit }),
    });
    const v = ((r.value as { value?: { pick: string; reason: string } }).value ?? r.value) as { pick: string; reason: string };
    if (diffs.some((d) => d.id === v.pick)) return { pick: v.pick, reason: `${v.reason} (${r.host}/${r.model})` };
  } catch {
    // no reviewer could answer: the smaller change is the safer pick
  }
  return { pick: smallest.id, reason: `no reviewer could pick, so the smaller change (${smallest.lines} changed lines) was taken` };
}

/**
 * The parent takes over the picked candidate's work: its branch already points at the candidate's, so the
 * daemon records an implementer run in the parent's log that names the candidate and verifies the branch again.
 */
export async function adoptCandidate(ctx: DaemonContext, parent: string, candidate: string): Promise<void> {
  const ws = ctx.ws;
  const from = runsFromEvents(await ws.events(candidate).read()).filter((r) => r.role === 'implementer').at(-1);
  if (!from) throw new DaemonError('not_found', `${candidate} has no implementer run to adopt`);
  const fromDirs = Number((await ws.runs(parent).nextRunId()).slice(1));
  const fromLog = runsFromEvents(await ws.events(parent).read()).reduce((m, r) => Math.max(m, Number(r.run.slice(1)) + 1), 1);
  const run = `r${Math.max(fromDirs, fromLog)}`;
  const adapter = from.adapter ?? 'stint-agent';
  const vendor = (ctx.adapters.find((a) => a.id === adapter)?.vendor ?? 'other') as 'meta';
  const at = new Date().toISOString();
  const zero = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0, estimated: false };
  await ws.runs(parent).create({ run, adapter, vendor, role: 'implementer', ...(from.model ? { model: from.model } : {}), host: from.host ?? 'local-cli', startedAt: at });
  const base = { task: parent, run, adapter, vendor } as const;
  await ws.events(parent).append({ ...base, type: 'run.started', payload: { role: 'implementer', model: from.model ?? null, host: from.host ?? 'local-cli', adoptedFrom: `${candidate} ${from.run}` } });
  // the candidate's own runs carry its cost; this run only moves its work onto the parent
  await ws.runs(parent).updateMeta(run, { endedAt: at, endedBy: 'completed', cost: zero });
  await ws.events(parent).append({ ...base, type: 'run.finished', payload: { endedBy: 'completed', cost: zero, adoptedFrom: `${candidate} ${from.run}` } });
  await verifyBranch(ctx, await ws.readTask(parent), run);
}

const PickSchema = z.strictObject({ pick: z.string().regex(/^T-\d+$/), reason: z.string().min(1).max(300) });

/** A task holds a slot once it has taken a step that is not waiting in the queue. */
export function holdsSlot(tail: StintEvent[]): boolean {
  if (tail.some((e) => e.type === 'bestofn.started') && !tail.some((e) => e.type === 'bestofn.picked')) return false;
  // a split task holds no slot of its own: its subtasks do the work
  if (tail.some((e) => e.type === 'autopilot.step' && e.payload.split)) return false;
  return tail.some((e) => e.type === 'autopilot.step' && !e.payload.queued);
}

type Verified = { passed: number; failed: number; failing: string[] };

/**
 * Two implementer runs in a row that ended badly with nothing gained between them: no fewer failures, no more
 * passes. Handing on again would spend another run on the same wall, so the person is asked instead. A kill is
 * not a failure of the agent and never counts.
 */
export function noProgress(tail: StintEvent[], impl: Array<{ run: string; endedBy: string | null }>): string | null {
  const [prev, last] = impl.slice(-2);
  if (!prev || !last || prev.endedBy === 'killed' || last.endedBy === 'killed') return null;
  const v = (run: string): Verified | null => {
    const e = tail.filter((x) => x.type === 'verification.ran' && x.run === run).at(-1);
    return e ? { passed: Number(e.payload.passed ?? 0), failed: Number(e.payload.failed ?? 0), failing: (e.payload.failing as string[] | undefined) ?? [] } : null;
  };
  const a = v(prev.run);
  const b = v(last.run);
  if (!a || !b || b.failed < a.failed || b.passed > a.passed) return null;
  const same = b.failing.filter((n) => a.failing.includes(n));
  return same.length
    ? `The same ${same.length === 1 ? 'test fails' : `${same.length} tests fail`}: ${same.slice(0, 3).join('; ')}${same.length > 3 ? '; and more' : ''}.`
    : `${b.failed} failing before and after, ${b.passed} passing.`;
}

const why = (endedBy: string | null, verdict: string | undefined) =>
  endedBy && endedBy !== 'completed' ? `ended ${endedBy}` : `finished with a ${verdict ?? 'missing'} verification`;

/**
 * The next thing autopilot does, as a pure function of the task's log: a daemon restart resumes from the
 * same place. It never approves; the furthest it goes on its own is the approval gate.
 */
export function nextStep(events: StintEvent[], task: Task, s: AutopilotSettings, live: boolean): Step {
  const tail = autopilotTail(events);
  if (!tail) return { kind: 'idle' };
  if (live) return { kind: 'wait', reason: 'a run is live' };
  if (task.status === 'done') return { kind: 'stop', reason: 'The task is merged.', needsYou: false };
  // a best-of-n candidate builds from its parent's plan, and stops once its tests are green for the pick
  const candidate = !!task.parent && (task.tags ?? []).includes('candidate');
  const planned = candidate || events.some((e) => e.type === 'run.started' && e.payload.role === 'planner') || tail.some((e) => e.type === 'autopilot.step' && e.payload.step === 'plan');
  if (!planned) return { kind: 'plan' };
  // a task its plan split waits on its subtasks (R-036)
  const split = events.find((e) => e.type === 'task.decomposed');
  if (split) return { kind: 'children', children: (split.payload.children as string[]) ?? [] };

  // an unexplained change to locked tests stops autopilot whichever lock it broke (R-029)
  const tampered = tail.find((e) => (e.type === 'verification.tampered' || e.type === 'acceptance.tampered') && !e.payload.allowedBy);
  if (tampered) {
    const by = runsFromEvents(tail).find((r) => r.run === tampered.run);
    return { kind: 'stop', reason: `Needs you: ${by?.adapter ?? 'an agent'} ${tampered.run} changed the acceptance tests (${(tampered.payload.files as string[]).join(', ')}).`, needsYou: true };
  }

  // tests first (R-027): failing acceptance tests are written and locked before anything is built
  let fromLock = tail;
  if (s.testsFirst) {
    // the plan-time lock is not the tests-first lock: only its own scope ends the specify leg (R-029)
    const lockAt = tail.findIndex((e) => e.type === 'acceptance.locked' && e.payload.scope !== 'plan');
    if (lockAt < 0) return specifyStep(tail);
    fromLock = tail.slice(lockAt);
  }

  const impl = runsFromEvents(fromLock).filter((r) => r.role === 'implementer');
  const last = impl.at(-1);
  if (!last) {
    // best of n (R-035): candidates build in parallel; the parent adopts the one the pick chose
    if ((s.bestOf ?? 1) > 1 && !candidate) {
      const started = tail.find((e) => e.type === 'bestofn.started');
      const picked = tail.find((e) => e.type === 'bestofn.picked');
      if (!started) return { kind: 'bestof', n: s.bestOf as number };
      if (!picked) return { kind: 'bestof-wait', candidates: (started.payload.candidates as string[]) ?? [] };
      return { kind: 'adopt', candidate: String(picked.payload.pick) };
    }
    const preferred = candidate ? (tail[0]?.payload.implementer as string | undefined) : undefined;
    return { kind: 'build', ...(preferred ? { adapter: preferred } : {}), reason: s.testsFirst ? 'The acceptance tests are locked and fail.' : 'Nothing is built yet.' };
  }
  if (!last.endedBy) return { kind: 'wait', reason: `${last.run} has not finished` };

  const verification = tail.filter((e) => e.type === 'verification.ran' && e.run === last.run).at(-1);
  const status = verification?.payload.status as string | undefined;
  if (last.endedBy !== 'completed' || status !== 'green') {
    const hops = tail.filter((e) => e.type === 'autopilot.step' && e.payload.step === 'hand').length;
    const reason = `${last.adapter} ${last.run} ${why(last.endedBy, status)}`;
    if (hops >= s.maxHops) return { kind: 'stop', reason: `Needs you: ${reason}, after ${hops} handoffs.`, needsYou: true };
    const packetOf = (run: string) => (tail.filter((e) => e.type === 'handoff.created' && e.run === run).at(-1)?.payload.name as string | undefined) ?? null;
    // the smart friend: after repeated failures the next hop goes to a stronger agent or model, once
    const failures = impl.filter((r) => r.endedBy !== 'killed' && (r.endedBy !== 'completed' || tail.filter((e) => e.type === 'verification.ran' && e.run === r.run).at(-1)?.payload.status !== 'green')).length;
    if (s.escalate?.length && failures >= (s.escalateAfter ?? 2) && !tail.some((e) => e.type === 'escalation.triggered')) {
      return { kind: 'escalate', after: last.adapter ?? '', handoffFrom: packetOf(last.run), failures, reason };
    }
    const stuck = noProgress(tail, impl);
    if (stuck) return { kind: 'stop', reason: `Needs you: two agents in a row got no further. ${stuck}`, needsYou: true };
    const packet = tail.filter((e) => e.type === 'handoff.created' && e.run === last.run).at(-1);
    return { kind: 'hand', after: last.adapter ?? '', handoffFrom: (packet?.payload.name as string | undefined) ?? null, reason };
  }

  if (candidate) return { kind: 'stop', reason: 'Candidate ready: its tests are green, waiting for the pick.', needsYou: false };

  // the reviews of this build: those recorded after its verification
  const after = tail.slice(tail.indexOf(verification as StintEvent));
  const review = after.filter((e) => e.type === 'review.recorded').at(-1);
  if (!review) {
    const failed = after.some((e) => e.type === 'run.finished' && e.payload.endedBy === 'failed' && tail.some((s2) => s2.type === 'run.started' && s2.run === e.run && s2.payload.role === 'reviewer'));
    if (failed) return { kind: 'stop', reason: 'Waiting for your approval. No reviewer could answer, so read the diff yourself.', needsYou: false };
    const v = verification?.payload as { command?: string; passed?: number; failed?: number };
    return { kind: 'review', verified: `${v.command ?? 'tests'} ${v.passed ?? 0}/${(v.passed ?? 0) + (v.failed ?? 0)} green` };
  }
  const r = review.payload.review as { verdict: string; findings?: Array<{ text: string }>; blockers?: string[] } | undefined;
  const verdict = (review.payload.verdict as string | undefined) ?? r?.verdict;
  if (verdict === 'approve') return { kind: 'stop', reason: 'Waiting for your approval.', needsYou: false };
  if (verdict === 'block') return { kind: 'stop', reason: `Needs you: the review blocked it: ${(r?.blockers ?? []).join('; ') || 'see the review'}`, needsYou: true };
  const rounds = tail.filter((e) => e.type === 'autopilot.step' && e.payload.step === 'build' && e.payload.changes).length;
  if (rounds >= 1) return { kind: 'stop', reason: 'Needs you: the review still asks for changes after one round.', needsYou: true };
  const ask = (r?.findings ?? []).map((f) => f.text).join('\n').slice(0, 2000) || 'Address the review.';
  return { kind: 'build', adapter: last.adapter ?? undefined, ask, reason: 'The review asked for changes.' };
}

/** Drives tasks on autopilot: one serialized tick per task, at most `parallel` tasks holding a slot. */
export class Autopilot {
  private readonly ticks = new Map<string, Promise<void>>();
  /** Tasks that took a slot and may not have written their first step yet; claiming is one step at a time. */
  private readonly claimed = new Set<string>();
  private claiming: Promise<unknown> = Promise.resolve();

  /**
   * Takes a slot for a task, or says who holds them all. Two tasks started together must not both see a free
   * slot before either has written a step, so the check and the claim run one task at a time.
   */
  private claimSlot(id: string): Promise<string[] | null> {
    const turn = this.claiming.then(async () => {
      const holders: string[] = [];
      for (const t of await this.ctx.ws.listTasks()) {
        if (t.id === id) continue;
        const other = autopilotTail(await this.ctx.ws.events(t.id).read());
        if (!other) {
          this.claimed.delete(t.id);
          continue;
        }
        // a split task or one waiting on its candidates gave its slot to them
        const released = other.some((e) => e.type === 'autopilot.step' && e.payload.split) || (other.some((e) => e.type === 'bestofn.started') && !other.some((e) => e.type === 'bestofn.picked'));
        if (released) this.claimed.delete(t.id);
        else if (holdsSlot(other) || this.claimed.has(t.id)) holders.push(t.id);
      }
      if (holders.length >= this.settings.parallel) return holders;
      this.claimed.add(id);
      return null;
    });
    this.claiming = turn.catch(() => undefined);
    return turn;
  }
  /** The randomness learned routing draws on; tests seed it. */
  rng: () => number = Math.random;

  constructor(private readonly ctx: DaemonContext) {}

  private get settings(): AutopilotSettings {
    return this.ctx.ws.config.autopilot ?? AUTOPILOT_DEFAULTS;
  }

  async start(id: string, opts: { implementer?: string } = {}): Promise<void> {
    const events = await this.ctx.ws.events(id).read();
    if (!autopilotTail(events)) await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.started', payload: { settings: this.settings, ...(opts.implementer ? { implementer: opts.implementer } : {}) } });
    this.kick(id);
  }

  async stop(id: string, reason: string, needsYou = false): Promise<void> {
    this.claimed.delete(id);
    if (!autopilotTail(await this.ctx.ws.events(id).read())) return;
    await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.stopped', payload: { reason, needsYou } });
    // a slot may have opened
    for (const t of await this.ctx.ws.listTasks()) if (t.id !== id) this.kick(t.id);
  }

  /** A task merged: whatever waited on it (its dependents, its parent) may move now. */
  async onDone(id: string): Promise<void> {
    const parent = (await this.ctx.ws.readTask(id)).parent;
    for (const t of await this.ctx.ws.listTasks()) if (t.id === parent || t.dependsOn?.includes(id)) this.kick(t.id);
  }

  /** Queues a tick for a task; the daemon's stop waits for it. */
  kick(id: string): void {
    const p = (this.ticks.get(id) ?? Promise.resolve())
      .then(() => this.tick(id))
      .catch((err: unknown) => {
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: `autopilot ${id}: ${err instanceof Error ? err.message : String(err)}` })}\n`);
      });
    this.ticks.set(id, p);
    this.ctx.pending.add(p);
    void p.finally(() => this.ctx.pending.delete(p));
  }

  /** Resumes every task the log says is on autopilot, after a daemon restart. */
  async resume(): Promise<void> {
    for (const t of await this.ctx.ws.listTasks()) if (autopilotTail(await this.ctx.ws.events(t.id).read())) this.kick(t.id);
  }

  /** The one word for where autopilot is on a task, from its own next step (R-054). */
  async stepFor(id: string): Promise<'plan' | 'build' | 'verify' | 'review' | 'approve' | 'idle'> {
    const task = await this.ctx.ws.readTask(id);
    const events = await this.ctx.ws.events(id).read();
    const s = nextStep(events, task, this.settings, !!this.ctx.runs.get(id));
    switch (s.kind) {
      case 'plan':
        return 'plan';
      case 'lock':
        return 'verify';
      case 'review':
        return 'review';
      case 'specify':
      case 'build':
      case 'hand':
      case 'escalate':
      case 'bestof':
      case 'bestof-wait':
      case 'adopt':
      case 'children':
        return 'build';
      case 'stop':
        return task.status === 'awaiting_approval' || s.reason.startsWith('Waiting for your approval') ? 'approve' : 'idle';
      case 'wait': {
        if (task.status === 'awaiting_approval') return 'approve';
        if (task.status === 'verifying') return 'verify';
        if (task.status === 'reviewing' || task.status === 'in_review') return 'review';
        if (task.status === 'building') return 'build';
        if (task.status === 'planned') return 'plan';
        const last = events.filter((e) => e.type === 'autopilot.step').at(-1)?.payload.step;
        if (last === 'plan') return 'plan';
        if (last === 'verify') return 'verify';
        if (last === 'review') return 'review';
        if (last === 'build' || last === 'specify' || last === 'hand') return 'build';
        return 'idle';
      }
      case 'idle':
        return task.status === 'awaiting_approval' ? 'approve' : 'idle';
    }
  }

  async status(): Promise<{ running: string[]; queued: string[] }> {
    const running: string[] = [];
    const queued: string[] = [];
    for (const t of await this.ctx.ws.listTasks()) {
      const tail = autopilotTail(await this.ctx.ws.events(t.id).read());
      // queued means it took a queued step; a task that has not taken its first step yet is starting, not queued
      if (tail) (tail.at(-1)?.type === 'autopilot.step' && tail.at(-1)?.payload.queued ? queued : running).push(t.id);
    }
    return { running, queued };
  }

  private async step(id: string, step: string, reason: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.step', payload: { step, reason, ...extra } });
  }

  /**
   * The next implementer: in `chains` mode the next available one in the list after `after`; in `learned`
   * mode (R-045) the one the scoreboard favours for this task, never the one that just failed.
   */
  private async firstAvailable(after?: string, task?: string): Promise<string | null> {
    const chain = this.settings.implementers.filter((a) => this.ctx.adapters.some((x) => x.id === a));
    if (chain.length === 0) return null;
    const from = after ? chain.indexOf(after) + 1 : 0;
    const ordered: string[] = [];
    for (let i = 0; i < chain.length; i++) {
      const id = chain[(from + i) % chain.length] as string;
      const adapter = this.ctx.adapters.find((x) => x.id === id);
      if (adapter && (await adapter.available()).ok) ordered.push(id);
    }
    const routing = this.ctx.ws.config.routing;
    if (routing?.mode !== 'learned' || !task || ordered.length === 0) return ordered[0] ?? null;
    const candidates = ordered.length > 1 && after ? ordered.filter((a) => a !== after) : ordered;
    const t = await this.ctx.ws.readTask(task);
    const { rows, priors } = await workspaceRecords(this.ctx.ws);
    const pick = chooseLearned(candidates, recordsFor(t, rows, priors), routing.explore, this.rng);
    await this.ctx.ws.events(task).append({ task, vendor: 'daemon', type: 'routing.chosen', payload: { agent: pick.agent, tags: t.tags ?? [], score: Math.round(pick.score * 1000) / 1000, explored: pick.explored, records: pick.records } });
    return pick.agent;
  }

  private async tick(id: string): Promise<void> {
    const ws = this.ctx.ws;
    for (let guard = 0; guard < 8; guard++) {
      const events = await ws.events(id).read();
      const tail = autopilotTail(events);
      const s = nextStep(events, await ws.readTask(id), this.settings, !!this.ctx.runs.get(id));
      if (s.kind === 'idle' || s.kind === 'wait' || !tail) return;
      if (s.kind === 'stop') return this.stop(id, s.reason, s.needsYou);

      // a subtask starts only once the tasks it depends on are merged (R-036)
      const blocked: string[] = [];
      for (const d of (await ws.readTask(id)).dependsOn ?? []) if ((await ws.readTask(d).catch(() => null))?.status !== 'done') blocked.push(d);
      if (blocked.length && s.kind !== 'children') {
        const last = tail.at(-1) as StintEvent;
        if (!(last.type === 'autopilot.step' && last.payload.queued && String(last.payload.blocked) === String(blocked))) await this.step(id, 'wait', `Waiting for ${blocked.join(', ')} to be merged first.`, { queued: true, blocked });
        return;
      }

      // a parent waiting on its candidates or subtasks takes no slot: they hold them
      if (s.kind !== 'bestof-wait' && s.kind !== 'children' && !holdsSlot(tail) && !this.claimed.has(id)) {
        const holders = await this.claimSlot(id);
        if (holders) {
          const last = tail.at(-1) as StintEvent;
          if (!(last.type === 'autopilot.step' && last.payload.queued)) await this.step(id, 'wait', `Queued behind ${holders.join(', ')}`, { queued: true });
          return;
        }
      }

      try {
        if (s.kind === 'plan') {
          await this.step(id, 'plan', 'No plan yet; asking the planner chain.');
          await planTask(this.ctx, id).catch((err: unknown) => this.step(id, 'plan', `No planner could answer (${err instanceof Error ? err.message : String(err)}); building without a plan.`));
          continue;
        }
        if (s.kind === 'specify') {
          const adapter = await this.firstAvailable();
          if (!adapter) return this.stop(id, `Needs you: no implementer in ${this.settings.implementers.join(', ')} is available.`, true);
          await this.step(id, 'specify', `Tests first: ${adapter} writes failing tests for the acceptance criteria.`, { adapter });
          await assign(this.ctx, id, { adapter, role: 'implementer', instruction: s.ask });
          return;
        }
        if (s.kind === 'lock') {
          const files = await lockAcceptance(this.ctx, id, s.run);
          await this.step(id, 'verify', `${files.length} test file${files.length === 1 ? '' : 's'} locked; ${s.failing.length} failing as they should: ${s.failing.slice(0, 2).join('; ')}.`);
          continue;
        }
        if (s.kind === 'review') {
          await this.step(id, 'verify', s.verified);
          await this.step(id, 'review', 'Asking the reviewer chain.');
          await reviewTask(this.ctx, id).catch(async (err: unknown) => {
            await ws.writeTask(id, { status: 'awaiting_approval' });
            await this.stop(id, `Waiting for your approval. No reviewer could answer (${err instanceof Error ? err.message : String(err)}).`);
          });
          continue;
        }
        if (s.kind === 'build') {
          const adapter = s.adapter ?? (await this.firstAvailable(undefined, id));
          if (!adapter) return this.stop(id, `Needs you: no implementer in ${this.settings.implementers.join(', ')} is available.`, true);
          await this.step(id, 'build', `${s.reason} ${adapter} builds it.`, { adapter, ...(s.ask ? { changes: true } : {}) });
          await assign(this.ctx, id, { adapter, role: 'implementer', ...(s.ask ? { instruction: s.ask } : {}) });
          return;
        }
        if (s.kind === 'escalate') {
          for (const entry of this.settings.escalate ?? []) {
            const [agent, model] = entry.split('@') as [string, string | undefined];
            const adapter = this.ctx.adapters.find((a) => a.id === agent);
            if (!adapter || !(await adapter.available()).ok) continue;
            await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'escalation.triggered', payload: { from: s.after, to: entry, failures: s.failures, handoffFrom: s.handoffFrom } });
            await this.step(id, 'hand', `${s.reason}; ${s.failures} failures, so escalating to ${entry}.`, { from: s.after, to: agent, escalate: true, handoffFrom: s.handoffFrom });
            await assign(this.ctx, id, { adapter: agent, role: 'implementer', ...(model ? { model } : {}), ...(s.handoffFrom ? { handoffFrom: s.handoffFrom } : {}) });
            return;
          }
          // nothing to escalate to is available: carry on as a plain hand-off
          const next = await this.firstAvailable(s.after);
          if (!next) return this.stop(id, `Needs you: ${s.reason}, and no agent to escalate or hand to is available.`, true);
          await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'escalation.triggered', payload: { from: s.after, to: next, failures: s.failures, handoffFrom: s.handoffFrom, unavailable: this.settings.escalate } });
          await this.step(id, 'hand', `${s.reason}; no escalation target is available, handing to ${next}.`, { from: s.after, to: next, handoffFrom: s.handoffFrom });
          await assign(this.ctx, id, { adapter: next, role: 'implementer', ...(s.handoffFrom ? { handoffFrom: s.handoffFrom } : {}) });
          return;
        }
        if (s.kind === 'bestof') {
          const task = await ws.readTask(id);
          const plan = await ws.readPlan(id);
          const chain = this.settings.implementers.filter((a) => this.ctx.adapters.some((x) => x.id === a));
          const candidates: string[] = [];
          for (let k = 1; k <= s.n; k++) {
            const c = await ws.createTask({ title: `${task.title} (candidate ${k} of ${s.n})`.slice(0, 120), goal: task.goal, acceptance: task.acceptance, testCommand: task.testCommand, tags: [...(task.tags ?? []).filter((t) => t !== 'candidate'), 'candidate'] });
            await ws.writeTask(c.id, { parent: id, baseCommit: task.baseCommit });
            if (plan) await ws.writePlan(c.id, plan);
            candidates.push(c.id);
          }
          await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'bestofn.started', payload: { n: s.n, candidates } });
          await this.step(id, 'build', `Best of ${s.n}: ${candidates.join(', ')} build in parallel; the best green one is adopted.`, { candidates });
          // each candidate takes the next implementer in the chain, so the attempts differ
          for (const [k, c] of candidates.entries()) await this.start(c, { implementer: chain.length ? chain[k % chain.length] : undefined });
          return;
        }
        if (s.kind === 'bestof-wait') {
          const states = [];
          for (const c of s.candidates) {
            const evs = await ws.events(c).read();
            const v = await ws.verification(c).latest();
            // done once its autopilot has stopped: a candidate not started yet also has no tail, and is not done
            states.push({ id: c, done: evs.some((e) => e.type === 'autopilot.stopped') && !autopilotTail(evs), green: v?.status === 'green', branch: (await ws.readTask(c)).branch });
          }
          if (states.some((x) => !x.done)) return;
          const green = states.filter((x) => x.green);
          if (green.length === 0) return this.stop(id, `Needs you: no candidate of ${s.candidates.join(', ')} went green.`, true);
          const { pick, reason } = await pickCandidate(this.ctx, id, green);
          for (const x of states) await ws.writeTask(x.id, { status: 'abandoned' });
          const picked = states.find((x) => x.id === pick) as (typeof states)[number];
          const parent = await ws.readTask(id);
          await gitOk(ws.root, ['branch', '-f', parent.branch, picked.branch]);
          await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'bestofn.picked', payload: { pick, reason, candidates: states.map((x) => ({ id: x.id, green: x.green })) } });
          continue;
        }
        if (s.kind === 'children') {
          const kids = await Promise.all(s.children.map((c) => ws.readTask(c)));
          if (!tail.some((e) => e.type === 'autopilot.step' && e.payload.split)) {
            const order = kids.map((k) => (k.dependsOn?.length ? `${k.id} after ${k.dependsOn.join(' and ')}` : k.id)).join(', ');
            await this.step(id, 'build', `Split into ${kids.length} subtasks: ${order}. Each goes through autopilot and your approval.`, { split: s.children });
            for (const k of kids) await this.start(k.id);
          }
          const stuck = kids.find((k) => k.status === 'abandoned');
          if (stuck) return this.stop(id, `Needs you: subtask ${stuck.id} was abandoned.`, true);
          if (kids.every((k) => k.status === 'done')) {
            await ws.writeTask(id, { status: 'done', pendingAsk: null });
            return this.stop(id, `All ${kids.length} subtasks are merged.`);
          }
          return;
        }
        if (s.kind === 'adopt') {
          await this.step(id, 'build', `Adopting ${s.candidate}: the daemon verifies the chosen work again on this task's branch, then it is reviewed.`, { adopt: s.candidate });
          await adoptCandidate(this.ctx, id, s.candidate);
          continue;
        }
        if (s.kind === 'hand') {
          const next = await this.firstAvailable(s.after, id);
          if (!next) return this.stop(id, `Needs you: ${s.reason}, and no other implementer is available.`, true);
          await this.step(id, 'hand', `${s.reason}; handing ${s.handoffFrom ?? 'the task'} to ${next}.`, { from: s.after, to: next, handoffFrom: s.handoffFrom });
          await assign(this.ctx, id, { adapter: next, role: 'implementer', ...(s.handoffFrom ? { handoffFrom: s.handoffFrom } : {}) });
          return;
        }
      } catch (err) {
        const message = err instanceof DaemonError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
        return this.stop(id, `Needs you: ${message}`, true);
      }
    }
  }
}
