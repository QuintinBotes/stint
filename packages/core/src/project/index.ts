import type { Cost, EndedBy, Handoff } from '../schemas/handoff';
import type { StintEvent } from '../schemas/event';
import type { Plan } from '../schemas/plan';
import type { Review } from '../schemas/review';
import type { Task } from '../schemas/task';
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
  /** The sign-off, from the log: who approved, when, and the merge commit. */
  merge?: { commit: string; into: string | null; by: string | null; at: string; trailers: Record<string, string> } | null;
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
      if (!r.host && typeof e.payload.host === 'string') r.host = e.payload.host;
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
  const merge = merged
    ? { commit: str(merged.payload.commit) ?? '', into: str(merged.payload.into), by: str(granted?.payload.by), at: merged.ts, trailers: (merged.payload.trailers ?? {}) as Record<string, string> }
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
    verification: await ws.verification(id).latest(),
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

export type CostRow = Cost & { key: string; runs: number; creditsLeft?: number; derived?: true; roles?: string[] };

/** Local CLIs (Muse Code) run Meta models billed to the Meta Model API (D-018). */
export function billingHost(host: string | null): string {
  return host === 'local-cli' || host === null ? 'meta-api' : host;
}
export type CostGroup = 'task' | 'run' | 'day' | 'host' | 'model' | 'day-host';

/** Cost rows across every task, from `run.finished` events. `day` is the UTC date of the run's end. */
export async function costs(ws: Workspace, o: { group: CostGroup }): Promise<CostRow[]> {
  const groups = new Map<string, Array<Cost | null>>();
  const roles = new Map<string, Set<string>>();
  for (const task of await ws.listTasks()) {
    for (const r of runsFromEvents(await ws.events(task.id).read())) {
      if (!r.endedAt) continue;
      const key =
        o.group === 'task'
          ? task.id
          : o.group === 'run'
            ? `${task.id}/${r.run}`
            : o.group === 'day'
              ? r.endedAt.slice(0, 10)
              : o.group === 'model'
                ? `${billingHost(r.host)}/${r.model ?? 'unknown'}`
                : o.group === 'day-host'
                  ? `${r.endedAt.slice(0, 10)}|${billingHost(r.host)}`
                  : billingHost(r.host);
      const list = groups.get(key) ?? [];
      list.push(r.cost);
      groups.set(key, list);
      if (r.role) roles.set(key, new Set([...(roles.get(key) ?? []), r.role]));
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, ...sumCosts(list), runs: list.length, ...(o.group === 'model' ? { roles: [...(roles.get(key) ?? [])].sort() } : {}) }));
}
