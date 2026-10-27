import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { Workspace, runsFromEvents } from '@stint-dev/core/node';
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

/**
 * The export for Entire and tools like it, which index agent sessions by commit: the latest packet beside a
 * checkpoint-style pairing of the task's commit with the runs that wrote it. The pairing is Stint's own format.
 */
export async function exportEntire(root: string, id: string, out: string): Promise<string[]> {
  const ws = await Workspace.open(root);
  const task = await ws.readTask(id);
  const packet = await ws.handoffs(id).latest();
  if (!packet) throw new Error(`${id} has no packet yet; one is written when a run ends`);
  const signoffPath = join(await ws.taskDir(id), 'signoff.json');
  const signoff = existsSync(signoffPath) ? (JSON.parse(readFileSync(signoffPath, 'utf8')) as { by?: string; at?: string; commit?: string }) : null;
  const head = Bun.spawnSync(['git', 'rev-parse', '--verify', '-q', `refs/heads/${task.branch}`], { cwd: root, stdout: 'pipe' }).stdout.toString().trim();
  const pairing = {
    version: 'stint.checkpoint/1',
    task: { id, title: task.title, status: task.status, branch: task.branch },
    // the merge commit once approved, else where the task branch stands
    commit: signoff?.commit ?? (head || null),
    merged: signoff ? { by: signoff.by ?? null, at: signoff.at ?? null } : null,
    packet: { file: 'packet.json', hash: packet.hash },
    sessions: runsFromEvents(await ws.events(id).read()).map((r) => ({ run: r.run, agent: r.adapter, role: r.role, model: r.model, host: r.host, startedAt: r.startedAt, endedAt: r.endedAt, endedBy: r.endedBy, continuedFrom: r.handoffFrom })),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(join(out, 'checkpoint.json'), `${JSON.stringify(pairing, null, 2)}\n`);
  return ['packet.json', 'checkpoint.json'];
}

export const exportTask = defineCommand({
  meta: { name: 'export', description: 'Write a task folder as a zip, or its packet and commit pairing for Entire' },
  args: {
    task: { type: 'positional', required: true, description: 'Task id' },
    format: { type: 'string', default: 'zip', description: 'zip (the task folder) or entire (packet.json and checkpoint.json)' },
    out: { type: 'string', description: 'Output path (default: <task>.zip, or <task>-entire/)' },
    ...repoArg,
  },
  async run({ args }) {
    const root = repoRoot(args.repo);
    if (args.format !== 'zip' && args.format !== 'entire') {
      process.stderr.write(`Unknown format ${args.format}; use zip or entire.\n`);
      process.exit(1);
    }
    if (args.format === 'entire') {
      const out = resolve(args.out ?? `${args.task}-entire`);
      try {
        const files = await exportEntire(root, args.task, out);
        process.stdout.write(`Wrote ${files.map((f) => join(out, f)).join(', ')}\n`);
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
      return;
    }
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
