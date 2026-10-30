import type { StintEvent } from '../schemas/event';

/** One lane per agent: a coding agent and its model, a model a host served directly, or the person. */
export type RelayLane = { id: string; adapter: string | null; model: string | null; host: string | null; roles: string[]; human: boolean };
export type RelayRun = {
  task: string;
  run: string;
  lane: string;
  role: string | null;
  start: number;
  end: number | null;
  endedBy: string | null;
  usd: number | null;
  verified: 'green' | 'red' | null;
};
export type RelayLink =
  | { kind: 'packet'; task: string; from: string; to: string | null; name: string; tokens: number | null; at: number }
  | { kind: 'skill'; skill: string; fromTask: string; from: string; toTask: string; to: string; at: number };
export type RelayMark = { kind: 'approved' | 'rejected' | 'decided' | 'kept'; task: string; at: number; text: string };
export type Relay = { lanes: RelayLane[]; runs: RelayRun[]; links: RelayLink[]; marks: RelayMark[]; from: number; to: number; replay: boolean };

/** Story time when the event came from a replay, so a recording reads at its own pace; wall time otherwise. */
const timeOf = (e: StintEvent) => (typeof e.payload.replayAt === 'number' ? e.payload.replayAt : Date.parse(e.ts));
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** The lane is who did the work: a run that fell through its chain, or learned its model as it went, says so when it finishes. */
function laneOf(started: StintEvent, finished?: StintEvent): Omit<RelayLane, 'roles'> {
  const adapter = started.adapter ?? null;
  const model = str(finished?.payload.model) ?? str(started.payload.model);
  const host = str(finished?.payload.host) ?? str(started.payload.host);
  // a model a host answered directly (plan, review, learn) is its own lane; a coding agent is a lane per agent and model
  if (adapter === 'openai-compatible' || !adapter) return { id: `${host ?? 'host'}/${model ?? 'model'}`, adapter, model, host, human: false };
  return { id: `${adapter}:${model ?? 'default'}`, adapter, model, host: host === 'local-cli' ? null : host, human: false };
}

/**
 * The whole floor as one picture: every run of every task on its agent's lane, the packets that carried a task
 * from one agent to the next, the skills that carried a lesson from one task to another, and what the person did.
 */
export function relayFromEvents(byTask: Array<{ task: string; events: StintEvent[] }>): Relay {
  const lanes = new Map<string, RelayLane>();
  const runs: RelayRun[] = [];
  const links: RelayLink[] = [];
  const marks: RelayMark[] = [];
  const skillFrom = new Map<string, { task: string; run: string }>();
  let replay = false;

  for (const { task, events } of byTask) {
    const index = new Map<string, RelayRun>();
    const startedBy = new Map<string, StintEvent>();
    const place = (r: RelayRun, l: Omit<RelayLane, 'roles'>) => {
      if (!lanes.has(l.id)) lanes.set(l.id, { ...l, roles: [] });
      r.lane = l.id;
    };
    for (const e of events) {
      if (typeof e.payload.replayAt === 'number') replay = true;
      if (e.type === 'run.started' && e.run) {
        const r: RelayRun = { task, run: e.run, lane: '', role: str(e.payload.role), start: timeOf(e), end: null, endedBy: null, usd: null, verified: null };
        place(r, laneOf(e));
        startedBy.set(e.run, e);
        index.set(e.run, r);
        runs.push(r);
      } else if (e.type === 'run.finished' && e.run) {
        const r = index.get(e.run);
        if (r) {
          place(r, laneOf(startedBy.get(e.run) as StintEvent, e));
          r.end = timeOf(e);
          r.endedBy = str(e.payload.endedBy);
          r.usd = typeof (e.payload.cost as { usd?: unknown } | undefined)?.usd === 'number' ? ((e.payload.cost as { usd: number }).usd) : null;
        }
      } else if (e.type === 'verification.ran' && e.run) {
        const r = index.get(e.run);
        if (r) r.verified = e.payload.status === 'green' ? 'green' : 'red';
      } else if (e.type === 'handoff.created' && e.run) {
        const name = str(e.payload.name) ?? '';
        const to = events.find((s) => s.type === 'run.started' && s.payload.handoffFrom === name)?.run ?? null;
        links.push({ kind: 'packet', task, from: e.run, to, name, tokens: typeof e.payload.tokens === 'number' ? e.payload.tokens : null, at: timeOf(e) });
      } else if (e.type === 'skill.proposed' || e.type === 'skill.approved') {
        const id = str(e.payload.id) ?? str(e.payload.skill);
        const evidence = Array.isArray(e.payload.evidence) ? (e.payload.evidence as string[]) : [];
        // the lesson starts at the review on this task that the evidence names
        const ref = evidence.map((x) => /^(T-\d+)\/(r\d+)/.exec(x)).find((m) => m?.[1] === task);
        if (id && ref?.[2] && !skillFrom.has(id)) skillFrom.set(id, { task, run: ref[2] });
      } else if (e.type === 'approval.granted') {
        marks.push({ kind: 'approved', task, at: timeOf(e), text: 'approved and merged' });
      } else if (e.type === 'approval.rejected') {
        marks.push({ kind: 'rejected', task, at: timeOf(e), text: str(e.payload.reason) ?? 'rejected' });
      } else if (e.type === 'decision.recorded' && (e.payload.by === 'you' || e.vendor === 'human')) {
        marks.push({ kind: 'decided', task, at: timeOf(e), text: `${str(e.payload.id) ?? ''} ${str(e.payload.text) ?? ''}`.trim() });
      } else if (e.type === 'human.command' && typeof e.payload.queue === 'string') {
        marks.push({ kind: 'kept', task, at: timeOf(e), text: str(e.payload.text) ?? 'kept a decision' });
      }
    }
  }
  for (const { task, events } of byTask) {
    for (const e of events.filter((x) => x.type === 'skill.applied' && x.run)) {
      const skill = str(e.payload.skill);
      const from = skill ? skillFrom.get(skill) : undefined;
      if (skill && from && from.task !== task) links.push({ kind: 'skill', skill, fromTask: from.task, from: from.run, toTask: task, to: e.run as string, at: timeOf(e) });
    }
  }
  const times = [...runs.flatMap((r) => [r.start, r.end ?? r.start]), ...marks.map((m) => m.at)];
  // a lane's roles are its runs' roles, and a lane every run moved off is not drawn
  for (const l of lanes.values()) l.roles = [...new Set(runs.filter((r) => r.lane === l.id && r.role).map((r) => r.role as string))];
  const order = (l: RelayLane) => (l.roles.includes('planner') ? 0 : l.roles.includes('implementer') ? 1 : l.roles.includes('reviewer') ? 2 : 3);
  // within a role, lanes follow the order the agents first worked, so a relay reads from the top down
  const first = (l: RelayLane) => Math.min(...runs.filter((r) => r.lane === l.id).map((r) => r.start));
  const sorted = [...lanes.values()].filter((l) => runs.some((r) => r.lane === l.id)).sort((a, b) => order(a) - order(b) || first(a) - first(b) || a.id.localeCompare(b.id));
  if (marks.length) sorted.push({ id: 'you', adapter: null, model: null, host: null, roles: [], human: true });
  return { lanes: sorted, runs, links, marks, from: times.length ? Math.min(...times) : 0, to: times.length ? Math.max(...times) : 0, replay };
}
