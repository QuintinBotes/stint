import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokens } from '@stint-dev/core';

export type BenchMode = 'transcript' | 'packet';
export const BENCH_MODES: BenchMode[] = ['transcript', 'packet'];

/** The legs a bench run can measure (R-055): plan, build (the continuing runs), review and learn. */
export type BenchLeg = 'plan' | 'build' | 'review' | 'learn';
export const BENCH_LEGS: BenchLeg[] = ['plan', 'build', 'review', 'learn'];

export type BenchTaskDef = {
  id?: string;
  title: string;
  goal: string;
  acceptance: string[];
  testCommand: string;
  killAfterSteps: number;
};

/** The stable name of a bench task in rows and artefact folders. */
export function taskKey(t: BenchTaskDef): string {
  if (t.id) return t.id;
  const slug = t.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'task';
}

/** Reads and checks bench/tasks.json; a bad file is an error with the field named, not a crash later. */
export async function loadBenchTasks(path: string): Promise<BenchTaskDef[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read bench tasks at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const list = (raw as { tasks?: unknown }).tasks ?? raw;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${path} must hold a non-empty list of tasks`);
  return list.map((item, i) => {
    const t = item as Record<string, unknown>;
    const bad = (field: string) => new Error(`${path} task ${i + 1}: ${field} is missing or not valid`);
    if (typeof t.title !== 'string' || !t.title) throw bad('title');
    if (typeof t.goal !== 'string' || !t.goal) throw bad('goal');
    if (!Array.isArray(t.acceptance) || t.acceptance.length === 0 || t.acceptance.some((a) => typeof a !== 'string' || !a)) throw bad('acceptance');
    if (typeof t.testCommand !== 'string' || !t.testCommand) throw bad('testCommand');
    if (typeof t.killAfterSteps !== 'number' || !Number.isInteger(t.killAfterSteps) || t.killAfterSteps < 1) throw bad('killAfterSteps');
    if (t.id !== undefined && (typeof t.id !== 'string' || !t.id)) throw bad('id');
    return {
      ...(typeof t.id === 'string' ? { id: t.id } : {}),
      title: t.title,
      goal: t.goal,
      acceptance: t.acceptance as string[],
      testCommand: t.testCommand,
      killAfterSteps: t.killAfterSteps,
    };
  });
}

export type BenchRow = {
  task: string;
  mode: BenchMode;
  /** The leg this row measures; rows recorded before legs existed are the build leg. */
  leg: BenchLeg;
  /** What the leg did, in a few words: the plan's step count, the review verdict, the proposed skill. */
  result: string;
  host: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number | null;
  wallMs: number;
  verified: boolean;
  promptTokens: number;
  repeat: number;
  synthetic?: true;
};

/** A row artefact (row.json, or row-<leg>.json): the row plus the facts a replay needs to rebuild the top level. */
export type BenchRowFile = Omit<BenchRow, 'leg' | 'result'> & {
  leg?: BenchLeg;
  result?: string;
  commit?: string;
  implementer?: string;
  continuer?: string;
  implementerModel?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type ModeSummary = { runs: number; meanInputTokens: number; meanPromptTokens: number; meanUsd: number | null; passRate: number };

/** One leg summed the same way as a mode; pass means the leg did its work (for build, a green verification). */
export type LegSummary = ModeSummary;

export type BenchResults = {
  version: 'stint.bench/1';
  replay: boolean;
  synthetic?: true;
  commit: string;
  startedAt: string;
  finishedAt: string;
  implementer: string;
  continuer: string;
  models: Record<string, string>;
  rows: BenchRow[];
  byMode: Partial<Record<BenchMode, ModeSummary>>;
  byLeg: Partial<Record<BenchLeg, LegSummary>>;
  ratio: number | null;
};

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const mean = (ns: number[]) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

function stripRow(r: BenchRowFile): BenchRow {
  const leg = r.leg ?? 'build';
  return {
    task: r.task,
    mode: r.mode,
    leg,
    result: r.result ?? (leg === 'build' ? (r.verified ? 'verified by the daemon' : 'not verified by the daemon') : r.verified ? 'done' : 'not done'),
    host: r.host,
    model: r.model,
    inputTokens: r.inputTokens,
    cachedTokens: r.cachedTokens,
    outputTokens: r.outputTokens,
    usd: r.usd,
    wallMs: r.wallMs,
    verified: r.verified,
    promptTokens: r.promptTokens,
    repeat: r.repeat ?? 1,
    ...(r.synthetic ? { synthetic: true as const } : {}),
  };
}

export function buildResults(input: {
  rows: BenchRowFile[];
  replay: boolean;
  commit?: string;
  startedAt?: string;
  finishedAt?: string;
  implementer?: string;
  continuer?: string;
}): BenchResults {
  const rows = input.rows.map(stripRow);
  const summarise = (inGroup: BenchRow[]): ModeSummary => {
    const priced = inGroup.filter((r) => r.usd !== null);
    return {
      runs: inGroup.length,
      meanInputTokens: round(mean(inGroup.map((r) => r.inputTokens)), 1),
      meanPromptTokens: round(mean(inGroup.map((r) => r.promptTokens)), 1),
      meanUsd: priced.length ? round(mean(priced.map((r) => r.usd as number)), 6) : null,
      passRate: round(inGroup.filter((r) => r.verified).length / inGroup.length, 3),
    };
  };
  // byMode is the continuing runs only, as it always was: the other legs have no mode of their own
  const byMode: Partial<Record<BenchMode, ModeSummary>> = {};
  for (const mode of BENCH_MODES) {
    const inMode = rows.filter((r) => r.leg === 'build' && r.mode === mode);
    if (inMode.length) byMode[mode] = summarise(inMode);
  }
  const byLeg: Partial<Record<BenchLeg, LegSummary>> = {};
  for (const leg of BENCH_LEGS) {
    const inLeg = rows.filter((r) => r.leg === leg);
    if (inLeg.length) byLeg[leg] = summarise(inLeg);
  }
  const transcriptMean = byMode.transcript?.meanInputTokens;
  const packetMean = byMode.packet?.meanInputTokens;
  const implementer = input.implementer ?? input.rows.find((r) => r.implementer)?.implementer ?? 'muse-code';
  const continuer = input.continuer ?? input.rows.find((r) => r.continuer)?.continuer ?? 'stint-agent';
  const models: Record<string, string> = {};
  const implementerModel = input.rows.find((r) => r.implementerModel)?.implementerModel;
  if (implementerModel) models[implementer] = implementerModel;
  const continuerModel = rows.find((r) => r.leg === 'build' && r.model)?.model ?? rows.find((r) => r.model)?.model;
  if (continuerModel) models[continuer] = continuerModel;
  const starts = input.rows.map((r) => r.startedAt).filter((s): s is string => Boolean(s)).sort();
  const ends = input.rows.map((r) => r.finishedAt).filter((s): s is string => Boolean(s)).sort();
  const now = new Date().toISOString();
  return {
    version: 'stint.bench/1',
    replay: input.replay,
    ...(rows.some((r) => r.synthetic) ? { synthetic: true as const } : {}),
    commit: input.commit ?? input.rows.find((r) => r.commit)?.commit ?? 'unknown',
    startedAt: input.startedAt ?? starts[0] ?? now,
    finishedAt: input.finishedAt ?? ends.at(-1) ?? now,
    implementer,
    continuer,
    models,
    rows,
    byMode,
    byLeg,
    ratio: transcriptMean !== undefined && packetMean ? round(transcriptMean / packetMean, 3) : null,
  };
}

function checkedRowFile(raw: unknown, path: string): BenchRowFile {
  const r = raw as Record<string, unknown>;
  const bad = (field: string) => new Error(`${path}: row.json field ${field} is missing or not valid`);
  if (typeof r.task !== 'string' || !r.task) throw bad('task');
  if (r.mode !== 'transcript' && r.mode !== 'packet') throw bad('mode');
  for (const f of ['inputTokens', 'cachedTokens', 'outputTokens', 'wallMs', 'promptTokens'] as const) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f] as number)) throw bad(f);
  }
  if (typeof r.verified !== 'boolean') throw bad('verified');
  if (r.usd !== null && typeof r.usd !== 'number') throw bad('usd');
  if (r.leg !== undefined && !BENCH_LEGS.includes(r.leg as BenchLeg)) throw bad('leg');
  return {
    task: r.task,
    mode: r.mode,
    ...(r.leg !== undefined ? { leg: r.leg as BenchLeg } : {}),
    ...(typeof r.result === 'string' ? { result: r.result } : {}),
    host: typeof r.host === 'string' ? r.host : 'unknown',
    model: typeof r.model === 'string' ? r.model : 'unknown',
    inputTokens: r.inputTokens as number,
    cachedTokens: r.cachedTokens as number,
    outputTokens: r.outputTokens as number,
    usd: r.usd as number | null,
    wallMs: r.wallMs as number,
    verified: r.verified,
    promptTokens: r.promptTokens as number,
    repeat: typeof r.repeat === 'number' ? r.repeat : 1,
    ...(r.synthetic ? { synthetic: true as const } : {}),
    ...(typeof r.commit === 'string' ? { commit: r.commit } : {}),
    ...(typeof r.implementer === 'string' ? { implementer: r.implementer } : {}),
    ...(typeof r.continuer === 'string' ? { continuer: r.continuer } : {}),
    ...(typeof r.implementerModel === 'string' ? { implementerModel: r.implementerModel } : {}),
    ...(typeof r.startedAt === 'string' ? { startedAt: r.startedAt } : {}),
    ...(typeof r.finishedAt === 'string' ? { finishedAt: r.finishedAt } : {}),
  };
}

/**
 * Rebuilds the results from recorded artefacts (bench/runs/<task>-<mode>/), with no model call.
 * Each folder holds the build row in row.json and the other legs in row-<leg>.json, each kept
 * with its cost and result; a folder's rows are kept only for the modes, legs and host asked for.
 * Prompt tokens are recounted from each continuer prompt.md, so the numbers come from the artefacts.
 */
export async function loadReplayResults(fromDir: string, opts: { tasks?: number; modes?: BenchMode[]; legs?: BenchLeg[]; host?: string } = {}): Promise<BenchResults> {
  if (!existsSync(fromDir)) throw new Error(`no recorded bench runs at ${fromDir}: run stint bench first, or pass --from <dir>`);
  const modes = opts.modes ?? BENCH_MODES;
  const legs = opts.legs ?? BENCH_LEGS;
  const dirs = (await readdir(fromDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const found: BenchRowFile[] = [];
  for (const name of dirs) {
    const dir = join(fromDir, name);
    const names = (await readdir(dir)).filter((f) => /^row(-[a-z]+)?\.json$/.test(f)).sort();
    for (const file of names) {
      const rowPath = join(dir, file);
      let row: BenchRowFile;
      try {
        row = checkedRowFile(JSON.parse(await readFile(rowPath, 'utf8')), rowPath);
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(`${rowPath} is not valid JSON`);
        throw err;
      }
      const promptPath = join(dir, 'prompt.md');
      if (file === 'row.json' && existsSync(promptPath)) row.promptTokens = countTokens(await readFile(promptPath, 'utf8'));
      found.push(row);
    }
  }
  const picked = found.filter((r) => modes.includes(r.mode) && legs.includes(r.leg ?? 'build') && (!opts.host || r.host === opts.host));
  const taskOrder: string[] = [];
  for (const r of picked) if (!taskOrder.includes(r.task)) taskOrder.push(r.task);
  const keptTasks = opts.tasks ? taskOrder.slice(0, opts.tasks) : taskOrder;
  const rows = picked
    .filter((r) => keptTasks.includes(r.task))
    .sort(
      (a, b) =>
        keptTasks.indexOf(a.task) - keptTasks.indexOf(b.task) ||
        BENCH_MODES.indexOf(a.mode) - BENCH_MODES.indexOf(b.mode) ||
        BENCH_LEGS.indexOf(a.leg ?? 'build') - BENCH_LEGS.indexOf(b.leg ?? 'build') ||
        a.repeat - b.repeat,
    );
  if (!rows.length) throw new Error(`no recorded bench rows in ${fromDir} for modes ${modes.join(',')}, legs ${legs.join(',')}${opts.host ? ` on host ${opts.host}` : ''}`);
  return buildResults({ rows, replay: true });
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number | null) => (n === null ? 'unpriced' : `$${n.toFixed(4)}`);

/** The one-screen summary lines. */
export function formatSummary(results: BenchResults): string[] {
  const kind = [results.replay ? 'replay' : 'live', results.synthetic ? 'synthetic' : null].filter(Boolean).join(', ');
  const continued = results.rows.filter((r) => r.leg === 'build').length;
  const lines = [`Bench results (${kind}): ${continued || results.rows.length} continued runs, implementer ${results.implementer}, continuer ${results.continuer}`];
  for (const mode of BENCH_MODES) {
    const m = results.byMode[mode];
    if (!m) continue;
    lines.push(
      `${mode.padEnd(10)} ${m.runs} runs, mean input ${Math.round(m.meanInputTokens)} tokens, mean prompt ${Math.round(m.meanPromptTokens)} tokens, mean ${money(m.meanUsd)}, pass rate ${pct(m.passRate)} (verified by the daemon)`,
    );
  }
  for (const leg of BENCH_LEGS) {
    if (leg === 'build') continue;
    const m = results.byLeg[leg];
    if (!m) continue;
    lines.push(`${`${leg} leg`.padEnd(10)} ${m.runs} runs, mean input ${Math.round(m.meanInputTokens)} tokens, mean ${money(m.meanUsd)}, pass rate ${pct(m.passRate)}`);
  }
  lines.push(
    results.ratio !== null
      ? `Ratio (transcript over packet mean input tokens): ${results.ratio.toFixed(2)}x`
      : 'Ratio: not available (it needs both modes)',
  );
  const packet = results.byMode.packet;
  const transcript = results.byMode.transcript;
  if (packet && transcript && packet.passRate < transcript.passRate) {
    lines.push('Packet mode passed less often than transcript mode: leftOut and askOfNext are the fields to improve.');
  }
  return lines;
}

/** Writes results.json and both hand-written SVGs into outDir. */
export async function writeBenchOutputs(outDir: string, results: BenchResults): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(join(outDir, 'results.svg'), renderBenchSvg(results, 'dark'));
  await writeFile(join(outDir, 'results-light.svg'), renderBenchSvg(results, 'light'));
}

// Colours from design/tokens.json: surface, ink, ink-muted, border, accent (packet), vendor-alt (transcript).
const THEMES = {
  dark: { surface: '#0b0b0d', ink: '#f4f4f5', muted: '#a1a1aa', border: '#27272a', packet: '#60a5fa', transcript: '#94a3b8' },
  light: { surface: '#ffffff', ink: '#18181b', muted: '#52525b', border: '#e4e4e7', packet: '#2563eb', transcript: '#475569' },
} as const;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shortTokens = (n: number) => (n >= 1000 ? `${round(n / 1000, 1)}k` : `${Math.round(n)}`);

/** Grouped bars of continued run input tokens per task by mode, with the pass rate per mode as a label. */
export function renderBenchSvg(results: BenchResults, theme: 'dark' | 'light'): string {
  const c = THEMES[theme];
  const tasks: string[] = [];
  for (const r of results.rows) if (!tasks.includes(r.task)) tasks.push(r.task);
  const modes = BENCH_MODES.filter((m) => results.byMode[m]);
  const value = (task: string, mode: BenchMode) => {
    const rows = results.rows.filter((r) => r.leg === 'build' && r.task === task && r.mode === mode);
    return rows.length ? mean(rows.map((r) => r.inputTokens)) : null;
  };
  const max = Math.max(1, ...tasks.flatMap((t) => modes.map((m) => value(t, m) ?? 0)));
  const groupW = 148;
  const barW = 48;
  const left = 72;
  const top = 84;
  const plotH = 260;
  const width = Math.max(640, left + tasks.length * groupW + 24);
  const height = top + plotH + 64;
  const baseY = top + plotH;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Continued run input tokens by task and mode">`,
    `<rect width="${width}" height="${height}" fill="${c.surface}"/>`,
    `<text x="24" y="32" font-family="Geist, Inter, system-ui, sans-serif" font-size="16" font-weight="600" fill="${c.ink}">Continued run input tokens by mode</text>`,
    `<text x="24" y="52" font-family="Geist, Inter, system-ui, sans-serif" font-size="12" fill="${c.muted}">${xml(results.replay ? 'Replay of recorded runs' : 'Live runs')}${results.synthetic ? ', synthetic' : ''}; pass means the daemon verification was green</text>`,
  ];
  let legendX = 24;
  for (const mode of modes) {
    const m = results.byMode[mode] as ModeSummary;
    out.push(`<rect x="${legendX}" y="62" width="12" height="12" fill="${c[mode]}"/>`);
    const label = `${mode}: ${pct(m.passRate)} passed`;
    out.push(`<text x="${legendX + 18}" y="73" font-family="Geist, Inter, system-ui, sans-serif" font-size="12" fill="${c.ink}">${xml(label)}</text>`);
    legendX += 18 + label.length * 7 + 24;
  }
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = baseY - (plotH / 4) * i;
    out.push(`<line x1="${left}" y1="${round(y, 1)}" x2="${width - 24}" y2="${round(y, 1)}" stroke="${c.border}" stroke-width="1"/>`);
    out.push(`<text x="${left - 8}" y="${round(y + 4, 1)}" text-anchor="end" font-family="Geist Mono, ui-monospace, Menlo, monospace" font-size="11" fill="${c.muted}">${shortTokens(v)}</text>`);
  }
  tasks.forEach((task, ti) => {
    const gx = left + ti * groupW;
    out.push(`<g class="group" data-task="${xml(task)}">`);
    modes.forEach((mode, mi) => {
      const v = value(task, mode);
      if (v === null) return;
      const h = Math.max(1, (v / max) * plotH);
      const x = gx + 14 + mi * (barW + 8);
      out.push(`<rect x="${round(x, 1)}" y="${round(baseY - h, 1)}" width="${barW}" height="${round(h, 1)}" fill="${c[mode]}"/>`);
      out.push(
        `<text x="${round(x + barW / 2, 1)}" y="${round(baseY - h - 6, 1)}" text-anchor="middle" font-family="Geist Mono, ui-monospace, Menlo, monospace" font-size="11" fill="${c.ink}">${shortTokens(v)}</text>`,
      );
    });
    out.push(`<text x="${round(gx + groupW / 2, 1)}" y="${baseY + 20}" text-anchor="middle" font-family="Geist, Inter, system-ui, sans-serif" font-size="11" fill="${c.muted}">${xml(task)}</text>`);
    out.push('</g>');
  });
  out.push('</svg>', '');
  return out.join('\n');
}
