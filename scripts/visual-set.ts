#!/usr/bin/env bun
// The visual set: Stint's own visual check, run the way bench/visual/run.ts runs it (the daemon's verifier, so
// packages/daemon/src/visual.ts with Muse Spark 1.3 judging and SAM 3.1 boxing on the Meta Model API), on the ten pages
// in bench/visual-set/pages.json: five with one seeded defect, five clean. Each page is served as /admin from its own
// fresh repository, so the prompt is the same for all ten and no file name reaches the model. SAM's box is not in the
// visual.checked event, so the script reads it from SAM's answer as the verifier receives it. A page already in
// results.json is never run again. Writes bench/visual-set/results.json and each page's screenshots under shots/.
// Usage: STINT_LIVE=1 bun --env-file=<your env file> scripts/visual-set.ts [--port 6421] [--budget-usd 0.75]
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Config, DEFAULT_CONFIG, type StintEvent } from '../packages/core/src/index';
import { Workspace } from '../packages/core/src/node';
import { DaemonVerifier, RunRegistry, Worktrees } from '../packages/daemon/src/index';
import { type Box, samBoxes } from '../packages/daemon/src/visual';
import { fail, scrubber } from './seeded-run';

// the published-record scrub the scorecard uses: local paths, the user name, keys, emails and dashes
const scrub = scrubber([]);
const ROOT = resolve(import.meta.dir, '..');
const BENCH = join(ROOT, 'bench', 'visual-set');
const VIEWPORT = { width: 1280, height: 800 };
const TEST_COMMAND = `printf ' 1 pass\\n 0 fail\\n'`;
// the most one page can cost: a 2,000-token prompt and Muse Spark's 4,000-token answer cap at $1.25 and $5 per million, and one SAM image
const PAGE_MAX_USD = 0.025;

export type Rect = { x1: number; y1: number; x2: number; y2: number };
export type PageSpec = { id: string; kind: 'defect' | 'clean'; change: string; targets: string[] };

/** bench/visual-set/pages.json, read at the boundary: a defect names the elements it seeded, a clean page names none. */
export function loadSet(dir: string): { criterion: string; ref: string; pages: PageSpec[] } {
  const body = JSON.parse(readFileSync(join(dir, 'pages.json'), 'utf8')) as Record<string, unknown>;
  const text = (v: unknown, at: string) => (typeof v === 'string' && v ? v : fail(`pages.json: ${at} must be a non-empty string`));
  const pages = (Array.isArray(body.pages) ? (body.pages as Record<string, unknown>[]) : fail('pages.json has no pages')).map((p, i) => {
    const id = text(p.id, `page ${i + 1} id`);
    if (!/^[a-z0-9-]+$/.test(id)) fail(`pages.json: page id ${id} must be lowercase letters, digits and dashes`);
    if (p.kind !== 'defect' && p.kind !== 'clean') fail(`pages.json: ${id} kind must be defect or clean`);
    const targets = Array.isArray(p.targets) && p.targets.every((t) => typeof t === 'string') ? (p.targets as string[]) : fail(`pages.json: ${id} targets must be a list of selectors`);
    if ((p.kind === 'defect') !== targets.length > 0) fail(`pages.json: ${id} is ${p.kind}, so it must name ${p.kind === 'defect' ? 'the elements it seeded' : 'no targets'}`);
    if (!existsSync(join(dir, 'pages', `${id}.html`))) fail(`pages.json: no file pages/${id}.html`);
    return { id, kind: p.kind as PageSpec['kind'], change: text(p.change, `${id} change`), targets };
  });
  return { criterion: text(body.criterion, 'criterion'), ref: text(body.ref, 'ref'), pages };
}

/** SAM's box in screenshot pixels: SAM answers in its own w by h frame, and the verifier's drawMark scales it the same way. */
export function toViewport(b: Box): Rect {
  const sx = VIEWPORT.width / b.w;
  const sy = VIEWPORT.height / b.h;
  return { x1: Math.round(b.x1 * sx), y1: Math.round(b.y1 * sy), x2: Math.round(b.x2 * sx), y2: Math.round(b.y2 * sy) };
}

/** The largest share of the box that lies on one seeded element; the box is on target when at least half of it does. */
export function onTarget(box: Rect, targets: Rect[]): { share: number; onTarget: boolean } {
  const area = (r: Rect) => Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
  const whole = area(box);
  const share = whole === 0 ? 0 : Math.max(0, ...targets.map((t) => area({ x1: Math.max(box.x1, t.x1), y1: Math.max(box.y1, t.y1), x2: Math.min(box.x2, t.x2), y2: Math.min(box.y2, t.y2) }) / whole));
  return { share: Math.round(share * 100) / 100, onTarget: share >= 0.5 };
}

export type Row = { kind: PageSpec['kind']; holds: boolean | null; boxed: boolean; onTarget: boolean | null };

/** Caught: a defect page judged not to hold. Wrongly failed: a clean page judged not to hold. A page not checked counts in neither. */
export function tally(rows: Row[]) {
  const checked = rows.filter((r) => r.holds !== null);
  const defects = checked.filter((r) => r.kind === 'defect');
  const clean = checked.filter((r) => r.kind === 'clean');
  const caught = defects.filter((r) => r.holds === false);
  return {
    defectsCaught: caught.length,
    defects: defects.length,
    cleanWronglyFailed: clean.filter((r) => r.holds === false).length,
    clean: clean.length,
    defectsBoxed: caught.filter((r) => r.boxed).length,
    boxesOnTarget: caught.filter((r) => r.onTarget === true).length,
    notChecked: rows.length - checked.length,
  };
}

type Browser = { newPage(o: { viewport: typeof VIEWPORT }): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

/** Each seeded element's box at the check's viewport, in the Chromium the verifier uses (the Playwright apps/web installs). */
async function measure(pages: PageSpec[]): Promise<Map<string, Rect[]>> {
  const { chromium } = (await import(Bun.resolveSync('@playwright/test', join(ROOT, 'apps', 'web')))) as { chromium: { launch(): Promise<Browser> } };
  const browser = await chromium.launch();
  const out = new Map<string, Rect[]>();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    for (const p of pages) {
      await page.setContent(readFileSync(join(BENCH, 'pages', `${p.id}.html`), 'utf8'));
      const js = `${JSON.stringify(p.targets)}.map((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x1: Math.round(b.left), y1: Math.round(b.top), x2: Math.round(b.right), y2: Math.round(b.bottom) }; })`;
      const rects = (await page.evaluate(js)) as Array<Rect | null>;
      out.set(p.id, rects.map((r, i) => r ?? fail(`${p.id}: no element matches ${p.targets[i]}`)));
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** Reads SAM 3.1's answers as the verifier receives them; only the box text is kept, never a request or a header. */
function tapSam(): { take(): Box[] } {
  let seen: Box[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const res = await real(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/responses') && res.ok) {
      // a body the tap cannot read is the verifier's to handle; the tap never changes what it sees
      const body = (await res.clone().json().catch(() => ({}))) as { output?: Array<{ content?: Array<{ text?: string }> }> };
      seen.push(...samBoxes((body.output ?? []).flatMap((o) => (o.content ?? []).map((c) => c.text ?? '')).join('\n')));
    }
    return res;
  }, real);
  return {
    take() {
      const out = seen;
      seen = [];
      return out;
    },
  };
}

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.toString()}`);
};

/** One page through the daemon's verifier, as bench/visual/run.ts does it: a fresh repository serving the page as /admin. */
async function checkPage(set: { criterion: string; ref: string }, page: PageSpec, port: string): Promise<{ status: string; reason: string | null; check: Record<string, unknown>; files: Record<string, string> }> {
  const repo = mkdtempSync(join(tmpdir(), 'stint-visual-set-'));
  try {
    mkdirSync(join(repo, 'site'));
    cpSync(join(ROOT, 'bench', 'visual', 'fixture', 'serve.ts'), join(repo, 'serve.ts'));
    cpSync(join(BENCH, 'pages', `${page.id}.html`), join(repo, 'site', 'admin.html'));
    git(repo, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 'Stint Bench'], ['user.email', 'bench@example.com'], ['commit.gpgsign', 'false']] as const) git(repo, 'config', k, v);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'The webhooks admin page');
    const config: Config = structuredClone(DEFAULT_CONFIG);
    config.visual = { serve: `bun serve.ts ${port} site`, url: `http://127.0.0.1:${port}` };
    await Bun.write(join(repo, '.stint', 'config.json'), JSON.stringify(config, null, 2));

    const ws = await Workspace.open(repo);
    const created = await ws.createTask({ title: 'Tell an over-limit tenant when to try again', goal: 'Show the retry time on the admin page.', acceptance: [set.criterion], testCommand: TEST_COMMAND });
    const task = await ws.writeTask(created.id, { proofs: [{ criterion: 1, kind: 'visual', ref: set.ref }] });
    const { path } = await new Worktrees(ws, new RunRegistry()).create(task, 'r1');
    const record = await new DaemonVerifier(ws).verify(task, 'r1', path);
    const check = (await ws.events(task.id).read()).find((e: StintEvent) => e.type === 'visual.checked')?.payload as Record<string, unknown> | undefined;
    if (!check) throw new Error(`${page.id}: no visual check was recorded`);
    const taskDir = await ws.taskDir(task.id);
    const files: Record<string, string> = {};
    for (const [key, name] of [['screenshot', `${page.id}.png`], ['marked', `${page.id}-marked.png`]] as const) {
      if (typeof check[key] !== 'string') continue;
      copyFileSync(join(taskDir, check[key] as string), join(BENCH, 'shots', name));
      files[key] = `shots/${name}`;
    }
    return { status: record.status, reason: record.reason ?? null, check, files };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { port: { type: 'string', default: '6421' }, 'budget-usd': { type: 'string', default: '0.75' } } });
  if (process.env.STINT_LIVE !== '1') {
    process.stderr.write('visual-set calls Muse Spark and SAM 3.1; set STINT_LIVE=1 to run it\n');
    process.exit(2);
  }
  if (!process.env.META_API_KEY) fail('META_API_KEY is not set; run with bun --env-file=<your env file>');
  const budget = Number(values['budget-usd']);
  const set = loadSet(BENCH);
  mkdirSync(join(BENCH, 'shots'), { recursive: true });
  const outFile = join(BENCH, 'results.json');
  // a page already published is never run again, so a result cannot be replaced by a second try
  const prior = existsSync(outFile) ? (JSON.parse(readFileSync(outFile, 'utf8')) as { pages: Array<Record<string, unknown>> }) : null;
  const done = new Map<string, Record<string, unknown>>((prior?.pages ?? []).map((p) => [p.id as string, p]));
  const rects = await measure(set.pages);
  const sam = tapSam();
  const usdOf = (p: Record<string, unknown>) => ((p.cost as { usd?: number } | null)?.usd ?? 0) as number;
  let stopped: string | null = null;

  const write = () => {
    const pages = set.pages.flatMap((p) => (done.has(p.id) ? [done.get(p.id) as Record<string, unknown>] : []));
    const totalUsd = Math.round(pages.reduce((n, p) => n + usdOf(p), 0) * 10_000) / 10_000;
    const table = tally(pages.map((p) => ({ kind: p.kind as PageSpec['kind'], holds: (p.verdict as { holds?: boolean } | null)?.holds ?? null, boxed: p.box !== null, onTarget: p.onTarget as boolean | null })));
    const record = { version: 'stint.visual-set/1', live: true, criterion: set.criterion, ref: set.ref, judge: 'meta-api/muse-spark-1.3', mark: 'meta-api/sam-3.1', testCommand: TEST_COMMAND, onTarget: 'at least half of the drawn box lies on one seeded element', budgetUsd: budget, totalUsd, stopped, table, pages };
    writeFileSync(outFile, scrub(`${JSON.stringify(record, null, 2)}\n`));
    return { totalUsd, table };
  };

  for (const page of set.pages) {
    if (done.has(page.id)) continue;
    const spent = [...done.values()].reduce((n, p) => n + usdOf(p), 0);
    if (spent + PAGE_MAX_USD > budget) {
      stopped = `stopped before ${page.id}: $${spent.toFixed(4)} spent, and one more page can cost $${PAGE_MAX_USD} against a budget of $${budget}`;
      break;
    }
    const at = new Date().toISOString();
    sam.take();
    const { status, reason, check, files } = await checkPage(set, page, values.port as string);
    // the verifier draws the most confident box, so that is the one judged
    const boxes = sam.take().sort((a, b) => (b.c ?? 0) - (a.c ?? 0));
    const drawn = typeof check.marked === 'string' && boxes[0] ? boxes[0] : null;
    const box = drawn ? toViewport(drawn) : null;
    const targets = rects.get(page.id) ?? [];
    const hit = box && page.kind === 'defect' ? onTarget(box, targets) : null;
    const judge = check.judge as { cost?: Record<string, number> } | undefined;
    done.set(page.id, {
      id: page.id,
      kind: page.kind,
      change: page.change,
      at,
      verification: { status, reason },
      verdict: typeof check.holds === 'boolean' ? { holds: check.holds, seen: check.seen ?? null, problem: check.problem ?? null, element: check.element ?? null } : null,
      ...(typeof check.notChecked === 'string' ? { notChecked: check.notChecked } : {}),
      targets,
      box,
      samMatches: boxes.length,
      confidence: drawn?.c ?? null,
      share: hit?.share ?? null,
      onTarget: hit?.onTarget ?? null,
      ...files,
      cost: check.cost ?? (judge?.cost ? judge.cost : null),
      judge: check.judge ?? null,
      mark: check.mark ?? null,
    });
    const { totalUsd } = write();
    process.stdout.write(`${JSON.stringify({ page: page.id, status, holds: check.holds ?? null, element: check.element ?? null, box, onTarget: hit?.onTarget ?? null, usd: usdOf(done.get(page.id) as Record<string, unknown>), totalUsd })}\n`);
  }
  const { totalUsd, table } = write();
  process.stdout.write(`${JSON.stringify({ totalUsd, table, stopped })}\n`);
}
