import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Handoff,
  HandoffSchema,
  type Plan,
  type Review,
  type StintEvent,
  StintEventSchema,
  type Workspace,
} from '@stint-dev/core/node';
import { DaemonError } from './errors';
import { git, gitOk } from './git';

export type RecordingTask = {
  id: string;
  title: string;
  goal: string;
  acceptance: string[];
  testCommand: string;
  status?: string;
  tags?: string[];
};

export type RecordingHeader = {
  version: 'stint.recording/1';
  title: string;
  recordedAt: string;
  live: boolean;
  commit?: string;
  tasks: RecordingTask[];
};

/** A git effect the replay reproduces so the diff and the merge are real, with fixed identity and dates. */
export type ApplyStep =
  | { kind: 'commit'; branch: string; patch: string; message: string; date: string }
  | { kind: 'merge'; branch: string; into: string; message: string; date: string };

export type RecordingLine = Omit<StintEvent, 'prev' | 'hash'> & {
  prev?: string;
  hash?: string;
  /** ms from the start of the recording */
  at: number;
  pause?: boolean;
  beat?: string;
  apply?: ApplyStep;
};

export type Recording = { header: RecordingHeader; lines: RecordingLine[]; path: string };

const IDENTITY = { name: 'Stint Demo', email: 'demo@example.com' };

/** Reads a `stint.recording/1` file: a header line, then events with `at` offsets. Every event must validate. */
export function loadRecording(path: string): Recording {
  const rows = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const header = JSON.parse(rows[0] ?? '{}') as RecordingHeader;
  if (header.version !== 'stint.recording/1') throw new DaemonError('invalid', `${path} is not a stint.recording/1 file`);
  const lines = rows.slice(1).map((row, i) => {
    const line = JSON.parse(row) as RecordingLine;
    const { at: _at, pause: _p, beat: _b, apply: _a, ...event } = line;
    const r = StintEventSchema.safeParse(event);
    if (!r.success) throw new DaemonError('invalid', `recording line ${i + 2} is not a valid event`, r.error.issues);
    if (typeof line.at !== 'number') throw new DaemonError('invalid', `recording line ${i + 2} has no at`);
    return line;
  });
  return { header, lines, path };
}

export function parseClock(s: string | number | undefined): number {
  if (s === undefined) return 0;
  if (typeof s === 'number') return s;
  const m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(s);
  if (!m) return Number(s) || 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] ?? '0').padEnd(3, '0').slice(0, 3));
}

export const formatClock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

export type ReplayStatus = { playing: boolean; paused: boolean; at: number; total: number; title: string | null; live: boolean | null; recordedAt: string | null; done: boolean };
export type Emitted = { line: RecordingLine; event: StintEvent; silent: boolean };

/**
 * Plays a recording through the normal event log, so hashes, SSE and projections are real. Events before
 * `from` are applied instantly and silently; `speed: 0` plays everything instantly.
 */
export class Replayer {
  private rec: Recording | null = null;
  private status: ReplayStatus = { playing: false, paused: false, at: 0, total: 0, title: null, live: null, recordedAt: null, done: false };
  private resume: (() => void) | null = null;
  private stopped = false;
  private listeners = new Set<(e: Emitted) => void>();

  constructor(private readonly ws: Workspace) {}

  get loaded(): Recording | null {
    return this.rec;
  }

  load(path: string): Recording {
    this.rec = loadRecording(path);
    const last = this.rec.lines.at(-1)?.at ?? 0;
    this.status = { ...this.status, total: last, title: this.rec.header.title, live: this.rec.header.live, recordedAt: this.rec.header.recordedAt, at: 0, done: false };
    return this.rec;
  }

  onEmit(cb: (e: Emitted) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getStatus(): ReplayStatus {
    return { ...this.status };
  }

  pause(): void {
    this.status.paused = true;
  }

  continue(): void {
    this.status.paused = false;
    const r = this.resume;
    this.resume = null;
    r?.();
  }

  stop(): void {
    this.stopped = true;
    this.continue();
  }

  async play(o: { speed?: number; from?: number; until?: number } = {}): Promise<ReplayStatus> {
    const rec = this.rec;
    if (!rec) throw new DaemonError('invalid', 'no recording is loaded');
    if (this.status.playing) throw new DaemonError('run_active', 'the replay is already playing');
    for (const t of rec.header.tasks) {
      if ((await this.ws.listTasks()).some((x) => x.id === t.id)) {
        throw new DaemonError('invalid', `${t.id} already exists in this workspace`, 'replay into a fresh copy of the fixture (stint demo does this)');
      }
    }
    const speed = o.speed ?? 1;
    const from = o.from ?? 0;
    this.stopped = false;
    this.status = { ...this.status, playing: true, paused: false, done: false };
    const t0 = Date.now();
    try {
      for (const line of rec.lines) {
        if (this.stopped || (o.until !== undefined && line.at > o.until)) break;
        const silent = line.at < from;
        if (!silent && speed > 0) {
          const due = t0 + (line.at - from) / speed;
          while (Date.now() < due && !this.stopped) await Bun.sleep(Math.min(250, due - Date.now()));
        }
        if (!silent && line.pause && speed > 0) {
          this.status.paused = true;
        }
        while (this.status.paused && !this.stopped) {
          await new Promise<void>((r) => {
            this.resume = r;
          });
        }
        if (this.stopped) break;
        const event = await this.apply(rec.header, line);
        this.status.at = line.at;
        for (const l of this.listeners) l({ line, event, silent });
      }
      this.status.done = !this.stopped && (o.until === undefined || (rec.lines.at(-1)?.at ?? 0) <= o.until);
    } finally {
      this.status.playing = false;
    }
    return this.getStatus();
  }

  private async apply(header: RecordingHeader, line: RecordingLine): Promise<StintEvent> {
    const ws = this.ws;
    const id = line.task;
    if (line.type === 'task.created') {
      const t = header.tasks.find((x) => x.id === id);
      const p = line.payload as Partial<RecordingTask>;
      await ws.createTask(
        {
          id,
          title: t?.title ?? String(p.title),
          goal: t?.goal ?? String(p.goal),
          acceptance: t?.acceptance ?? (p.acceptance as string[]),
          testCommand: t?.testCommand ?? String(p.testCommand ?? 'bun run test'),
          ...(t?.tags ? { tags: t.tags } : {}),
        },
        { emit: false },
      );
      if (t?.status && t.status !== 'planned') await ws.writeTask(id, { status: t.status as never }, undefined, { emit: false });
    }
    if (line.apply) await this.applyGit(id, line.apply);
    const event = await ws.events(id).append({
      task: id,
      type: line.type,
      payload: { ...line.payload, replay: true, replayAt: line.at, ...(line.beat ? { beat: line.beat } : {}) },
      ...(line.run ? { run: line.run } : {}),
      ...(line.adapter ? { adapter: line.adapter } : {}),
      ...(line.vendor ? { vendor: line.vendor } : {}),
      ...(line.links ? { links: line.links } : {}),
    });
    await this.project(id, line);
    return event;
  }

  /** The files a live daemon would have written for this event: plan, packet, review, verification, decisions, status. */
  private async project(id: string, line: RecordingLine): Promise<void> {
    const ws = this.ws;
    const p = line.payload;
    switch (line.type) {
      case 'task.status':
        await ws.writeTask(id, { status: p.to as never }, undefined, { emit: false });
        break;
      case 'run.started':
        if (line.run) {
          await ws.runs(id).create({
            run: line.run,
            adapter: line.adapter ?? 'replay',
            vendor: line.vendor ?? 'local',
            role: p.role as never,
            ...(typeof p.model === 'string' ? { model: p.model } : {}),
            ...(typeof p.host === 'string' ? { host: p.host } : {}),
            ...(typeof p.handoffFrom === 'string' ? { handoffFrom: p.handoffFrom } : {}),
            startedAt: new Date().toISOString(),
          });
          await ws.writeTask(id, { assignee: { adapter: line.adapter ?? 'replay', role: p.role as never, run: line.run, ...(typeof p.model === 'string' ? { model: p.model } : {}) } }, undefined, { emit: false });
        }
        break;
      case 'run.finished':
        if (line.run && (await ws.runs(id).find(line.run))) {
          await ws.runs(id).updateMeta(line.run, { endedAt: new Date().toISOString(), endedBy: p.endedBy as never, cost: p.cost as never, ...(typeof p.sessionId === 'string' ? { sessionId: p.sessionId } : {}) });
        }
        if (p.plan) await ws.writePlan(id, p.plan as Plan);
        break;
      case 'verification.ran':
        if (line.run) {
          await ws.verification(id).write({
            run: line.run,
            command: String(p.command),
            exitCode: Number(p.exitCode),
            passed: Number(p.passed),
            failed: Number(p.failed),
            durationMs: Number(p.durationMs),
            runBy: 'daemon',
            status: p.status === 'green' ? 'green' : 'red',
            outputRef: `verification/${line.run}.out.txt`,
            at: new Date().toISOString(),
          });
        }
        break;
      case 'handoff.created':
        if (p.packet) await ws.handoffs(id).write(HandoffSchema.parse(p.packet) as Handoff, p.meta);
        break;
      case 'review.recorded':
        if (p.review) await ws.writeReview(id, p.review as Review);
        break;
      case 'decision.recorded':
        await ws.decisions(id).append({
          text: String(p.text),
          by: String(p.by ?? `${line.adapter ?? 'human'} ${line.run ?? ''}`),
          ...(typeof p.supersedes === 'string' ? { supersedes: p.supersedes } : {}),
          ...(Array.isArray(p.evidence) ? { evidence: p.evidence as string[] } : {}),
        });
        break;
      default:
        break;
    }
  }

  private async applyGit(id: string, step: ApplyStep): Promise<void> {
    const root = this.ws.root;
    if (step.kind === 'commit' && (await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${step.branch}`])).code !== 0) {
      // a task whose branch does not exist yet starts from where the base branch is now
      const head = (await gitOk(root, ['rev-parse', 'HEAD'])).trim();
      const task = await this.ws.readTask(id);
      if (head !== task.baseCommit) await this.ws.writeTask(id, { baseCommit: head }, undefined, { emit: false });
    }
    await applyGitStep(root, step);
  }
}

function stepEnv(date: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

/**
 * One git effect of a recording, deterministic: fixed identity and dates, so the commit ids the replay makes
 * are the ones the recording's packets name. Returns the branch head after the step.
 */
export async function applyGitStep(root: string, step: ApplyStep): Promise<string> {
  const env = stepEnv(step.date);
  if (step.kind === 'merge') {
    const current = (await gitOk(root, ['branch', '--show-current'])).trim();
    if (current !== step.into) await gitOk(root, ['checkout', '-q', step.into]);
    const r = await git(root, ['merge', '-q', '--no-ff', step.branch, '-m', step.message], env);
    if (r.code !== 0) throw new DaemonError('merge_conflict', `replayed merge of ${step.branch} failed: ${r.stderr.trim()}`);
    return (await gitOk(root, ['rev-parse', 'HEAD'])).trim();
  }
  if ((await git(root, ['rev-parse', '--verify', '-q', `refs/heads/${step.branch}`])).code !== 0) {
    await gitOk(root, ['branch', step.branch, 'HEAD']);
  }
  const current = (await gitOk(root, ['branch', '--show-current'])).trim();
  let dir = root;
  let temp: string | null = null;
  if (current !== step.branch) {
    temp = mkdtempSync(join(tmpdir(), 'stint-replay-'));
    rmSync(temp, { recursive: true, force: true });
    await gitOk(root, ['worktree', 'add', '-q', temp, step.branch]);
    dir = temp;
  }
  try {
    const patch = Bun.spawn(['git', 'apply', '--whitespace=nowarn', '-'], { cwd: dir, stdin: 'pipe', stderr: 'pipe' });
    patch.stdin.write(step.patch);
    patch.stdin.end();
    if ((await patch.exited) !== 0) throw new DaemonError('invalid', `replayed patch does not apply: ${await new Response(patch.stderr).text()}`);
    await gitOk(dir, ['add', '-A']);
    const r = await git(dir, ['commit', '-q', '--no-verify', '-m', step.message], env);
    if (r.code !== 0) throw new DaemonError('invalid', `replayed commit failed: ${r.stderr.trim()}`);
    return (await gitOk(dir, ['rev-parse', 'HEAD'])).trim();
  } finally {
    if (temp) await git(root, ['worktree', 'remove', temp]);
  }
}
