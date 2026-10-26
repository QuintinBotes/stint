import { mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { parseTrailers } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { postDaemon } from './client';
import { repoRoot } from './repo';

const repoArg = { repo: { type: 'string', description: 'Repository root (default: the git top level)' } } as const;

export const approve = defineCommand({
  meta: { name: 'approve', description: 'Merge a task into the checked-out branch, with Stint trailers' },
  args: { task: { type: 'positional', required: true, description: 'Task id' }, squash: { type: 'boolean', description: 'One commit instead of a merge commit' }, ...repoArg },
  async run({ args }) {
    const r = await postDaemon<{ commit: string; into: string }>(repoRoot(args.repo), `/api/tasks/${args.task}/approve`, { squash: !!args.squash });
    process.stdout.write(`Merged ${args.task} into ${r.into} as ${r.commit.slice(0, 12)}.\n`);
  },
});

export const reject = defineCommand({
  meta: { name: 'reject', description: 'Send a task back; the reason becomes a decision and the next ask' },
  args: { task: { type: 'positional', required: true, description: 'Task id' }, reason: { type: 'string', required: true, description: 'Why it is rejected' }, ...repoArg },
  async run({ args }) {
    const r = await postDaemon<{ decision: string }>(repoRoot(args.repo), `/api/tasks/${args.task}/reject`, { reason: args.reason });
    process.stdout.write(`${args.task} is back to building; the reason is ${r.decision} and the next run's ask.\n`);
  },
});

/** The task, runs and packet a merge commit came from, read from its trailers. */
export async function showCommit(root: string, commit: string): Promise<string> {
  const p = Bun.spawnSync(['git', 'log', '-1', '--format=%B', commit], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git cannot find ${commit}: ${p.stderr.toString().trim()}`);
  const t = parseTrailers(p.stdout.toString());
  const id = t['Stint-Task'];
  if (!id) throw new Error(`${commit} has no Stint-Task trailer`);
  const ws = await Workspace.open(root);
  const dir = await ws.taskDir(id);
  let packet = 'not found';
  for (const name of await ws.handoffs(id).names()) {
    if ((await ws.handoffs(id).read(name))?.hash === t['Stint-Handoff']) packet = relative(root, join(dir, 'handoffs', `${name}.json`));
  }
  const task = await ws.readTask(id);
  return [`Task: ${id} ${task.title}`, `Runs: ${t['Stint-Runs'] ?? 'none'}`, `Packet: ${packet} (${t['Stint-Handoff'] ?? 'none'})`, `Verified: ${t['Stint-Verified'] ?? 'none'}`, ''].join('\n');
}

export const show = defineCommand({
  meta: { name: 'show', description: 'Show the task a merge commit came from' },
  args: { commit: { type: 'positional', required: true, description: 'Commit, e.g. HEAD' }, ...repoArg },
  async run({ args }) {
    try {
      process.stdout.write(await showCommit(repoRoot(args.repo), args.commit));
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  },
});

export const exportTask = defineCommand({
  meta: { name: 'export', description: 'Write a task folder as a zip' },
  args: { task: { type: 'positional', required: true, description: 'Task id' }, out: { type: 'string', description: 'Output path (default: <task>.zip)' }, ...repoArg },
  async run({ args }) {
    const root = repoRoot(args.repo);
    const dir = await (await Workspace.open(root)).taskDir(args.task);
    const out = resolve(args.out ?? `${args.task}.zip`);
    mkdirSync(dirname(out), { recursive: true });
    // worktrees and caches live outside the task folder, so the zip is the task's record only
    const z = Bun.spawnSync(['zip', '-qr', out, '.'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    if (z.exitCode !== 0) {
      process.stderr.write(`zip failed: ${z.stderr.toString().trim()}\n`);
      process.exit(1);
    }
    process.stdout.write(`Wrote ${out}\n`);
  },
});
