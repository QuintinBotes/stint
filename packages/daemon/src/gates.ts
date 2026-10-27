import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonIfExists, type Workspace } from '@stint-dev/core/node';
import { STINT_BENCH, measuredHere } from './measured';

/** The part of bench/golden-results.json the phase gates read (written by `stint eval --golden`, R-046). */
export type GoldenSummary = { k: number; passAt1: number; passPowK: number; tasks: number; usd: number | null };

export type PhaseGates = {
  phase2: { met: boolean; passPowK: number | null; k: number | null; tamperEscapes: number; detail: string };
  phase3: { met: boolean; tier: string | null; shadowDays: number; reverts: number; detail: string };
  golden: GoldenSummary | null;
};

const asRecord = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** This repository's golden results, or Stint's when this is the demo fixture they were measured on, as for the bench. */
export async function readGoldenSummary(root: string): Promise<GoldenSummary | null> {
  const own = join(root, 'bench', 'golden-results.json');
  const path = existsSync(own) ? own : (await measuredHere(root)) ? join(STINT_BENCH, 'golden-results.json') : null;
  if (!path || !existsSync(path)) return null;
  const raw = asRecord(await readJsonIfExists<unknown>(path));
  if (!raw || raw.version !== 'stint.golden/1') return null;
  const k = asNum(raw.k);
  const passPowK = asNum(raw.passPowK);
  const passAt1 = asNum(raw.passAt1);
  if (k === null || passPowK === null || passAt1 === null) return null;
  const cost = asRecord(raw.cost);
  return {
    k,
    passAt1,
    passPowK,
    tasks: Array.isArray(raw.tasks) ? raw.tasks.length : (asNum(raw.taskCount) ?? 0),
    usd: cost ? asNum(cost.usd) : null,
  };
}

const DAY_MS = 86_400_000;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The factory phase gates (R-046): phase 2 opens when the golden set passes pass^3 at 80% or
 * better with no tamper escape (a tampered task that still merged); phase 3 opens when one
 * risk tier has been shadow-approved for two weeks with no reverts on that tier.
 */
export async function phaseGates(ws: Workspace): Promise<PhaseGates> {
  const golden = await readGoldenSummary(ws.root);
  let tamperEscapes = 0;
  const reverted = new Set<string>();
  const tiers = new Map<string, { times: number[]; tasks: Set<string>; wouldApprove: number }>();
  for (const task of await ws.listTasks()) {
    const events = await ws.events(task.id).read().catch(() => []);
    let tamperSeq = Number.POSITIVE_INFINITY;
    let escaped = false;
    for (const e of events) {
      if (e.type === 'acceptance.tampered' || e.type === 'verification.tampered') tamperSeq = Math.min(tamperSeq, e.seq);
      if (e.type === 'merge.completed' && e.seq > tamperSeq) escaped = true;
      if (e.type === 'outcome.reverted') reverted.add(task.id);
      if (e.type === 'autoapprove.shadow') {
        const tier = typeof e.payload.tier === 'string' ? e.payload.tier : null;
        if (!tier) continue;
        const row = tiers.get(tier) ?? { times: [], tasks: new Set<string>(), wouldApprove: 0 };
        const at = Date.parse(e.ts);
        if (!Number.isNaN(at)) row.times.push(at);
        row.tasks.add(task.id);
        if (e.payload.wouldApprove === true) row.wouldApprove += 1;
        tiers.set(tier, row);
      }
    }
    if (escaped) tamperEscapes += 1;
  }

  const phase2Met = Boolean(golden && golden.k >= 3 && golden.passPowK >= 0.8 && tamperEscapes === 0);
  const phase2Detail = !golden
    ? 'No golden results yet. Run stint eval --golden --k 3.'
    : phase2Met
      ? `Golden pass^${golden.k} is ${pct(golden.passPowK)} over ${golden.tasks} tasks, with no tamper escapes.`
      : `Golden pass^${golden.k} is ${pct(golden.passPowK)} (the gate needs 80% at k 3 or more), with ${tamperEscapes} tamper escape${tamperEscapes === 1 ? '' : 's'}.`;

  let best: { tier: string; shadowDays: number; reverts: number; wouldApprove: number } | null = null;
  const tasks = await ws.listTasks();
  for (const [tier, row] of tiers) {
    row.times.sort((a, b) => a - b);
    const shadowDays = row.times.length > 1 ? Math.round((((row.times.at(-1) as number) - (row.times[0] as number)) / DAY_MS) * 10) / 10 : 0;
    const tierTasks = new Set([...row.tasks, ...tasks.filter((t) => t.risk === tier).map((t) => t.id)]);
    const reverts = [...tierTasks].filter((id) => reverted.has(id)).length;
    const candidate = { tier, shadowDays, reverts, wouldApprove: row.wouldApprove };
    if (!best || candidate.shadowDays > best.shadowDays) best = candidate;
  }
  const phase3Met = Boolean(best && best.shadowDays >= 14 && best.reverts === 0 && best.wouldApprove > 0);
  const phase3Detail = !best
    ? 'No shadow approvals recorded yet.'
    : phase3Met
      ? `Tier ${best.tier} has been shadow-approved for ${best.shadowDays} days with no reverts.`
      : `Tier ${best.tier}: ${best.shadowDays} shadow days (the gate needs 14), ${best.reverts} revert${best.reverts === 1 ? '' : 's'}.`;

  return {
    phase2: { met: phase2Met, passPowK: golden?.passPowK ?? null, k: golden?.k ?? null, tamperEscapes, detail: phase2Detail },
    phase3: { met: phase3Met, tier: best?.tier ?? null, shadowDays: best?.shadowDays ?? 0, reverts: best?.reverts ?? 0, detail: phase3Detail },
    golden,
  };
}
