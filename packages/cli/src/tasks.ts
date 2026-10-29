import { readFileSync } from 'node:fs';
import type { StintEvent, Task } from '@stint-dev/core';
import { defineCommand } from 'citty';
import { getDaemon, postDaemon } from './client';
import { limitArgs, limitsFromFlags } from './limits';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

/** Title and description of a Beads issue, when the `bd` command is installed. */
export function fromBead(id: string, cwd: string): { title: string; description: string } {
  const bd = Bun.which('bd', { PATH: process.env.PATH ?? '' });
  if (!bd) throw new Error('bd is not on PATH; install Beads or give --title and --goal');
  const p = Bun.spawnSync([bd, 'show', id, '--json'], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`bd show ${id} failed: ${p.stderr.toString().trim()}`);
  const raw = JSON.parse(p.stdout.toString()) as Record<string, unknown> | Array<Record<string, unknown>>;
  const issue = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
  return { title: String(issue.title ?? id).slice(0, 120), description: String(issue.description ?? issue.title ?? id).slice(0, 2000) };
}

/**
 * A task from a spec file (R-047): its title, goal, acceptance lines and verify command. Stint building Stint
 * starts here, so the spec is the task and the daemon's tests are the spec's own.
 */
export function taskFromSpec(text: string): { title: string; goal: string; acceptance: string[]; testCommand?: string; tags: string[] } {
  const head = /^# (R-\d{3}) · (.+)$/m.exec(text);
  if (!head) throw new Error('not a spec: the first heading should read "# R-0NN · Title"');
  const section = (name: string) => new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)?.[1]?.trim() ?? '';
  const acceptance = section('Acceptance')
    .split('\n')
    .map((l) => /^\d+\.\s+(.+)$/.exec(l.trim())?.[1])
    .filter((l): l is string => !!l)
    .map((l) => l.slice(0, 300))
    .slice(0, 12);
  const verify = /```\n([^\n]+)\n/.exec(section('Verify'))?.[1]?.trim();
  return {
    title: `${head[1]}: ${head[2]}`.slice(0, 120),
    goal: (section('Goal') || head[2] as string).slice(0, 2000),
    acceptance: acceptance.length ? acceptance : [head[2] as string],
    ...(verify ? { testCommand: verify } : {}),
    tags: ['spec', head[1] as string],
  };
}

export const newTask = defineCommand({
  meta: { name: 'new', description: 'Create a task' },
  args: {
    title: { type: 'positional', required: false, description: 'What the task is, in a few words' },
    goal: { type: 'string', description: 'What done looks like (default: the title)' },
    accept: { type: 'string', description: 'Acceptance criteria, separated by ";"' },
    test: { type: 'string', description: 'The command Stint runs to verify (default: from config)' },
    'from-bead': { type: 'string', description: 'Copy the title and description from a Beads issue' },
    issue: { type: 'string', description: 'A link to the issue this task tracks' },
    spec: { type: 'string', description: 'Make the task from a spec file: its title, goal, acceptance and verify command' },
    ...limitArgs,
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const limits = limitsFromFlags(args);
    const withLimits = Object.keys(limits).length ? { limits } : {};
    if (args.spec) {
      let spec: ReturnType<typeof taskFromSpec>;
      try {
        spec = taskFromSpec(readFileSync(args.spec, 'utf8'));
      } catch (err) {
        process.stderr.write(`${args.spec}: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
      const t = await postDaemon<{ id: string }>(root, '/api/tasks', { ...spec, ...(args.test ? { testCommand: args.test } : {}), ...withLimits });
      process.stdout.write(`${t.id}\n`);
      return;
    }
    let title = args.title;
    let goal = args.goal;
    if (args['from-bead']) {
      try {
        const b = fromBead(args['from-bead'], root);
        title ??= b.title;
        goal ??= b.description;
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    }
    if (!title) {
      process.stderr.write('Give the task a title: stint new "Rate-limit incoming webhooks"\n');
      process.exit(1);
    }
    const acceptance = (args.accept ?? goal ?? title).split(';').map((s) => s.trim()).filter(Boolean);
    const t = await postDaemon<{ id: string; branch: string }>(root, '/api/tasks', {
      title,
      goal: goal ?? title,
      acceptance,
      ...(args.test ? { testCommand: args.test } : {}),
      links: { beadsId: args['from-bead'] ?? null, issueUrl: args.issue ?? null },
      ...withLimits,
    });
    process.stdout.write(`${t.id}\n`);
  },
});

export const assignTask = defineCommand({
  meta: { name: 'assign', description: 'Start a run of a task with an agent' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    agent: { type: 'positional', required: false, default: 'muse-code', description: 'muse-code, stint-agent, or an agent from config' },
    role: { type: 'string', default: 'implementer', description: 'planner, implementer or reviewer' },
    model: { type: 'string', description: 'The model, or host/model for the Stint agent' },
    ask: { type: 'string', description: 'What to ask of the agent (default: the pending ask)' },
    ...repoArg,
  },
  async run({ args }) {
    const r = await postDaemon<{ run: string; worktree: string }>(repoRoot(args.repo), `/api/tasks/${args.task}/assign`, {
      adapter: args.agent,
      role: args.role,
      ...(args.model ? { model: args.model } : {}),
      ...(args.ask ? { instruction: args.ask } : {}),
    });
    process.stdout.write(`${args.task} ${r.run} started in ${r.worktree}\n`);
  },
});

export const verifyTask = defineCommand({
  meta: { name: 'verify', description: "Have Stint run the task's tests in its worktree, or on its branch, and print the result; exits 1 when they fail" },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    run: { type: 'string', description: 'The run whose worktree to test, e.g. r2 (default: the newest)' },
    json: { type: 'boolean', description: 'Machine-readable output: the verification record' },
    ...repoArg,
  },
  async run({ args }) {
    const v = await postDaemon<{ run: string; command: string; status: string; passed: number; failed: number; durationMs: number }>(repoRoot(args.repo), `/api/tasks/${args.task}/verify`, args.run ? { run: args.run } : {});
    process.stdout.write(args.json ? `${JSON.stringify(v)}\n` : `${args.task} ${v.run} ${v.status}: ${v.passed} passed, ${v.failed} failed in ${(v.durationMs / 1000).toFixed(1)} s, run by Stint (${v.command})\n`);
    if (v.status !== 'green') process.exit(1);
  },
});

export const runTask = defineCommand({
  meta: { name: 'run', description: 'Put a task on autopilot: plan, build, verify and review, stopping at your approval' },
  args: {
    task: { type: 'positional', required: false, description: 'Task id' },
    all: { type: 'boolean', description: 'Every planned task, queued past the parallel limit; with --stop, every task' },
    stop: { type: 'boolean', description: 'Take the task off autopilot (a live run keeps going)' },
    wait: { type: 'boolean', description: 'Stay until autopilot stops; exit 0 at your approval, 3 when it needs you' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (args.all) {
      const all = await postDaemon<{ tasks: string[] }>(root, '/api/autopilot', { on: !args.stop });
      process.stdout.write(args.stop ? 'Every task is off autopilot.\n' : all.tasks.length ? `${all.tasks.join(', ')} on autopilot. Each stops at your approval.\n` : 'No task is planned, so nothing went on autopilot.\n');
      return;
    }
    if (!args.task) {
      process.stderr.write('Name a task, or give --all for every planned task: stint run T-0001\n');
      process.exit(2);
    }
    const r = await postDaemon<{ running: string[]; queued: string[] }>(root, `/api/tasks/${args.task}/autopilot`, { on: !args.stop });
    if (args.stop) {
      process.stdout.write(`${args.task} is off autopilot.\n`);
      return;
    }
    process.stdout.write(`${args.task} is on autopilot${r.queued.includes(args.task) ? ', queued behind ' + r.running.join(', ') : ''}. It stops at your approval.\n`);
    if (!args.wait) return;
    const stop = await waitForStop(root, args.task);
    process.stdout.write(`${args.task}: ${stop.reason}\n`);
    // approval is the person's: waiting ends at the gate and never passes it
    process.exit(stop.needsYou ? 3 : 0);
  },
});

export const listTasks = defineCommand({
  meta: { name: 'list', description: 'Every task with its status and title' },
  args: { json: { type: 'boolean', description: 'Machine-readable output: each task as task.json has it' }, ...repoArg },
  async run({ args }) {
    const { tasks } = await getDaemon<{ tasks: Array<{ task: Task }> }>(repoRoot(args.repo), '/api/tasks');
    if (args.json) process.stdout.write(`${JSON.stringify(tasks.map((c) => c.task))}\n`);
    else if (!tasks.length) process.stdout.write('No tasks yet. Make one with: stint new "<title>"\n');
    else for (const { task: t } of tasks) process.stdout.write(`${t.id}  ${t.status.padEnd(17)}  ${t.title}\n`);
  },
});

/** Polls the task's log until autopilot has stopped, and returns why. */
export async function waitForStop(root: string, task: string, everyMs = 2_000): Promise<{ reason: string; needsYou: boolean }> {
  for (;;) {
    const { events } = await getDaemon<{ events: StintEvent[] }>(root, `/api/tasks/${task}/events`);
    const last = events.filter((e) => e.type === 'autopilot.started' || e.type === 'autopilot.stopped').at(-1);
    if (last?.type === 'autopilot.stopped') return { reason: String(last.payload.reason ?? ''), needsYou: !!last.payload.needsYou };
    await Bun.sleep(everyMs);
  }
}
