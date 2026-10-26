// Learned routing (R-045): which implementer to send a task to, chosen from how each one has done on tasks like it.
// Thompson sampling: each agent's pass rate is a Beta posterior, one draw each, the highest draw wins. With
// probability `explore` the pick goes instead to the least-tried agent, so a new or unlucky one still gets work.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StintEvent, Task } from '@stint-dev/core';
import { ALL_TAGS, type ScoreRow, type Workspace, scoreboard } from '@stint-dev/core/node';

export type Record = { passed: number; attempts: number };
/** What an eval measured for an agent before or beside real tasks. */
export type Prior = { agent: string; passed: number; attempts: number };
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
 * every task. Eval results count as attempts too, so routing starts from what the evals measured before
 * any real task has run.
 */
export function recordsFor(task: Task, rows: ScoreRow[], priors: Prior[]): { [agent: string]: Record } {
  const tags = (task.tags ?? []).filter((t) => rows.some((r) => r.tag === t));
  const use = tags.length ? rows.filter((r) => tags.includes(r.tag)) : rows.filter((r) => r.tag === ALL_TAGS);
  const out: { [agent: string]: Record } = {};
  const add = (agent: string, passed: number, attempts: number) => {
    const r = (out[agent] ??= { passed: 0, attempts: 0 });
    r.passed += passed;
    r.attempts += attempts;
  };
  for (const r of use) add(r.agent, r.passed, r.attempts);
  for (const p of priors) add(p.agent, p.passed, p.attempts);
  return out;
}

/** An `eval.ran` event that names an agent, as a prior. */
function priorOf(e: StintEvent): Prior | null {
  const passed = Number(e.payload.passed);
  const attempts = Number(e.payload.attempts ?? passed + Number(e.payload.failed ?? 0));
  if (typeof e.payload.agent !== 'string' || !Number.isFinite(passed) || !Number.isFinite(attempts) || attempts < passed) return null;
  return { agent: e.payload.agent, passed, attempts };
}

/** Each try of the golden set (R-046) by the implementer it ran; a synthetic set teaches routing nothing. */
export function goldenPriors(root: string): Prior[] {
  const path = join(root, 'bench', 'golden-results.json');
  if (!existsSync(path)) return [];
  try {
    const g = JSON.parse(readFileSync(path, 'utf8')) as { synthetic?: boolean; tasks?: Array<{ runs?: Array<{ implementer?: string; passed?: boolean; synthetic?: boolean }> }> };
    if (g.synthetic) return [];
    return (g.tasks ?? []).flatMap((t) => (t.runs ?? []).filter((r) => typeof r.implementer === 'string' && !r.synthetic).map((r) => ({ agent: r.implementer as string, passed: r.passed ? 1 : 0, attempts: 1 })));
  } catch {
    return [];
  }
}

/** The scoreboard of a whole workspace, and the eval results routing starts from. */
export async function workspaceRecords(ws: Workspace): Promise<{ rows: ScoreRow[]; priors: Prior[] }> {
  const all = [];
  const priors: Prior[] = goldenPriors(ws.root);
  for (const task of await ws.listTasks()) {
    const events = await ws.events(task.id).read();
    all.push({ task, events });
    for (const e of events) if (e.type === 'eval.ran') {
      const p = priorOf(e);
      if (p) priors.push(p);
    }
  }
  return { rows: scoreboard(all), priors };
}
