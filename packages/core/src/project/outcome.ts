import { ciFailing } from '../metrics/defs/outcome';
import type { StintEvent } from '../schemas/event';
import type { CriterionState, Outcome, OutcomeResult } from '../schemas/outcome';
import type { Task } from '../schemas/task';
import type { VerificationRecord } from '../store/runs';

/**
 * How one task went (R-063): a pure projection over its log and verification records, defined in docs/metrics.md,
 * How it went. The usage, limits and proofs types are R-062's and R-064's shapes.
 */
export type TaskUsage = { builds: number; handoffs: number; reviewRounds: number; usd: number; unpriced: number; minutes: number };
/** A field left out or null is no limit. */
export type TaskLimits = { builds?: number | null; handoffs?: number | null; reviewRounds?: number | null; usd?: number | null; minutes?: number | null };
/** `criterion` is the index into `task.acceptance`. */
export type Proof = { criterion: number; kind: 'test' | 'scenario' | 'check' | 'human'; ref: string };

export type OutcomeInput = {
  task: Task;
  events: StintEvent[];
  verifications: VerificationRecord[];
  config: { metrics?: { outcomeWindowDays: number } };
  now: string;
  usage?: TaskUsage;
  limits?: TaskLimits;
  proofs?: Proof[];
};

const DAY_MS = 86_400_000;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);

/** R-062's `taskUsage(events)` replaces this at integration. Same Definitions, but a run still going counts no time yet. */
export function usageFromEvents(events: StintEvent[]): TaskUsage {
  const started = new Map<string, StintEvent>();
  const u: TaskUsage = { builds: 0, handoffs: 0, reviewRounds: 0, usd: 0, unpriced: 0, minutes: 0 };
  const spend = (cost: unknown) => {
    if (!cost || typeof cost !== 'object') return;
    const usd = (cost as { usd?: unknown }).usd;
    if (typeof usd === 'number') u.usd += usd;
    else u.unpriced += 1;
  };
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'run.started' && e.run) started.set(e.run, e);
    if (e.type === 'run.finished' && e.run) {
      const s = started.get(e.run);
      if (s?.payload.role === 'implementer' && !s.payload.adoptedFrom) u.builds += 1;
      if (s) u.minutes += (Date.parse(e.ts) - Date.parse(s.ts)) / 60_000;
      spend(p.cost);
    }
    if (e.type === 'autopilot.step' && (p.step === 'hand' || p.step === 'escalate')) u.handoffs += 1;
    if (e.type === 'autopilot.step' && p.step === 'build' && p.changes) u.reviewRounds += 1;
    if (e.type === 'skill.proposed' || e.type === 'bestofn.picked' || e.type === 'cost.recorded') spend(p.cost);
    if (e.type === 'handoff.quizzed') for (const side of ['writer', 'answerer']) spend((p[side] as { cost?: unknown } | undefined)?.cost);
  }
  u.usd = Math.round(u.usd * 10_000) / 10_000;
  return u;
}

const LABELS: Record<OutcomeResult, string> = {
  in_progress: 'In progress',
  waiting_for_you: 'Waiting for you',
  stopped_at_limit: 'Stopped at a limit',
  stopped_needs_you: 'Stopped, needs you',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
  merged: 'Merged',
  merged_reverted: 'Merged, then reverted',
  merged_followup: 'Merged, needed a follow-up',
  merged_ci_failed: 'Merged, CI failed',
  merged_incident: 'Merged, incident',
  merged_held_up: 'Merged, held up',
};

/** A duration in words with its unit: "40 s", "14 min", "3 h", "2 days". */
export function durationWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
}

/** A criterion's state in words; the gate says more for `passing`. */
export const CRITERION_STATE_LABELS: Record<CriterionState, string> = {
  proven: 'Proven',
  passing: 'Passes, not proven',
  failing: 'Failing',
  you_check: 'You check it',
  checked_by_you: 'Checked by you',
  not_checked: 'Not checked',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one line the gate shows: "3 builds, 1 hand-off, $0.61, 14 min to green". */
export function outcomeLine(o: Outcome): string {
  const usd = o.spend.usd > 0 && o.spend.usd < 0.01 ? o.spend.usd.toFixed(4) : o.spend.usd.toFixed(2);
  const unpriced = o.spend.unpriced ? ` plus ${plural(o.spend.unpriced, 'unpriced call')}` : '';
  const green = o.timeToFirstGreen === undefined ? 'not green yet' : `${durationWords(o.timeToFirstGreen)} to green`;
  return `${plural(o.loops.builds, 'build')}, ${plural(o.loops.handoffs, 'hand-off')}, $${usd}${unpriced}, ${green}`;
}

type Judged = { state: CriterionState; evidence: string };

export function outcome(input: OutcomeInput): Outcome {
  const { task, events, now } = input;
  const usage = input.usage ?? usageFromEvents(events);
  const first = (type: string, ok: (e: StintEvent) => boolean = () => true) => events.find((e) => e.type === type && ok(e));
  const since = (from: string, e: StintEvent | undefined) => (e ? Math.max(0, Date.parse(e.ts) - Date.parse(from)) : undefined);

  // the latest verification, the names that failed in it, and every name that failed before it
  const latest = [...input.verifications].sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
  const latestAt = latest ? events.findLastIndex((e) => e.type === 'verification.ran' && e.run === latest.run) : -1;
  const failingNow = latestAt >= 0 ? names(events[latestAt]?.payload.failing) : [];
  const lockFailing = events.filter((e) => e.type === 'acceptance.locked').flatMap((e) => names(e.payload.failing));
  const failedBefore = events.slice(0, latestAt < 0 ? events.length : latestAt).filter((e) => e.type === 'verification.ran' && e.run !== latest?.run);
  const green = latest?.status === 'green';
  const run = latest?.run ?? '';
  const granted = events.findLast((e) => e.type === 'approval.granted');
  const scenario = events.findLast((e) => e.type === 'scenario.ran' && e.run === run);

  const judge = (proof: { kind: string; ref: string } | undefined): Judged => {
    if (proof?.kind === 'human') {
      if (!granted) return { state: 'you_check', evidence: 'You check this before you approve.' };
      const by = str(granted.payload.by);
      // the auto-approve lane is not a person, so nobody checked it
      if (by === 'policy') return { state: 'you_check', evidence: 'The auto-approve lane merged it, so no person checked this.' };
      return { state: 'checked_by_you', evidence: `Checked by ${!by || by === 'human' ? 'you' : by} at approval.` };
    }
    if (!latest) return { state: 'not_checked', evidence: 'Stint has not run the tests yet.' };
    if (!proof) {
      if (!green) return { state: 'failing', evidence: `The tests fail in ${run}: ${plural(latest.failed, 'test')} failed.` };
      if (lockFailing.length === 0) return { state: 'passing', evidence: `The tests pass in ${run}, but no test showed it failing first.` };
      const shown = lockFailing.slice(0, 3).join(', ') + (lockFailing.length > 3 ? ` and ${lockFailing.length - 3} more` : '');
      return { state: 'proven', evidence: `The locked tests ${shown} failed at lock time and pass in ${run}.` };
    }
    const { kind, ref } = proof;
    if (kind === 'check') {
      const c = latest.checks?.find((x) => x.name === ref);
      if (!c) return { state: 'not_checked', evidence: `The check ${ref} did not run in ${run}.` };
      return c.status === 'green' ? { state: 'proven', evidence: `The check ${ref} passes in ${run}.` } : { state: 'failing', evidence: `The check ${ref} fails in ${run}.` };
    }
    if (kind === 'scenario') {
      const ran = names(scenario?.payload.names).find((n) => n.includes(ref));
      if (!scenario || !ran) return { state: 'not_checked', evidence: `The scenario ${ref} did not run in ${run}.` };
      const failing = names(scenario.payload.failing);
      // a failed count with no names cannot say which scenario failed, so none counts as passed
      const failed = failing.some((n) => n.includes(ref)) || (Number(scenario.payload.failed) > 0 && failing.length === 0);
      return failed ? { state: 'failing', evidence: `The scenario ${ran} fails in ${run}.` } : { state: 'proven', evidence: `The scenario ${ran} passes in ${run}.` };
    }
    const now = failingNow.find((n) => n.includes(ref));
    if (now) return { state: 'failing', evidence: `${now} fails in ${run}.` };
    if (!green) return { state: 'not_checked', evidence: `The tests are red in ${run}, and ${ref} is not among the failing names Stint read.` };
    const atLock = lockFailing.find((n) => n.includes(ref));
    if (atLock) return { state: 'proven', evidence: `${atLock} failed at lock time and passes in ${run}.` };
    for (const e of failedBefore) {
      const hit = names(e.payload.failing).find((n) => n.includes(ref));
      if (hit) return { state: 'proven', evidence: `${hit} failed in ${e.run ?? 'an earlier run'} and passes in ${run}.` };
    }
    return { state: 'passing', evidence: `${ref} passes in ${run}, but no test showed it failing first.` };
  };

  const criteria = task.acceptance.map((text, index) => {
    const p = input.proofs?.find((x) => x.criterion === index);
    const proof = p ? { kind: p.kind, ref: p.ref } : undefined;
    return { index, text, ...judge(proof), ...(proof ? { proof } : {}) };
  });

  // after merge: what happened within the outcome window
  const merge = first('merge.completed');
  let afterMerge: Outcome['afterMerge'];
  if (merge) {
    const days = input.config.metrics?.outcomeWindowDays ?? 7;
    const endsMs = Date.parse(merge.ts) + days * DAY_MS;
    const within = events.filter((e) => Date.parse(e.ts) >= Date.parse(merge.ts) && Date.parse(e.ts) <= endsMs);
    const ci = within.find((e) => e.type === 'outcome.ci' && ciFailing(e));
    afterMerge = {
      window: { days, endsAt: new Date(endsMs).toISOString(), mature: Date.parse(now) >= endsMs },
      reverted: within.some((e) => e.type === 'outcome.reverted'),
      followups: within.filter((e) => e.type === 'outcome.followup').flatMap((e) => names([e.payload.followup])),
      ...(ci ? { ci: { status: String(ci.payload.status), run: ci.payload.run === undefined || ci.payload.run === null ? null : String(ci.payload.run) } } : {}),
      incidents: within.filter((e) => e.type === 'outcome.incident').map((e) => str(e.payload.summary) ?? 'An incident was reported against the merge.'),
    };
  }

  const result = ((): OutcomeResult => {
    if (afterMerge || task.status === 'done') {
      if (!afterMerge) return 'merged';
      if (afterMerge.reverted) return 'merged_reverted';
      if (afterMerge.incidents.length) return 'merged_incident';
      if (afterMerge.ci) return 'merged_ci_failed';
      if (afterMerge.followups.length) return 'merged_followup';
      return afterMerge.window.mature ? 'merged_held_up' : 'merged';
    }
    if (task.status === 'rejected') return 'rejected';
    if (task.status === 'abandoned') return 'abandoned';
    // autopilot stopped and nothing started since: at a limit when one was reached after it last started
    const lastAt = events.findLastIndex((e) => e.type === 'autopilot.started' || e.type === 'autopilot.stopped' || e.type === 'run.started');
    const last = events[lastAt];
    if (last?.type === 'autopilot.stopped') {
      const startedAt = events.findLastIndex((e) => e.type === 'autopilot.started');
      // limit.reached is R-062's event type, read by name until it is in EVENT_TYPES
      const atLimit = last.payload.limit || events.slice(startedAt + 1, lastAt).some((e) => (e.type as string) === 'limit.reached');
      if (atLimit) return 'stopped_at_limit';
      if (last.payload.needsYou) return 'stopped_needs_you';
    }
    return task.status === 'awaiting_approval' ? 'waiting_for_you' : 'in_progress';
  })();

  const reviews = events.filter((e) => e.type === 'review.recorded');
  const verdicts = reviews
    .map((e) => str(e.payload.verdict) ?? str((e.payload.review as { verdict?: unknown } | undefined)?.verdict))
    .filter((v): v is 'approve' | 'request_changes' | 'block' => v === 'approve' || v === 'request_changes' || v === 'block');
  // the findings of the review that stands: the latest
  const findings = (reviews.at(-1)?.payload.review as { findings?: Array<{ severity?: string }> } | undefined)?.findings ?? [];
  const bySeverity = { blocker: 0, major: 0, minor: 0, note: 0 };
  for (const f of findings) if (f.severity && f.severity in bySeverity) bySeverity[f.severity as keyof typeof bySeverity] += 1;

  const requested = first('approval.requested');
  const decided = requested ? events.find((e) => (e.type === 'approval.granted' || e.type === 'approval.rejected') && e.seq > requested.seq) : undefined;

  return {
    version: 'stint.outcome/1',
    task: task.id,
    result,
    resultLabel: LABELS[result],
    criteria,
    loops: { builds: usage.builds, handoffs: usage.handoffs, reviewRounds: usage.reviewRounds },
    limits: input.limits,
    spend: { usd: usage.usd, unpriced: usage.unpriced },
    minutes: usage.minutes,
    // times from the first event of each kind; one that has not happened is left out
    timeToFirstGreen: since(task.createdAt, first('verification.ran', (e) => e.payload.status === 'green')),
    timeToApprovalRequest: since(task.createdAt, requested),
    approvalWait: requested ? since(requested.ts, decided) : undefined,
    leadTime: since(task.createdAt, merge),
    review: { rounds: reviews.length, verdicts, findings: { total: findings.length, bySeverity } },
    handoffs: events
      .filter((e) => e.type === 'handoff.created')
      .map((e) => {
        const p = e.payload as { from?: { adapter?: unknown }; to?: { adapter?: unknown }; tokens?: unknown };
        return { from: str(p.from?.adapter) ?? 'unknown', to: str(p.to?.adapter) ?? 'unknown', packetTokens: Math.max(0, Math.round(Number(p.tokens) || 0)) };
      }),
    afterMerge,
  };
}
