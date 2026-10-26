import type { Config, StintEvent, Task } from '@stint-dev/core';
import { runsFromEvents } from '@stint-dev/core/node';
import type { DaemonContext } from './app';
import { DaemonError } from './errors';
import { lockAcceptance } from './acceptance';
import { assign } from './lifecycle';
import { planTask, reviewTask } from './routes/models';

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

/** A task holds a slot once it has taken a step that is not waiting in the queue. */
export function holdsSlot(tail: StintEvent[]): boolean {
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
  const planned = events.some((e) => e.type === 'run.started' && e.payload.role === 'planner') || tail.some((e) => e.type === 'autopilot.step' && e.payload.step === 'plan');
  if (!planned) return { kind: 'plan' };

  // tests first (R-027): failing acceptance tests are written and locked before anything is built
  let fromLock = tail;
  if (s.testsFirst) {
    const lockAt = tail.findIndex((e) => e.type === 'acceptance.locked');
    if (lockAt < 0) return specifyStep(tail);
    fromLock = tail.slice(lockAt);
    const tampered = fromLock.find((e) => e.type === 'acceptance.tampered');
    if (tampered) {
      const by = runsFromEvents(tail).find((r) => r.run === tampered.run);
      return { kind: 'stop', reason: `Needs you: ${by?.adapter ?? 'an agent'} ${tampered.run} changed the acceptance tests (${(tampered.payload.files as string[]).join(', ')}).`, needsYou: true };
    }
  }

  const impl = runsFromEvents(fromLock).filter((r) => r.role === 'implementer');
  const last = impl.at(-1);
  if (!last) return { kind: 'build', reason: s.testsFirst ? 'The acceptance tests are locked and fail.' : 'Nothing is built yet.' };
  if (!last.endedBy) return { kind: 'wait', reason: `${last.run} has not finished` };

  const verification = tail.filter((e) => e.type === 'verification.ran' && e.run === last.run).at(-1);
  const status = verification?.payload.status as string | undefined;
  if (last.endedBy !== 'completed' || status !== 'green') {
    const hops = tail.filter((e) => e.type === 'autopilot.step' && e.payload.step === 'hand').length;
    const reason = `${last.adapter} ${last.run} ${why(last.endedBy, status)}`;
    if (hops >= s.maxHops) return { kind: 'stop', reason: `Needs you: ${reason}, after ${hops} handoffs.`, needsYou: true };
    const stuck = noProgress(tail, impl);
    if (stuck) return { kind: 'stop', reason: `Needs you: two agents in a row got no further. ${stuck}`, needsYou: true };
    const packet = tail.filter((e) => e.type === 'handoff.created' && e.run === last.run).at(-1);
    return { kind: 'hand', after: last.adapter ?? '', handoffFrom: (packet?.payload.name as string | undefined) ?? null, reason };
  }

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

  constructor(private readonly ctx: DaemonContext) {}

  private get settings(): AutopilotSettings {
    return this.ctx.ws.config.autopilot ?? AUTOPILOT_DEFAULTS;
  }

  async start(id: string): Promise<void> {
    const events = await this.ctx.ws.events(id).read();
    if (!autopilotTail(events)) await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.started', payload: { settings: this.settings } });
    this.kick(id);
  }

  async stop(id: string, reason: string, needsYou = false): Promise<void> {
    if (!autopilotTail(await this.ctx.ws.events(id).read())) return;
    await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.stopped', payload: { reason, needsYou } });
    // a slot may have opened
    for (const t of await this.ctx.ws.listTasks()) if (t.id !== id) this.kick(t.id);
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

  async status(): Promise<{ running: string[]; queued: string[] }> {
    const running: string[] = [];
    const queued: string[] = [];
    for (const t of await this.ctx.ws.listTasks()) {
      const tail = autopilotTail(await this.ctx.ws.events(t.id).read());
      if (tail) (holdsSlot(tail) ? running : queued).push(t.id);
    }
    return { running, queued };
  }

  private async step(id: string, step: string, reason: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autopilot.step', payload: { step, reason, ...extra } });
  }

  private async firstAvailable(after?: string): Promise<string | null> {
    const chain = this.settings.implementers.filter((a) => this.ctx.adapters.some((x) => x.id === a));
    if (chain.length === 0) return null;
    const from = after ? chain.indexOf(after) + 1 : 0;
    for (let i = 0; i < chain.length; i++) {
      const id = chain[(from + i) % chain.length] as string;
      const adapter = this.ctx.adapters.find((x) => x.id === id);
      if (adapter && (await adapter.available()).ok) return id;
    }
    return null;
  }

  private async tick(id: string): Promise<void> {
    const ws = this.ctx.ws;
    for (let guard = 0; guard < 8; guard++) {
      const events = await ws.events(id).read();
      const tail = autopilotTail(events);
      const s = nextStep(events, await ws.readTask(id), this.settings, !!this.ctx.runs.get(id));
      if (s.kind === 'idle' || s.kind === 'wait' || !tail) return;
      if (s.kind === 'stop') return this.stop(id, s.reason, s.needsYou);

      if (!holdsSlot(tail)) {
        const holders: string[] = [];
        for (const t of await ws.listTasks()) {
          const other = t.id === id ? null : autopilotTail(await ws.events(t.id).read());
          if (other && holdsSlot(other)) holders.push(t.id);
        }
        if (holders.length >= this.settings.parallel) {
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
          const adapter = s.adapter ?? (await this.firstAvailable());
          if (!adapter) return this.stop(id, `Needs you: no implementer in ${this.settings.implementers.join(', ')} is available.`, true);
          await this.step(id, 'build', `${s.reason} ${adapter} builds it.`, { adapter, ...(s.ask ? { changes: true } : {}) });
          await assign(this.ctx, id, { adapter, role: 'implementer', ...(s.ask ? { instruction: s.ask } : {}) });
          return;
        }
        if (s.kind === 'hand') {
          const next = await this.firstAvailable(s.after);
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
