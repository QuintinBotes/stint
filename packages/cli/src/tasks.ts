import { defineCommand } from 'citty';
import { postDaemon } from './client';
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

export const newTask = defineCommand({
  meta: { name: 'new', description: 'Create a task' },
  args: {
    title: { type: 'positional', required: false, description: 'What the task is, in a few words' },
    goal: { type: 'string', description: 'What done looks like (default: the title)' },
    accept: { type: 'string', description: 'Acceptance criteria, separated by ";"' },
    test: { type: 'string', description: 'The command Stint runs to verify (default: from config)' },
    'from-bead': { type: 'string', description: 'Copy the title and description from a Beads issue' },
    issue: { type: 'string', description: 'A link to the issue this task tracks' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
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

export const runTask = defineCommand({
  meta: { name: 'run', description: 'Put a task on autopilot: plan, build, verify and review, stopping at your approval' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    stop: { type: 'boolean', description: 'Take the task off autopilot (a live run keeps going)' },
    ...repoArg,
  },
  async run({ args }) {
    const r = await postDaemon<{ running: string[]; queued: string[] }>(repoRoot(args.repo), `/api/tasks/${args.task}/autopilot`, { on: !args.stop });
    if (args.stop) process.stdout.write(`${args.task} is off autopilot.\n`);
    else process.stdout.write(`${args.task} is on autopilot${r.queued.includes(args.task) ? ', queued behind ' + r.running.join(', ') : ''}. It stops at your approval.\n`);
  },
});
