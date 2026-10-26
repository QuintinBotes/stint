import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SkillProposalSchema, parseSkillFrontmatter } from '@stint-dev/core';
import { Workspace, readJsonIfExists, slugify, writeJsonAtomic } from '@stint-dev/core/node';
import { defineCommand } from 'citty';
import { runGoldenLive, runSkillEvalLive } from './eval/live';
import {
  buildGoldenResults,
  buildSkillEval,
  formatGoldenSummary,
  formatSkillSummary,
  loadGoldenReplay,
  loadGoldenTasks,
  loadSkillReplay,
  resolveSkillEvalTasks,
  writeGoldenResults,
} from './eval/results';
import { repoRoot } from './repo';

function positiveInt(raw: string, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`--${name} must be a positive whole number, not ${raw}\n`);
    process.exit(2);
  }
  return n;
}

const out = (s: string) => process.stdout.write(`${s}\n`);

/** What the eval knows about a skill before approval or after: its tags and evidence, and the proposal when there is one. */
async function skillInfo(root: string, ws: Workspace, id: string) {
  const file = join(root, '.agents', 'skills', id, 'SKILL.md');
  const proposalRaw = await readJsonIfExists<unknown>(join(ws.cacheDir, 'proposals', `${id}.json`));
  const proposalParsed = proposalRaw !== null ? SkillProposalSchema.safeParse(proposalRaw) : null;
  const proposal = proposalParsed?.success ? proposalParsed.data : null;
  if (existsSync(file)) {
    const { frontmatter } = parseSkillFrontmatter(await Bun.file(file).text());
    return { tags: frontmatter.tags ?? [], evidence: frontmatter.evidence ?? [], proposal };
  }
  if (proposal) return { tags: proposal.tags, evidence: proposal.evidence, proposal };
  throw new Error(`no skill or proposal ${id} in ${root}`);
}

async function skillEval(args: { skill: string; tasks?: string; replay: boolean; from?: string; implementer: string; repo?: string; json: boolean }): Promise<void> {
  const root = repoRoot(args.repo);
  const ws = await Workspace.open(root);
  const info = await skillInfo(root, ws, args.skill);
  const evalsDir = join(root, '.stint', 'evals');
  const evalFile = await (async () => {
    if (args.replay) {
      const fromDir = args.from ? resolve(args.from) : join(evalsDir, args.skill, 'runs');
      return loadSkillReplay(args.skill, fromDir);
    }
    const requested = args.tasks?.split(',').map((s) => s.trim()).filter(Boolean);
    const { defs, heldOut } = resolveSkillEvalTasks({ evidence: info.evidence, tags: info.tags, tasks: await ws.listTasks(), ...(requested?.length ? { requested } : {}) });
    if (!defs.length) throw new Error(`skill ${args.skill} has no evidence tasks in this workspace; name some with --tasks`);
    const rows = await runSkillEvalLive({
      root,
      skillId: args.skill,
      proposal: info.proposal,
      tasks: defs,
      implementer: args.implementer,
      outRunsDir: join(evalsDir, args.skill, 'runs'),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    return buildSkillEval({ id: args.skill, rows, replay: false, tasks: defs.map((d) => d.id), heldOut });
  })();
  await writeJsonAtomic(join(evalsDir, `${args.skill}.json`), evalFile);
  const carrierIds = [...info.evidence.map((r) => r.split('/')[0] as string), ...evalFile.tasks];
  let recorded = false;
  for (const taskId of carrierIds) {
    try {
      await ws.readTask(taskId);
    } catch {
      continue;
    }
    await ws.events(taskId).append({
      task: taskId,
      vendor: 'daemon',
      type: 'skill.evaluated',
      payload: { id: args.skill, with: evalFile.with, without: evalFile.without, replay: evalFile.replay, card: evalFile.card },
      links: [{ kind: 'skill', ref: args.skill }],
    });
    recorded = true;
    break;
  }
  if (!recorded) process.stderr.write(`skill.evaluated for ${args.skill} was NOT recorded: no evidence task exists in this workspace\n`);
  if (args.json) {
    out(JSON.stringify(evalFile));
    return;
  }
  for (const line of formatSkillSummary(evalFile)) out(line);
  out(`Wrote ${join(evalsDir, `${args.skill}.json`)}`);
}

async function goldenEval(args: { k: number; replay: boolean; from?: string; out?: string; implementer: string; repo?: string; json: boolean }): Promise<void> {
  const root = repoRoot(args.repo);
  const benchDir = args.out ? resolve(args.out) : join(root, 'bench');
  const goldenDir = join(root, 'bench', 'golden');
  const titles = new Map<string, string>();
  if (existsSync(goldenDir)) {
    for (const t of await loadGoldenTasks(goldenDir).catch(() => [])) titles.set(t.name, t.title);
  }
  const results = await (async () => {
    if (args.replay) return loadGoldenReplay(args.from ? resolve(args.from) : join(benchDir, 'golden-runs'), args.k, titles);
    const tasks = await loadGoldenTasks(goldenDir);
    for (const t of tasks) titles.set(t.name, t.title);
    const rows = await runGoldenLive({ tasks, k: args.k, implementer: args.implementer, outRunsDir: join(benchDir, 'golden-runs'), log: (line) => process.stderr.write(`${line}\n`) });
    return buildGoldenResults({ rows, k: args.k, replay: false, titles });
  })();
  const path = await writeGoldenResults(benchDir, results);
  if (args.json) {
    out(JSON.stringify(results));
    return;
  }
  for (const line of formatGoldenSummary(results)) out(line);
  out(`Wrote ${path}`);
}

/** Turns a rejected or reverted task into a golden task, so the failure keeps being tested (R-046). */
async function addGolden(args: { task: string; repo?: string }): Promise<void> {
  const root = repoRoot(args.repo);
  const ws = await Workspace.open(root);
  const task = await ws.readTask(args.task);
  const events = await ws.events(args.task).read();
  const failed = task.status === 'rejected' || events.some((e) => e.type === 'approval.rejected' || e.type === 'outcome.reverted');
  if (!failed) throw new Error(`${args.task} was neither rejected nor reverted; golden tasks come from real failures`);
  const name = `${args.task.toLowerCase()}-${slugify(task.title)}`;
  const dir = join(root, 'bench', 'golden');
  const path = join(dir, `${name}.json`);
  if (existsSync(path)) throw new Error(`${path} already exists`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify({ title: task.title, goal: task.goal, acceptance: task.acceptance, testCommand: task.testCommand, fixtureCommit: task.baseCommit }, null, 2)}\n`);
  out(`Wrote ${path} from ${args.task}. Run it with: stint eval --golden --k 3`);
}

export const evalCommand = defineCommand({
  meta: { name: 'eval', description: 'Measure a skill with and without it mounted, or run the golden tasks' },
  args: {
    action: { type: 'positional', required: false, description: 'add-golden; omit to run an eval' },
    task: { type: 'positional', required: false, description: 'Task id for add-golden' },
    skill: { type: 'string', description: 'Skill id to evaluate, with and without it mounted' },
    tasks: { type: 'string', description: 'Comma list of task ids (default: the evidence tasks plus one held out)' },
    golden: { type: 'boolean', description: 'Run every task in bench/golden k times' },
    k: { type: 'string', description: 'Tries per golden task', default: '3' },
    implementer: { type: 'string', description: 'Adapter for eval runs', default: 'muse-code' },
    replay: { type: 'boolean', description: 'Rebuild from recorded runs; no model call' },
    from: { type: 'string', description: 'Recorded runs directory for --replay' },
    out: { type: 'string', description: 'Where golden results and runs go (default: bench/ in the repository)' },
    repo: { type: 'string', description: 'Repository root (default: the git top level)' },
    json: { type: 'boolean', description: 'Print the results object' },
  },
  async run({ args }) {
    try {
      if (args.action === 'add-golden') {
        if (!args.task) {
          process.stderr.write('stint eval add-golden needs a task: stint eval add-golden T-0042\n');
          process.exit(2);
        }
        await addGolden({ task: args.task, repo: args.repo });
        return;
      }
      if (args.action) {
        process.stderr.write(`stint eval has no action ${args.action}; use --skill <id>, --golden, or add-golden <task>\n`);
        process.exit(2);
      }
      if (args.skill && args.golden) {
        process.stderr.write('pass --skill or --golden, not both\n');
        process.exit(2);
      }
      if (args.skill) {
        await skillEval({ skill: args.skill, tasks: args.tasks, replay: !!args.replay, from: args.from, implementer: args.implementer, repo: args.repo, json: !!args.json });
        return;
      }
      if (args.golden) {
        await goldenEval({ k: positiveInt(args.k, 'k'), replay: !!args.replay, from: args.from, out: args.out, implementer: args.implementer, repo: args.repo, json: !!args.json });
        return;
      }
      process.stderr.write('stint eval needs --skill <id> or --golden (or: stint eval add-golden <task>)\n');
      process.exit(2);
    } catch (err) {
      process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  },
});
