import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, runsFromEvents, writeJsonAtomic } from '@stint-dev/core/node';
import type { SkillProposal } from '@stint-dev/core';
import { type Adapter, assign, createApp, daemonContext, defaultAdapters, renderSkillMarkdown } from '@stint-dev/daemon';

type App = ReturnType<typeof createApp>;
import { scrubPaths } from '../bench/live';
import { freshFixture } from '../demo';
import type { EvalTaskDef, GoldenRow, GoldenTask, SkillEvalRow } from './results';

/** A fresh clone of the repository under test: every eval run starts from the committed state. */
export function freshRepoCopy(root: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-eval-'));
  const r = Bun.spawnSync(['git', 'clone', '-q', root, dir], { stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`cannot clone ${root} for the eval: ${r.stderr.toString().trim()}`);
  return dir;
}

/**
 * Puts the workspace's skills and config into a fresh copy, so the copy runs what the person
 * runs: with the skill mounted (a proposal not yet approved is written in), or with the skill
 * folder removed for the without side.
 */
export async function prepareSkillFixture(fixture: string, root: string, skillId: string, withSkill: boolean, proposal: SkillProposal | null, proposalDir?: string): Promise<void> {
  const skillsFrom = join(root, '.agents', 'skills');
  const skillsTo = join(fixture, '.agents', 'skills');
  if (existsSync(skillsFrom)) {
    rmSync(skillsTo, { recursive: true, force: true });
    cpSync(skillsFrom, skillsTo, { recursive: true });
  }
  const skillDir = join(skillsTo, skillId);
  if (!withSkill) {
    rmSync(skillDir, { recursive: true, force: true });
  } else if (proposal && !existsSync(join(skillDir, 'SKILL.md'))) {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), renderSkillMarkdown(proposal));
  } else if (proposalDir && !existsSync(join(skillDir, 'SKILL.md'))) {
    // an imported proposal folder (R-060): the bundle mounts as submitted, its card stays in the queue
    await mkdir(skillDir, { recursive: true });
    cpSync(proposalDir, skillDir, { recursive: true, filter: (from) => !from.endsWith('proposal.json') });
  }
  const config = join(root, '.stint', 'config.json');
  if (existsSync(config)) {
    await mkdir(join(fixture, '.stint'), { recursive: true });
    cpSync(config, join(fixture, '.stint', 'config.json'));
  }
}

type RunOutcome = {
  verified: boolean;
  passed: number;
  failed: number;
  findings: number | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  usd: number | null;
  prompt: string;
  worktree: string;
  taskId: string;
  model?: string;
  host?: string;
};

/** Reviews through the daemon's reviewer chain; a red verification or an exhausted chain means no review ran. */
async function reviewViaDaemon(app: App, token: string, taskId: string): Promise<number | null> {
  const res = await app.request(`/api/tasks/${taskId}/review`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) return null;
  const review = (await res.json()) as { findings?: unknown[] };
  return Array.isArray(review.findings) ? review.findings.length : null;
}

async function runOneTask(opts: {
  fixture: string;
  def: EvalTaskDef;
  implementer: string;
  adapters?: () => Adapter[];
  review?: (app: App, taskId: string) => Promise<number | null>;
  /** Golden runs are graded by verification plus scenarios, so they skip the reviewer chain. */
  skipReview?: boolean;
  log?: (line: string) => void;
}): Promise<RunOutcome> {
  const ws = await Workspace.open(opts.fixture);
  const token = randomBytes(16).toString('hex');
  const app = createApp(ws, opts.adapters ? opts.adapters() : defaultAdapters(ws.config), { token, quiet: true, webDist: null, snapshotMs: 1000 });
  const ctx = daemonContext(app);
  const task = await ws.createTask({
    title: opts.def.title.slice(0, 120),
    goal: opts.def.goal.slice(0, 2000),
    acceptance: opts.def.acceptance,
    testCommand: opts.def.testCommand,
    ...(opts.def.tags ? { tags: opts.def.tags } : {}),
    budgets: { implementer: 2_000_000, reviewer: 2_000_000 },
  });
  const assigned = await assign(ctx, task.id, { adapter: opts.implementer, role: 'implementer' });
  await assigned.done;
  const verification = await ws.verification(task.id).read(assigned.run);
  let findings: number | null = null;
  if (verification?.status === 'green' && !opts.skipReview) {
    findings = opts.review ? await opts.review(app, task.id) : await reviewViaDaemon(app, token, task.id);
    if (findings === null) opts.log?.(`${opts.def.id}: the reviewer chain did NOT produce findings for this run`);
  }
  const events = await ws.events(task.id).read();
  const runs = runsFromEvents(events).filter((r) => r.cost);
  const impl = runs.find((r) => r.run === assigned.run);
  const usdValues = runs.map((r) => r.cost?.usd).filter((u): u is number => typeof u === 'number');
  return {
    verified: verification?.status === 'green',
    passed: verification?.passed ?? 0,
    failed: verification?.failed ?? 0,
    findings,
    inputTokens: runs.reduce((s, r) => s + (r.cost?.inputTokens ?? 0), 0),
    cachedTokens: runs.reduce((s, r) => s + (r.cost?.cachedTokens ?? 0), 0),
    outputTokens: runs.reduce((s, r) => s + (r.cost?.outputTokens ?? 0), 0),
    usd: usdValues.length ? usdValues.reduce((s, u) => s + u, 0) : null,
    prompt: (await ws.runs(task.id).readPrompt(assigned.run)) ?? '',
    worktree: join(opts.fixture, assigned.worktree),
    taskId: task.id,
    ...(impl?.model ? { model: impl.model } : {}),
    ...(impl?.host ? { host: impl.host } : {}),
  };
}

export type SkillEvalLiveOptions = {
  root: string;
  skillId: string;
  proposal: SkillProposal | null;
  /** An imported proposal folder, mounted as submitted on the with side (R-060). */
  proposalDir?: string;
  tasks: EvalTaskDef[];
  implementer: string;
  /** Where row artefacts land: `.stint/evals/<skill>/runs` in the workspace. */
  outRunsDir: string;
  adapters?: () => Adapter[];
  review?: (app: App, taskId: string) => Promise<number | null>;
  makeFixture?: () => string;
  synthetic?: boolean;
  log?: (line: string) => void;
};

/** The live skill eval: each task twice on fresh copies, with the skill mounted and without it. */
export async function runSkillEvalLive(opts: SkillEvalLiveOptions): Promise<SkillEvalRow[]> {
  const rows: SkillEvalRow[] = [];
  for (const def of opts.tasks) {
    for (const withSkill of [true, false]) {
      const fixture = (opts.makeFixture ?? (() => freshRepoCopy(opts.root)))();
      try {
        await prepareSkillFixture(fixture, opts.root, opts.skillId, withSkill, opts.proposal, opts.proposalDir);
        opts.log?.(`${def.id} ${withSkill ? 'with' : 'without'} ${opts.skillId}: running ${opts.implementer}`);
        const outcome = await runOneTask({ fixture, def, implementer: opts.implementer, ...(opts.adapters ? { adapters: opts.adapters } : {}), ...(opts.review ? { review: opts.review } : {}), ...(opts.log ? { log: opts.log } : {}) });
        const row: SkillEvalRow = {
          task: def.id,
          ...(def.heldOut ? { heldOut: true as const } : {}),
          withSkill,
          findings: outcome.findings,
          passed: outcome.passed,
          failed: outcome.failed,
          verified: outcome.verified,
          inputTokens: outcome.inputTokens,
          cachedTokens: outcome.cachedTokens,
          outputTokens: outcome.outputTokens,
          usd: outcome.usd,
          ...(opts.synthetic ? { synthetic: true as const } : {}),
          implementer: opts.implementer,
          ...(outcome.model ? { model: outcome.model } : {}),
          ...(outcome.host ? { host: outcome.host } : {}),
        };
        const dir = join(opts.outRunsDir, `${def.id}-${withSkill ? 'with' : 'without'}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'prompt.md'), scrubPaths(outcome.prompt));
        await writeFile(join(dir, 'row.json'), `${JSON.stringify(row, null, 2)}\n`);
        rows.push(row);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }
  return rows;
}

export type GoldenLiveOptions = {
  tasks: GoldenTask[];
  k: number;
  implementer: string;
  outRunsDir: string;
  adapters?: () => Adapter[];
  makeFixture?: () => string;
  synthetic?: boolean;
  log?: (line: string) => void;
};

/** One scenario: a held-out grader command in the run's worktree; it passes when it exits 0. */
function runScenario(command: string, cwd: string): boolean {
  const r = Bun.spawnSync(['/bin/sh', '-c', command], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0;
}

/** The live golden eval: each golden task k times on fresh fixtures, graded by the daemon plus its scenarios. */
export async function runGoldenLive(opts: GoldenLiveOptions): Promise<GoldenRow[]> {
  const rows: GoldenRow[] = [];
  for (const golden of opts.tasks) {
    for (let run = 1; run <= opts.k; run++) {
      const fixture = (opts.makeFixture ?? freshFixture)();
      try {
        if (golden.fixtureCommit) {
          // on a branch, not detached: the daemon starts a task only from a branch it can merge back into
          const co = Bun.spawnSync(['git', 'checkout', '-q', '-B', 'golden', golden.fixtureCommit], { cwd: fixture, stderr: 'pipe' });
          if (co.exitCode !== 0) throw new Error(`golden task ${golden.name}: fixture commit ${golden.fixtureCommit} does not check out: ${co.stderr.toString().trim()}`);
        }
        const def: EvalTaskDef = { id: golden.name, title: golden.title, goal: golden.goal, acceptance: golden.acceptance, testCommand: golden.testCommand };
        opts.log?.(`${golden.name} run ${run}/${opts.k}: ${opts.implementer}`);
        const outcome = await runOneTask({ fixture, def, implementer: opts.implementer, skipReview: true, ...(opts.adapters ? { adapters: opts.adapters } : {}) });
        const scenarios = (golden.scenarios ?? []).map((s) => ({ name: s.name, passed: existsSync(outcome.worktree) ? runScenario(s.command, outcome.worktree) : false }));
        const passed = outcome.verified && scenarios.every((s) => s.passed);
        const ws = await Workspace.open(fixture);
        for (const s of scenarios) await ws.events(outcome.taskId).append({ task: outcome.taskId, vendor: 'daemon', type: 'scenario.ran', payload: { name: s.name, passed: s.passed, golden: golden.name } });
        await ws.events(outcome.taskId).append({ task: outcome.taskId, vendor: 'daemon', type: 'eval.ran', payload: { golden: golden.name, run, k: opts.k, passed, verified: outcome.verified, scenarios: scenarios.map((s) => s.name) } });
        const row: GoldenRow = {
          task: golden.name,
          run,
          passed,
          verified: outcome.verified,
          passedTests: outcome.passed,
          failedTests: outcome.failed,
          scenarios,
          inputTokens: outcome.inputTokens,
          cachedTokens: outcome.cachedTokens,
          outputTokens: outcome.outputTokens,
          usd: outcome.usd,
          ...(opts.synthetic ? { synthetic: true as const } : {}),
          implementer: opts.implementer,
          ...(outcome.model ? { model: outcome.model } : {}),
          ...(outcome.host ? { host: outcome.host } : {}),
        };
        const dir = join(opts.outRunsDir, `${golden.name}-r${run}`);
        await mkdir(dir, { recursive: true });
        // the fixture task's log is kept with the artefact: it carries the scenario.ran and eval.ran records
        const log = (await ws.events(outcome.taskId).read()).map((e) => JSON.stringify(e)).join('\n');
        await writeFile(join(dir, 'events.jsonl'), scrubPaths(log ? `${log}\n` : ''));
        await writeFile(join(dir, 'prompt.md'), scrubPaths(outcome.prompt));
        await writeJsonAtomic(join(dir, 'row.json'), row);
        rows.push(row);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }
  return rows;
}

/** The recorded skill eval file text, read back for tests that run the live path in process. */
export async function readEvalFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
