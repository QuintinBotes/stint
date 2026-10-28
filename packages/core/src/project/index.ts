import type { Cost, EndedBy, Handoff } from '../schemas/handoff';
import type { StintEvent } from '../schemas/event';
import type { Plan } from '../schemas/plan';
import type { Review } from '../schemas/review';
import type { Task } from '../schemas/task';
import { canonicalJSON, sha256Hex } from '../canonical';
import { localDay, weekOf } from '../cost';
import type { VerificationRecord } from '../store/runs';
import type { Workspace } from '../store/workspace';

export type RunSummary = {
  run: string;
  adapter: string | null;
  vendor: string | null;
  role: string | null;
  model: string | null;
  host: string | null;
  startedAt: string;
  endedAt: string | null;
  endedBy: EndedBy | null;
  cost: Cost | null;
  handoffFrom: string | null;
};

/** One thing that happened to a merged change, from an `outcome.*` event (R-030, R-042). */
export type OutcomeRecord = {
  kind: 'reverted' | 'followup' | 'ci' | 'incident';
  type: string;
  at: string;
  task: string;
  commit: string | null;
  mergeCommit: string | null;
  by: string | null;
  followup: string | null;
  files: string[];
  run: string | number | null;
  status: string | null;
  summary: string | null;
  url: string | null;
  payload: Record<string, unknown>;
};

export type TaskBundle = {
  task: Task;
  plan: Plan | null;
  handoff: Handoff | null;
  review: Review | null;
  verification: VerificationRecord | null;
  runs: RunSummary[];
  cost: Cost;
  /** The sign-off record: who approved, when, the verification hash and the merge commit. */
  merge?: { commit: string; into: string | null; by: string | null; at: string; trailers: Record<string, string>; verificationHash: string | null } | null;
  /** Reverts, follow-ups, failing CI and incidents recorded after merge (R-030, R-042). */
  outcomes: OutcomeRecord[];
  /** The open pull request, in PR release mode (R-042). */
  release?: { url: string | null; number: number | null; status: string | null } | null;
  /** The latest risk tier and its reasons, and whether the auto-approve lane merged it (R-039). */
  risk?: { tier: string; reasons: string[]; byPolicy: boolean } | null;
};

/** Outcomes as the event log tells them: one per `outcome.*` event, oldest first. */
export function outcomesFromEvents(events: StintEvent[]): OutcomeRecord[] {
  const out: OutcomeRecord[] = [];
  for (const e of events) {
    if (!e.type.startsWith('outcome.')) continue;
    const kind = e.type.slice('outcome.'.length) as OutcomeRecord['kind'];
    if (!['reverted', 'followup', 'ci', 'incident'].includes(kind)) continue;
    const p = e.payload;
    out.push({
      kind,
      type: e.type,
      at: e.ts,
      task: str(p.task) ?? e.task,
      commit: str(p.commit),
      mergeCommit: str(p.mergeCommit) ?? str(p.revertedCommit),
      by: str(p.by),
      followup: str(p.followup),
      files: Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : [],
      run: typeof p.run === 'string' || typeof p.run === 'number' ? p.run : null,
      status: str(p.status),
      summary: str(p.summary),
      url: str(p.url),
      payload: p,
    });
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Runs as the event log tells them: one per `run.started`, closed by its `run.finished`. */
export function runsFromEvents(events: StintEvent[]): RunSummary[] {
  const runs = new Map<string, RunSummary>();
  for (const e of events) {
    if (!e.run) continue;
    if (e.type === 'run.started') {
      runs.set(e.run, {
        run: e.run,
        adapter: e.adapter ?? str(e.payload.adapter),
        vendor: e.vendor ?? str(e.payload.vendor),
        role: str(e.payload.role),
        model: str(e.payload.model),
        host: str(e.payload.host),
        startedAt: e.ts,
        endedAt: null,
        endedBy: null,
        cost: null,
        handoffFrom: str(e.payload.handoffFrom),
      });
    } else if (e.type === 'run.finished') {
      const r = runs.get(e.run);
      if (!r) continue;
      r.endedAt = e.ts;
      r.endedBy = e.payload.endedBy as EndedBy;
      r.cost = e.payload.cost as Cost;
      // the host and model that answered, as the packet records them: a run starts as local-cli or on the first host of its chain
      r.host = str(e.payload.host) ?? r.host;
      r.model = str(e.payload.model) ?? r.model;
    }
  }
  return [...runs.values()].sort((a, b) => Number(a.run.slice(1)) - Number(b.run.slice(1)));
}

/** Sums costs; an unpriced or estimated part makes the total `estimated`, and its USD counts as 0. */
export function sumCosts(costs: Array<Cost | null | undefined>): Cost {
  const total: Cost = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 };
  let estimated = false;
  for (const c of costs) {
    if (!c) continue;
    total.inputTokens += c.inputTokens;
    total.cachedTokens += c.cachedTokens;
    total.outputTokens += c.outputTokens;
    if (c.usd === null) estimated = true;
    else total.usd = (total.usd ?? 0) + c.usd;
    if (c.estimated) estimated = true;
  }
  total.usd = Math.round((total.usd ?? 0) * 10_000) / 10_000;
  if (estimated) total.estimated = true;
  return total;
}

export async function taskBundle(ws: Workspace, id: string): Promise<TaskBundle> {
  const task = await ws.readTask(id);
  const events = await ws.events(id).read();
  const runs = runsFromEvents(events);
  const merged = events.filter((e) => e.type === 'merge.completed').at(-1);
  const granted = events.filter((e) => e.type === 'approval.granted').at(-1);
  // signoff.json is the record approve wrote; the log stands in where there is none, as in a replay.
  const signoff = merged ? await ws.readDoc<{ by?: string; at?: string; verificationHash?: string; commit?: string }>(id, 'signoff.json').catch(() => null) : null;
  const latestVerification = await ws.verification(id).latest();
  const merge = merged
    ? {
        commit: signoff?.commit ?? str(merged.payload.commit) ?? '',
        into: str(merged.payload.into),
        by: signoff?.by ?? str(granted?.payload.by),
        at: signoff?.at ?? merged.ts,
        trailers: (merged.payload.trailers ?? {}) as Record<string, string>,
        verificationHash: signoff?.verificationHash ?? (latestVerification ? `sha256:${sha256Hex(canonicalJSON(latestVerification))}` : null),
      }
    : null;
  const opened = events.filter((e) => e.type === 'release.pr_opened').at(-1);
  const assessed = events.filter((e) => e.type === 'risk.assessed').at(-1);
  const release = opened
    ? { url: str(opened.payload.url), number: typeof opened.payload.number === 'number' ? opened.payload.number : null, status: merged ? 'merged' : task.status === 'in_review' ? 'open' : 'closed' }
    : null;
  return {
    task,
    plan: await ws.readPlan(id),
    handoff: await ws.handoffs(id).latest(),
    review: await ws.readReview(id),
    verification: latestVerification,
    runs,
    cost: sumCosts(runs.map((r) => r.cost)),
    merge,
    outcomes: outcomesFromEvents(events),
    release,
    risk: assessed ? { tier: String(assessed.payload.tier), reasons: (assessed.payload.reasons as string[] | undefined) ?? [], byPolicy: events.some((e) => e.type === 'autoapprove.granted') } : null,
  };
}

export function latestHandoff(ws: Workspace, id: string): Promise<Handoff | null> {
  return ws.handoffs(id).latest();
}

/**
 * `runs` counts the row's runs; other model calls (learn, quiz, pick, digest, board summary, triage) add spend but are not runs. `unpriced` counts the runs and calls
 * with no price: their spend is unknown, so it is not in `usd` and not $0.
 */
export type CostRow = Cost & { key: string; runs: number; unpriced: number; creditsLeft?: number; derived?: true; roles?: string[] };

/**
 * Who a run's spend is charged to, as its price key names it (D-029, R-032): the host that answered; for a local
 * CLI, the Meta Model API when it is Muse Code, else the agent itself, whose account Stint cannot see, so no
 * configured host's credits are drawn.
 */
export function billingHost(host: string | null, adapter: string | null): string {
  if (host && host !== 'local-cli') return host;
  return adapter === 'muse-code' ? 'meta-api' : (adapter ?? 'unknown');
}
export type CostGroup = 'task' | 'run' | 'day' | 'week' | 'host' | 'model' | 'day-host';

type Spend = { at: string; key: string; host: string | null; adapter: string | null; model: string | null; role: string | null; cost: Cost | null; run: boolean };

/**
 * Model calls that are not runs and record their cost on one event each: the learn step, both sides of a packet quiz,
 * the autopilot's pick among candidates, and `cost.recorded` for the rest (a packet digest in a task's log; a board
 * summary or an intake triage in the workspace log, which `task` names as `workspace`).
 */
function callsFromEvents(task: string, events: StintEvent[]): Spend[] {
  const out: Spend[] = [];
  const call = (e: StintEvent, role: string, side: Record<string, unknown> | undefined, key: string) => {
    if (side && typeof side.cost === 'object' && side.cost !== null) out.push({ at: e.ts, key, host: str(side.host), adapter: null, model: str(side.model), role, cost: side.cost as Cost, run: false });
  };
  for (const e of events) {
    if (e.type === 'skill.proposed') call(e, 'learn', e.payload, `${task}/learn`);
    if (e.type === 'handoff.quizzed') for (const side of ['writer', 'answerer']) call(e, 'quiz', e.payload[side] as Record<string, unknown> | undefined, `${task}/quiz`);
    if (e.type === 'bestofn.picked') call(e, 'pick', e.payload, `${task}/pick`);
    if (e.type === 'sharpen.asked') call(e, 'sharpen', e.payload, `${task}/sharpen`);
    if (e.type === 'cost.recorded') call(e, String(e.payload.for), e.payload, `${task}/${String(e.payload.for)}`);
  }
  return out;
}

/**
 * Cost rows across every task. A run counts once, when its `run.finished` lands, and a run still going counts nothing
 * yet; `day` is the local date it ended and `week` the local Monday-to-Sunday week, keyed by its Monday. Every other
 * grouping includes the calls that are not runs; a task's total is its runs, so the `task` grouping leaves them out.
 */
export async function costs(ws: Workspace, o: { group: CostGroup }): Promise<CostRow[]> {
  const groups = new Map<string, Spend[]>();
  const roles = new Map<string, Set<string>>();
  const add = (task: string, list: Spend[]) => {
    for (const s of list) {
      const day = localDay(s.at);
      const host = billingHost(s.host, s.adapter);
      const key = { task, run: s.key, day, week: weekOf(s.at), host, model: `${host}/${s.model ?? 'unknown'}`, 'day-host': `${day}|${host}` }[o.group];
      const rows = groups.get(key) ?? [];
      rows.push(s);
      groups.set(key, rows);
      if (s.role) roles.set(key, new Set([...(roles.get(key) ?? []), s.role]));
    }
  };
  for (const task of await ws.listTasks()) {
    const events = await ws.events(task.id).read();
    const runs: Spend[] = runsFromEvents(events).flatMap((r) => (r.endedAt ? [{ at: r.endedAt, key: `${task.id}/${r.run}`, host: r.host, adapter: r.adapter, model: r.model, role: r.role, cost: r.cost, run: true }] : []));
    add(task.id, o.group === 'task' ? runs : [...runs, ...callsFromEvents(task.id, events)]);
  }
  if (o.group !== 'task') add('workspace', callsFromEvents('workspace', await ws.workspaceEvents().read()));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      ...sumCosts(list.map((s) => s.cost)),
      runs: list.filter((s) => s.run).length,
      unpriced: list.filter((s) => (s.cost?.usd ?? null) === null).length,
      ...(o.group === 'model' ? { roles: [...(roles.get(key) ?? [])].sort() } : {}),
    }));
}
