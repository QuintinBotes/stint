// Risk tiers and the auto-approve lane (R-039). Every reviewed change gets a tier; every human decision is
// compared with what the policy would have done (shadow mode, always on); and the lane approves by policy only
// when a person turned it on and the shadow record for that tier is long and clean.
import type { StintEvent, Task } from '@stint-dev/core';
import type { DaemonContext } from './app';
import { isTestPath } from './acceptance';
import { type NumstatEntry, git } from './git';

export type Tier = 'low' | 'medium' | 'high';

/** Paths where a mistake costs the most: access, money, schema history, CI and the dependency lock. */
export const DEFAULT_HIGH_PATHS = [
  '**/auth/**',
  '**/*auth*.*',
  '**/security/**',
  '**/payments/**',
  '**/billing/**',
  '**/migrations/**',
  '**/*.sql',
  '.github/workflows/**',
  '.gitlab-ci.yml',
  '**/Dockerfile',
  '**/*.lock',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.stint/**',
];

/** Paths that are what other code calls: entry points, typings, schemas and API definitions. */
export const API_PATHS = ['**/index.ts', '**/index.js', '**/api/**', '**/*.d.ts', 'schemas/**', '**/openapi*'];

const BIG_CHANGE = 400;
const MANY_FILES = 5;
const DAY_MS = 86_400_000;
const MIN_SHADOW = 3;

const matches = (patterns: string[], path: string) => patterns.some((p) => new Bun.Glob(p).match(path));
const after = <T extends StintEvent>(events: T[], i: number) => events.slice(i + 1);

/** The latest verification and the reviews after it: what the gate is deciding on. */
function gateState(events: StintEvent[]): { green: boolean; verdict: string | null; securityFindings: number; tampered: boolean } {
  const vi = events.findLastIndex((e) => e.type === 'verification.ran');
  const since = vi >= 0 ? after(events, vi) : [];
  const reviews = since.filter((e) => e.type === 'review.recorded');
  const last = reviews.at(-1);
  return {
    green: vi >= 0 && events[vi]?.payload.status === 'green',
    verdict: (last?.payload.verdict as string | undefined) ?? null,
    securityFindings: reviews.filter((e) => e.payload.lens === 'security').reduce((n, e) => n + Number(e.payload.findings ?? 0), 0),
    tampered: events.some((e) => e.type === 'acceptance.tampered' || e.type === 'verification.tampered'),
  };
}

/** The tier of a task's change and every reason for it, from the diff and the reviews (requirement 1). */
export async function assessRisk(ctx: DaemonContext, id: string): Promise<{ tier: Tier; reasons: string[] }> {
  const task = await ctx.ws.readTask(id);
  const events = await ctx.ws.events(id).read();
  const files = ((await ctx.worktrees.diff(task, 'json').catch(() => [])) as NumstatEntry[]) ?? [];
  const deleted = (await git(ctx.ws.root, ['diff', '--name-only', '--diff-filter=D', `${task.baseCommit}..${task.branch}`])).stdout.split('\n').filter(Boolean);
  const high: string[] = [];
  const medium: string[] = [];
  const highPaths = ctx.ws.config.risk?.highPaths?.length ? ctx.ws.config.risk.highPaths : DEFAULT_HIGH_PATHS;
  const touchedHigh = files.map((f) => f.path).filter((p) => matches(highPaths, p));
  if (touchedHigh.length) high.push(`touches ${touchedHigh.slice(0, 3).join(', ')}${touchedHigh.length > 3 ? ` and ${touchedHigh.length - 3} more` : ''}`);
  const deletedTests = deleted.filter(isTestPath);
  if (deletedTests.length) high.push(`deletes tests: ${deletedTests.slice(0, 3).join(', ')}`);
  const testsShrunk = files.filter((f) => isTestPath(f.path) && f.removed > f.added && !deletedTests.includes(f.path));
  if (testsShrunk.length) high.push(`removes test lines in ${testsShrunk.map((f) => f.path).slice(0, 3).join(', ')}`);
  const lines = files.reduce((n, f) => n + f.added + f.removed, 0);
  if (lines > BIG_CHANGE) high.push(`${lines} changed lines, over ${BIG_CHANGE}`);
  const gate = gateState(events);
  if (gate.securityFindings > 0) high.push(`the security review found ${gate.securityFindings} thing${gate.securityFindings === 1 ? '' : 's'}`);
  if (gate.tampered) high.push('an agent changed the locked tests');
  if (files.length > MANY_FILES) medium.push(`${files.length} files, over ${MANY_FILES}`);
  const api = files.map((f) => f.path).filter((p) => matches(API_PATHS, p));
  if (api.length) medium.push(`changes what other code calls: ${api.slice(0, 3).join(', ')}`);
  const tier: Tier = high.length ? 'high' : medium.length ? 'medium' : 'low';
  const reasons = tier === 'high' ? high : tier === 'medium' ? medium : [`${files.length} file${files.length === 1 ? '' : 's'}, ${lines} lines, nothing sensitive`];
  return { tier, reasons };
}

/** Records the assessment on the task and its log. */
export async function recordRisk(ctx: DaemonContext, id: string): Promise<{ tier: Tier; reasons: string[] }> {
  const r = await assessRisk(ctx, id);
  await ctx.ws.writeTask(id, { risk: r.tier });
  await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'risk.assessed', payload: r });
  return r;
}

/** Whether the policy would approve this task now: tier allowed, tests green, every review approves, no tamper. */
export function policyWould(task: Task, events: StintEvent[], tiers: Tier[]): { would: boolean; why: string } {
  const tier = (events.findLast((e) => e.type === 'risk.assessed')?.payload.tier as Tier | undefined) ?? task.risk ?? null;
  const gate = gateState(events);
  if (!tier) return { would: false, why: 'no risk assessed' };
  if (!tiers.includes(tier)) return { would: false, why: `${tier} risk is not in the lane` };
  if (!gate.green) return { would: false, why: 'the tests are not green' };
  if (gate.verdict !== 'approve') return { would: false, why: `the review says ${gate.verdict ?? 'nothing'}` };
  if (gate.tampered) return { would: false, why: 'an agent changed the locked tests' };
  return { would: true, why: `${tier} risk, tests green, the review approves` };
}

const laneTiers = (ctx: DaemonContext): Tier[] => (ctx.ws.config.risk?.autoApprove.tiers ?? ['low']) as Tier[];

/** Shadow mode (requirement 2): what the policy would have done, beside what the person did. Always on. */
export async function recordShadow(ctx: DaemonContext, id: string, humanDecision: 'approved' | 'rejected'): Promise<void> {
  const task = await ctx.ws.readTask(id);
  const events = await ctx.ws.events(id).read();
  const tier = (events.findLast((e) => e.type === 'risk.assessed')?.payload.tier as Tier | undefined) ?? task.risk ?? null;
  if (!tier) return;
  const p = policyWould(task, events, laneTiers(ctx));
  await ctx.ws.events(id).append({ task: id, vendor: 'daemon', type: 'autoapprove.shadow', payload: { tier, wouldApprove: p.would, humanDecision, why: p.why } });
}

export type ShadowRecord = { tier: Tier; decisions: number; agreements: number; disagreements: number; revertsAfterWouldApprove: number; since: string | null; days: number };

/** The shadow record per tier across the workspace, within `days` days of now (or all of it). */
export async function shadowRecords(ctx: DaemonContext, now = new Date(), days?: number): Promise<ShadowRecord[]> {
  const from = days === undefined ? -Infinity : now.getTime() - days * DAY_MS;
  const rows = new Map<Tier, ShadowRecord>();
  for (const t of await ctx.ws.listTasks()) {
    const events = await ctx.ws.events(t.id).read();
    const reverted = events.some((e) => e.type === 'outcome.reverted');
    for (const e of events) {
      if (e.type !== 'autoapprove.shadow' || Date.parse(e.ts) < from) continue;
      const tier = e.payload.tier as Tier;
      const r = rows.get(tier) ?? { tier, decisions: 0, agreements: 0, disagreements: 0, revertsAfterWouldApprove: 0, since: null, days: 0 };
      r.decisions += 1;
      const agreed = !!e.payload.wouldApprove === (e.payload.humanDecision === 'approved');
      if (agreed) r.agreements += 1;
      else r.disagreements += 1;
      if (e.payload.wouldApprove && reverted) r.revertsAfterWouldApprove += 1;
      if (!r.since || e.ts < r.since) r.since = e.ts;
      r.days = Math.floor((now.getTime() - Date.parse(r.since)) / DAY_MS);
      rows.set(tier, r);
    }
  }
  return [...rows.values()].sort((a, b) => a.tier.localeCompare(b.tier));
}

/**
 * Whether the lane may approve a task of this tier (requirement 3): turned on by a person, the tier in the lane,
 * and a shadow record that covers `shadowDays` with at least three decisions, no disagreement and no revert.
 */
export async function laneOpen(ctx: DaemonContext, tier: Tier, now = new Date()): Promise<{ open: boolean; why: string }> {
  const cfg = ctx.ws.config.risk?.autoApprove;
  if (!cfg?.enabled) return { open: false, why: 'the auto-approve lane is off' };
  if (!(cfg.tiers as Tier[]).includes(tier)) return { open: false, why: `${tier} risk is not in the lane` };
  const all = (await shadowRecords(ctx, now)).find((r) => r.tier === tier);
  if (!all || all.decisions < MIN_SHADOW) return { open: false, why: `${all?.decisions ?? 0} shadow decisions on ${tier} risk, fewer than ${MIN_SHADOW}` };
  if (all.days < cfg.shadowDays) return { open: false, why: `the shadow record on ${tier} risk covers ${all.days} of ${cfg.shadowDays} days` };
  const window = (await shadowRecords(ctx, now, cfg.shadowDays)).find((r) => r.tier === tier);
  if (window?.disagreements) return { open: false, why: `${window.disagreements} shadow disagreement${window.disagreements === 1 ? '' : 's'} on ${tier} risk in the last ${cfg.shadowDays} days` };
  if (window?.revertsAfterWouldApprove) return { open: false, why: `a change the policy would have approved was reverted in the last ${cfg.shadowDays} days` };
  return { open: true, why: `${all.decisions} shadow decisions on ${tier} risk over ${all.days} days, all agreed, none reverted` };
}
