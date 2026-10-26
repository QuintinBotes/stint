import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StintEvent } from '@stint-dev/core';
import { Workspace } from '@stint-dev/core/node';
import { type RecordingHeader, type RecordingLine, git, gitOk } from '@stint-dev/daemon';
import { scrubPaths } from '../bench/live';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Beat titles from docs/demo.md, keyed by the first live event that opens the beat. */
function beatFor(e: StintEvent, seen: Set<string>): string | undefined {
  const role = str(e.payload.role);
  let beat: string | undefined;
  if (e.type === 'task.created') beat = 'The folder is the task';
  else if (e.type === 'run.started' && role === 'planner') beat = 'Speak the task';
  else if (e.type === 'run.started' && role === 'implementer' && e.adapter === 'muse-code') beat = 'Muse Code builds';
  else if (e.type === 'run.finished' && e.payload.endedBy === 'killed') beat = 'Kill it';
  else if (e.type === 'run.started' && e.adapter === 'stint-agent') beat = 'A different agent finishes';
  else if (e.type === 'run.started' && role === 'reviewer') beat = 'Review offline';
  else if (e.type === 'approval.granted') beat = 'Approve and merge';
  else if (e.type === 'skill.proposed' || e.type === 'skill.approved') beat = 'It learned';
  if (!beat || seen.has(beat)) return undefined;
  seen.add(beat);
  return beat;
}

async function isAncestor(root: string, commit: string, base: string): Promise<boolean> {
  if (!commit || !base) return false;
  return (await git(root, ['merge-base', '--is-ancestor', commit, base])).code === 0;
}

async function commitMeta(root: string, commit: string): Promise<{ message: string; date: string } | null> {
  const r = await git(root, ['log', '-1', '--format=%B%x00%cI', commit]);
  if (r.code !== 0) return null;
  const [message, date] = r.stdout.split('\0');
  return { message: (message ?? '').replace(/\n+$/, '\n'), date: (date ?? '').trim() };
}

async function stintCommit(): Promise<string | undefined> {
  const root = join(import.meta.dir, '..', '..', '..', '..');
  const r = await git(root, ['rev-parse', 'HEAD']);
  const sha = r.stdout.trim();
  return r.code === 0 && sha ? sha : undefined;
}

export type RecordOptions = { repo: string; out: string; title?: string };
export type RecordResult = { out: string; events: number; patches: string[]; header: RecordingHeader };

/**
 * Turns a finished live workspace into a stint.recording/1 file: every task's events in
 * timestamp order with real offsets, patches for run commits beside the recording, merges
 * as merge steps, and local paths scrubbed. A commit the replay base already contains (the
 * seeded T-0040 history in the fixture) gets no apply step: a fresh fixture already has it.
 */
export async function recordWorkspace(o: RecordOptions): Promise<RecordResult> {
  const repo = resolve(o.repo);
  const out = resolve(o.out);
  const ws = await Workspace.open(repo);
  const tasks = await ws.listTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const all: StintEvent[] = [];
  for (const t of tasks) all.push(...(await ws.events(t.id).read()));
  all.sort((a, b) => a.ts.localeCompare(b.ts) || a.task.localeCompare(b.task) || a.seq - b.seq);
  if (all.length === 0) throw new Error(`${repo} has no task events to record`);
  const t0 = Date.parse((all[0] as StintEvent).ts);
  const patchesDir = join(dirname(out), 'patches');
  await mkdir(patchesDir, { recursive: true });
  await mkdir(dirname(out), { recursive: true });

  const patches: string[] = [];
  const seenBeats = new Set<string>();
  const lines: RecordingLine[] = [];
  for (const [i, e] of all.entries()) {
    let payload = e.payload;
    if (e.type === 'skill.proposed' && !('proposal' in payload)) {
      const file = join(ws.cacheDir, 'proposals', `${str(payload.id)}.json`);
      if (str(payload.id) && existsSync(file)) {
        payload = { ...payload, proposal: JSON.parse(await readFile(file, 'utf8')) as unknown };
      }
    }
    const line: RecordingLine = { ...e, payload, at: Math.max(0, Date.parse(e.ts) - t0) };
    const beat = beatFor(e, seenBeats) ?? (i === all.length - 1 && !seenBeats.has('Close') ? 'Close' : undefined);
    if (beat) {
      line.beat = beat;
      seenBeats.add(beat);
    }
    const task = byId.get(e.task);
    if (e.type === 'run.finished' && str(e.payload.commit) && task) {
      const commit = str(e.payload.commit);
      if (!(await isAncestor(repo, commit, task.baseCommit))) {
        const meta = await commitMeta(repo, commit);
        // the diff only: format-patch's mail header names the commit's author (a real name and address),
        // and the replay commits with its own fixed identity anyway
        const full = await gitOk(repo, ['format-patch', '-1', '--stdout', commit]);
        const at = full.indexOf('diff --git');
        const patch = at >= 0 ? full.slice(at).replace(/\n-- \n[^\n]*\n?$/, '\n') : '';
        const name = `${e.task}-${e.run ?? 'run'}-${commit.slice(0, 12)}.patch`;
        await Bun.write(join(patchesDir, name), scrubPaths(patch));
        patches.push(name);
        line.apply = { kind: 'commit', branch: task.branch, patch: `patches/${name}`, message: meta?.message.trim() ?? `wip(${e.task} ${e.run ?? ''})`, date: meta?.date ?? e.ts };
      }
    } else if (e.type === 'merge.completed' && task) {
      const commit = str(e.payload.commit);
      if (!(await isAncestor(repo, commit, task.baseCommit))) {
        const meta = commit ? await commitMeta(repo, commit) : null;
        line.apply = {
          kind: 'merge',
          branch: str(e.payload.branch) || task.branch,
          into: str(e.payload.into) || 'main',
          message: meta?.message.trim() ?? `${task.title} (${task.id})`,
          date: meta?.date ?? e.ts,
        };
      }
    }
    lines.push(line);
  }

  const commit = await stintCommit();
  const header: RecordingHeader = {
    version: 'stint.recording/1',
    title: o.title ?? 'Stint: one task, four agents, three survivals (live)',
    recordedAt: (all[0] as StintEvent).ts,
    live: true,
    ...(commit ? { commit } : {}),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      goal: t.goal,
      acceptance: t.acceptance,
      testCommand: t.testCommand,
      status: t.status,
      ...(t.tags ? { tags: t.tags } : {}),
    })),
  };
  const text = `${[header, ...lines].map((l) => JSON.stringify(l)).join('\n')}\n`;
  await Bun.write(out, scrubPaths(text));
  return { out, events: lines.length, patches: patches.map((p) => join('patches', p)), header };
}
