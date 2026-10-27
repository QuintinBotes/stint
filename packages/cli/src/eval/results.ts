import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Task } from '@stint-dev/core';
import { type SkillEvalSide, formatSkillEvalCard } from '@stint-dev/daemon';

/** One eval task: a workspace task reduced to what a fresh run needs. */
export type EvalTaskDef = {
  /** The workspace task id, or the golden task name. */
  id: string;
  title: string;
  goal: string;
  acceptance: string[];
  testCommand: string;
  /** Carried so a tagged skill mounts on the eval task the way it mounted on the real one. */
  tags?: string[];
  heldOut?: boolean;
};

/** A row.json artefact of one skill eval run: one task, with the skill or without it. */
export type SkillEvalRow = {
  task: string;
  heldOut?: boolean;
  withSkill: boolean;
  /** Findings from the review of this run; null when no review ran (the verification was red). */
  findings: number | null;
  passed: number;
  failed: number;
  verified: boolean;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number | null;
  synthetic?: true;
  implementer?: string;
  model?: string;
  host?: string;
};

export type SkillEvalFile = {
  version: 'stint.skillEval/1';
  id: string;
  replay: boolean;
  synthetic?: true;
  tasks: string[];
  heldOut: string | null;
  with: SkillEvalSide;
  without: SkillEvalSide;
  card: string;
  rows: SkillEvalRow[];
  createdAt: string;
};

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

function sideOf(rows: SkillEvalRow[]): SkillEvalSide {
  const priced = rows.filter((r) => r.usd !== null);
  return {
    runs: rows.length,
    findings: rows.reduce((s, r) => s + (r.findings ?? 0), 0),
    passed: rows.reduce((s, r) => s + r.passed, 0),
    failed: rows.reduce((s, r) => s + r.failed, 0),
    verified: rows.filter((r) => r.verified).length,
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    cachedTokens: rows.reduce((s, r) => s + r.cachedTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    usd: priced.length ? round(priced.reduce((s, r) => s + (r.usd as number), 0), 6) : null,
  };
}

export function buildSkillEval(input: { id: string; rows: SkillEvalRow[]; replay: boolean; tasks?: string[]; heldOut?: string | null; createdAt?: string }): SkillEvalFile {
  const rows = [...input.rows].sort((a, b) => a.task.localeCompare(b.task) || Number(b.withSkill) - Number(a.withSkill));
  const withSide = sideOf(rows.filter((r) => r.withSkill));
  const withoutSide = sideOf(rows.filter((r) => !r.withSkill));
  const taskIds: string[] = [];
  for (const r of rows) if (!taskIds.includes(r.task)) taskIds.push(r.task);
  return {
    version: 'stint.skillEval/1',
    id: input.id,
    replay: input.replay,
    ...(rows.some((r) => r.synthetic) ? { synthetic: true as const } : {}),
    tasks: input.tasks ?? taskIds,
    heldOut: input.heldOut ?? rows.find((r) => r.heldOut)?.task ?? null,
    with: withSide,
    without: withoutSide,
    card: formatSkillEvalCard(withSide, withoutSide),
    rows,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * The tasks a skill is judged on: its evidence tasks, plus one held-out task, the most recent
 * other task sharing a tag with the skill (or with an evidence task when the skill has none).
 * A requested list replaces both.
 */
export function resolveSkillEvalTasks(input: { evidence: string[]; tags: string[]; tasks: Task[]; requested?: string[] }): { defs: EvalTaskDef[]; heldOut: string | null } {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const defOf = (t: Task, heldOut = false): EvalTaskDef => ({ id: t.id, title: t.title, goal: t.goal, acceptance: t.acceptance, testCommand: t.testCommand, ...(t.tags ? { tags: t.tags } : {}), ...(heldOut ? { heldOut: true } : {}) });
  if (input.requested && input.requested.length > 0) {
    const defs: EvalTaskDef[] = [];
    for (const id of input.requested) {
      const t = byId.get(id);
      if (!t) throw new Error(`no task ${id} in this workspace`);
      defs.push(defOf(t));
    }
    return { defs, heldOut: null };
  }
  const evidenceIds: string[] = [];
  for (const ref of input.evidence) {
    const id = ref.split('/')[0] as string;
    if (byId.has(id) && !evidenceIds.includes(id)) evidenceIds.push(id);
  }
  const defs = evidenceIds.map((id) => defOf(byId.get(id) as Task));
  const tagPool = new Set(input.tags.length > 0 ? input.tags : evidenceIds.flatMap((id) => byId.get(id)?.tags ?? []));
  const held = input.tasks
    .filter((t) => !evidenceIds.includes(t.id) && (t.tags ?? []).some((tag) => tagPool.has(tag)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (held) defs.push(defOf(held, true));
  return { defs, heldOut: held?.id ?? null };
}

/**
 * The tasks an imported skill with no evidence is judged on (R-060): up to three most similar
 * tasks, narrowed to tasks that share a tag when the skill carries tags.
 */
export function pickSimilarEvalTasks(rows: Array<{ task: string }>, tasks: Task[], tags: string[]): EvalTaskDef[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const picked = rows
    .map((r) => byId.get(r.task))
    .filter((t): t is Task => Boolean(t))
    .filter((t) => tags.length === 0 || (t.tags ?? []).some((tag) => tags.includes(tag)))
    .slice(0, 3);
  return picked.map((t) => ({ id: t.id, title: t.title, goal: t.goal, acceptance: t.acceptance, testCommand: t.testCommand, ...(t.tags ? { tags: t.tags } : {}) }));
}

function checkedSkillRow(raw: unknown, path: string): SkillEvalRow {
  const r = raw as Record<string, unknown>;
  const bad = (field: string) => new Error(`${path}: row.json field ${field} is missing or not valid`);
  if (typeof r.task !== 'string' || !r.task) throw bad('task');
  if (typeof r.withSkill !== 'boolean') throw bad('withSkill');
  if (r.findings !== null && typeof r.findings !== 'number') throw bad('findings');
  for (const f of ['passed', 'failed', 'inputTokens', 'cachedTokens', 'outputTokens'] as const) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)) throw bad(f);
  }
  if (typeof r.verified !== 'boolean') throw bad('verified');
  if (r.usd !== null && typeof r.usd !== 'number') throw bad('usd');
  return {
    task: r.task,
    ...(r.heldOut === true ? { heldOut: true as const } : {}),
    withSkill: r.withSkill,
    findings: r.findings as number | null,
    passed: r.passed as number,
    failed: r.failed as number,
    verified: r.verified,
    inputTokens: r.inputTokens as number,
    cachedTokens: r.cachedTokens as number,
    outputTokens: r.outputTokens as number,
    usd: r.usd as number | null,
    ...(r.synthetic ? { synthetic: true as const } : {}),
    ...(typeof r.implementer === 'string' ? { implementer: r.implementer } : {}),
    ...(typeof r.model === 'string' ? { model: r.model } : {}),
    ...(typeof r.host === 'string' ? { host: r.host } : {}),
  };
}

async function loadRows<T>(fromDir: string, check: (raw: unknown, path: string) => T, what: string): Promise<T[]> {
  if (!existsSync(fromDir)) throw new Error(`no recorded ${what} runs at ${fromDir}: run the eval live first, or pass --from <dir>`);
  const dirs = (await readdir(fromDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const rows: T[] = [];
  for (const name of dirs) {
    const rowPath = join(fromDir, name, 'row.json');
    if (!existsSync(rowPath)) continue;
    try {
      rows.push(check(JSON.parse(await readFile(rowPath, 'utf8')), rowPath));
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error(`${rowPath} is not valid JSON`);
      throw err;
    }
  }
  if (!rows.length) throw new Error(`no recorded ${what} rows in ${fromDir}`);
  return rows;
}

/** Rebuilds a skill eval from recorded runs (`.stint/evals/<skill>/runs/<task>-with|without>/row.json`), with no model call. */
export async function loadSkillReplay(id: string, fromDir: string): Promise<SkillEvalFile> {
  const rows = await loadRows(fromDir, checkedSkillRow, 'skill eval');
  return buildSkillEval({ id, rows, replay: true });
}

/** A golden task file, `bench/golden/<name>.json`: a task that must keep passing, graded by the daemon plus scenarios. */
export type GoldenTask = {
  name: string;
  title: string;
  goal: string;
  acceptance: string[];
  testCommand: string;
  fixtureCommit?: string;
  scenarios?: Array<{ name: string; command: string }>;
};

export async function loadGoldenTasks(dir: string): Promise<GoldenTask[]> {
  if (!existsSync(dir)) throw new Error(`no golden tasks at ${dir}: add one with stint eval add-golden <task>`);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  if (!names.length) throw new Error(`no golden tasks at ${dir}: add one with stint eval add-golden <task>`);
  const out: GoldenTask[] = [];
  for (const file of names) {
    const path = join(dir, file);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new Error(`${path} is not valid JSON`);
    }
    const bad = (field: string) => new Error(`${path}: ${field} is missing or not valid`);
    if (typeof raw.title !== 'string' || !raw.title) throw bad('title');
    if (typeof raw.goal !== 'string' || !raw.goal) throw bad('goal');
    if (!Array.isArray(raw.acceptance) || raw.acceptance.length === 0 || raw.acceptance.some((a) => typeof a !== 'string' || !a)) throw bad('acceptance');
    if (typeof raw.testCommand !== 'string' || !raw.testCommand) throw bad('testCommand');
    if (raw.fixtureCommit !== undefined && typeof raw.fixtureCommit !== 'string') throw bad('fixtureCommit');
    let scenarios: GoldenTask['scenarios'];
    if (raw.scenarios !== undefined) {
      if (!Array.isArray(raw.scenarios)) throw bad('scenarios');
      scenarios = raw.scenarios.map((s) => {
        const sc = s as Record<string, unknown>;
        if (typeof sc.name !== 'string' || !sc.name || typeof sc.command !== 'string' || !sc.command) throw bad('scenarios');
        return { name: sc.name, command: sc.command };
      });
    }
    out.push({
      name: basename(file, '.json'),
      title: raw.title,
      goal: raw.goal,
      acceptance: raw.acceptance as string[],
      testCommand: raw.testCommand,
      ...(typeof raw.fixtureCommit === 'string' ? { fixtureCommit: raw.fixtureCommit } : {}),
      ...(scenarios ? { scenarios } : {}),
    });
  }
  return out;
}

/** A row.json artefact of one golden run: one task, one of its k tries. */
export type GoldenRow = {
  task: string;
  run: number;
  passed: boolean;
  verified: boolean;
  passedTests: number;
  failedTests: number;
  scenarios: Array<{ name: string; passed: boolean }>;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number | null;
  synthetic?: true;
  implementer?: string;
  model?: string;
  host?: string;
};

export type GoldenResults = {
  version: 'stint.golden/1';
  replay: boolean;
  synthetic?: true;
  k: number;
  passAt1: number;
  passPowK: number;
  cost: { usd: number | null; inputTokens: number; cachedTokens: number; outputTokens: number };
  tasks: Array<{ name: string; title: string; passedRuns: number; runs: GoldenRow[]; passAll: boolean }>;
  createdAt: string;
};

/** pass@1 is the share of tries that pass; pass^k is the share of tasks where every try passes. */
export function buildGoldenResults(input: { rows: GoldenRow[]; k: number; replay: boolean; titles?: Map<string, string>; createdAt?: string }): GoldenResults {
  const rows = [...input.rows].sort((a, b) => a.task.localeCompare(b.task) || a.run - b.run);
  const names: string[] = [];
  for (const r of rows) if (!names.includes(r.task)) names.push(r.task);
  const tasks = names.map((name) => {
    const runs = rows.filter((r) => r.task === name);
    return { name, title: input.titles?.get(name) ?? name, passedRuns: runs.filter((r) => r.passed).length, runs, passAll: runs.length > 0 && runs.every((r) => r.passed) };
  });
  const priced = rows.filter((r) => r.usd !== null);
  return {
    version: 'stint.golden/1',
    replay: input.replay,
    ...(rows.some((r) => r.synthetic) ? { synthetic: true as const } : {}),
    k: input.k,
    passAt1: rows.length ? round(rows.filter((r) => r.passed).length / rows.length, 4) : 0,
    passPowK: tasks.length ? round(tasks.filter((t) => t.passAll).length / tasks.length, 4) : 0,
    cost: {
      usd: priced.length ? round(priced.reduce((s, r) => s + (r.usd as number), 0), 6) : null,
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      cachedTokens: rows.reduce((s, r) => s + r.cachedTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    },
    tasks,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function checkedGoldenRow(raw: unknown, path: string): GoldenRow {
  const r = raw as Record<string, unknown>;
  const bad = (field: string) => new Error(`${path}: row.json field ${field} is missing or not valid`);
  if (typeof r.task !== 'string' || !r.task) throw bad('task');
  if (typeof r.run !== 'number' || !Number.isInteger(r.run) || r.run < 1) throw bad('run');
  if (typeof r.passed !== 'boolean') throw bad('passed');
  if (typeof r.verified !== 'boolean') throw bad('verified');
  for (const f of ['passedTests', 'failedTests', 'inputTokens', 'cachedTokens', 'outputTokens'] as const) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)) throw bad(f);
  }
  if (r.usd !== null && typeof r.usd !== 'number') throw bad('usd');
  const scenarios = (Array.isArray(r.scenarios) ? r.scenarios : []).map((s) => {
    const sc = s as Record<string, unknown>;
    if (typeof sc.name !== 'string' || typeof sc.passed !== 'boolean') throw bad('scenarios');
    return { name: sc.name, passed: sc.passed };
  });
  return {
    task: r.task,
    run: r.run,
    passed: r.passed,
    verified: r.verified,
    passedTests: r.passedTests as number,
    failedTests: r.failedTests as number,
    scenarios,
    inputTokens: r.inputTokens as number,
    cachedTokens: r.cachedTokens as number,
    outputTokens: r.outputTokens as number,
    usd: r.usd as number | null,
    ...(r.synthetic ? { synthetic: true as const } : {}),
    ...(typeof r.implementer === 'string' ? { implementer: r.implementer } : {}),
    ...(typeof r.model === 'string' ? { model: r.model } : {}),
    ...(typeof r.host === 'string' ? { host: r.host } : {}),
  };
}

/** Rebuilds golden results from recorded runs (`bench/golden-runs/<task>-r<n>/row.json`), with no model call. */
export async function loadGoldenReplay(fromDir: string, k: number, titles?: Map<string, string>): Promise<GoldenResults> {
  const rows = (await loadRows(fromDir, checkedGoldenRow, 'golden')).filter((r) => r.run <= k);
  if (!rows.length) throw new Error(`no recorded golden rows in ${fromDir} for k ${k}`);
  return buildGoldenResults({ rows, k, replay: true, ...(titles ? { titles } : {}) });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number | null) => (n === null ? 'unpriced' : `$${n.toFixed(4)}`);

export function formatSkillSummary(evalFile: SkillEvalFile): string[] {
  const kind = [evalFile.replay ? 'replay' : 'live', evalFile.synthetic ? 'synthetic' : null].filter(Boolean).join(', ');
  return [
    `Skill eval for ${evalFile.id} (${kind}): ${evalFile.rows.length} runs over ${evalFile.tasks.length} tasks${evalFile.heldOut ? `, held out ${evalFile.heldOut}` : ''}`,
    `Tasks used: ${evalFile.tasks.join(', ') || 'none'}`,
    evalFile.card,
  ];
}

export function formatGoldenSummary(results: GoldenResults): string[] {
  const kind = [results.replay ? 'replay' : 'live', results.synthetic ? 'synthetic' : null].filter(Boolean).join(', ');
  const lines = [
    `Golden results (${kind}): ${results.tasks.length} tasks, k ${results.k}, pass@1 ${pct(results.passAt1)}, pass^${results.k} ${pct(results.passPowK)}, cost ${money(results.cost.usd)}`,
  ];
  for (const t of results.tasks) lines.push(`${t.name.padEnd(28)} ${t.passedRuns}/${t.runs.length} passed${t.passAll ? ' (every try)' : ''}`);
  return lines;
}

export async function writeGoldenResults(benchDir: string, results: GoldenResults): Promise<string> {
  await mkdir(benchDir, { recursive: true });
  const path = join(benchDir, 'golden-results.json');
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`);
  return path;
}
