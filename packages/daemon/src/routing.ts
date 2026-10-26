// Learned routing (R-045): which implementer to send a task to, chosen from how each one has done on tasks like it.
// Thompson sampling: each agent's pass rate is a Beta posterior, one draw each, the highest draw wins. With
// probability `explore` the pick goes instead to the least-tried agent, so a new or unlucky one still gets work.
import { ALL_TAGS, type ScoreRow, scoreboard } from '@stint-dev/core/node';
import type { StintEvent, Task } from '@stint-dev/core';
import type { Workspace } from '@stint-dev/core/node';

export type Record = { passed: number; attempts: number };
export type Pick = { agent: string; score: number; explored: boolean; records: { [agent: string]: Record } };

/** A Beta(a, b) draw for whole a and b: the a-th of a + b - 1 uniform order statistics, as gamma sums. */
export function betaSample(a: number, b: number, rng: () => number): number {
  const gamma = (k: number) => {
    let s = 0;
    // shortcut: whole-number shapes only, capped; enough for counts of runs, not for fractional priors
    for (let i = 0; i < Math.min(k, 500); i++) s -= Math.log(1 - rng());
    return s;
  };
  const x = gamma(a);
  const y = gamma(b);
  return x / (x + y);
}

export function chooseLearned(candidates: string[], records: { [agent: string]: Record }, explore: number, rng: () => number): Pick {
  if (candidates.length === 0) throw new Error('no candidates to route to');
  const rec = (a: string) => records[a] ?? { passed: 0, attempts: 0 };
  if (rng() < explore) {
    const fewest = Math.min(...candidates.map((a) => rec(a).attempts));
    const least = candidates.filter((a) => rec(a).attempts === fewest);
    const agent = least[Math.floor(rng() * least.length)] as string;
    return { agent, score: (rec(agent).passed + 1) / (rec(agent).attempts + 2), explored: true, records };
  }
  let best = { agent: candidates[0] as string, score: -1 };
  for (const a of candidates) {
    const r = rec(a);
    const score = betaSample(1 + r.passed, 1 + (r.attempts - r.passed), rng);
    if (score > best.score) best = { agent: a, score };
  }
  return { ...best, explored: false, records };
}

/**
 * Each agent's record on tasks like this one: the rows for the task's tags when any agent has them, else
 * every task. Eval results (`eval.ran` events naming an agent) count as attempts too, so routing starts
 * from what the evals measured before any real task has run.
 */
export function recordsFor(task: Task, rows: ScoreRow[], evals: StintEvent[]): { [agent: string]: Record } {
  const tags = (task.tags ?? []).filter((t) => rows.some((r) => r.tag === t));
  const use = tags.length ? rows.filter((r) => tags.includes(r.tag)) : rows.filter((r) => r.tag === ALL_TAGS);
  const out: { [agent: string]: Record } = {};
  const add = (agent: string, passed: number, attempts: number) => {
    const r = (out[agent] ??= { passed: 0, attempts: 0 });
    r.passed += passed;
    r.attempts += attempts;
  };
  for (const r of use) add(r.agent, r.passed, r.attempts);
  for (const e of evals) {
    const agent = e.payload.agent;
    const passed = Number(e.payload.passed);
    const attempts = Number(e.payload.attempts ?? passed + Number(e.payload.failed ?? 0));
    if (typeof agent === 'string' && Number.isFinite(passed) && Number.isFinite(attempts) && attempts >= passed) add(agent, passed, attempts);
  }
  return out;
}

/** The scoreboard and eval events of a whole workspace. */
export async function workspaceRecords(ws: Workspace): Promise<{ rows: ScoreRow[]; evals: StintEvent[] }> {
  const all = [];
  const evals: StintEvent[] = [];
  for (const task of await ws.listTasks()) {
    const events = await ws.events(task.id).read();
    all.push({ task, events });
    evals.push(...events.filter((e) => e.type === 'eval.ran' && typeof e.payload.agent === 'string'));
  }
  return { rows: scoreboard(all), evals };
}
