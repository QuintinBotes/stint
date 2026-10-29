import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_RECORDING, formatClock, loadRecording, parseClock, startDaemon } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { BEATS, type Beat, runLiveDemo } from './demo/live';
import { recordWorkspace } from './demo/record';
import { seedDemo, seedDemoConfig } from './demo/seed';
import { repoRoot } from './repo';
import { readSSE } from './sse';
import { keepAwake } from './awake';

const FIXTURE_BUNDLE = join(import.meta.dir, '..', '..', '..', 'demo', 'repo.bundle');

/** A fresh clone of the demo fixture: every replay starts from the same state. */
export function freshFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stint-demo-'));
  const r = Bun.spawnSync(['git', 'clone', '-q', FIXTURE_BUNDLE, dir], { stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`cannot clone the demo fixture: ${r.stderr.toString()}`);
  return dir;
}

type StreamEvent = { task: string; seq: number; type: string; run?: string; adapter?: string; payload: { replayAt?: number; beat?: string; [k: string]: unknown } };

export const demo = defineCommand({
  meta: { name: 'demo', description: 'Replay the demo (no keys needed), or seed, run it live, and record a live run' },
  args: {
    action: { type: 'positional', description: 'seed or record; omit to replay (or pass --live)', required: false },
    speed: { type: 'string', description: '1 is real time, 0 is instant', default: '1' },
    from: { type: 'string', description: 'Replay: start at mm:ss (earlier events are applied silently). --live: start pausing at a beat (plan, build, hand, review, approve, next)', default: '0:00' },
    path: { type: 'string', description: 'Recording file (default demo/recording.jsonl)' },
    keep: { type: 'boolean', description: 'Keep the daemon running for the UI after the replay ends' },
    open: { type: 'boolean', description: 'Open the UI in the browser' },
    json: { type: 'boolean', description: 'One JSON line per event, then a summary line' },
    live: { type: 'boolean', description: 'Run the beats live through the daemon with real models' },
    auto: { type: 'boolean', description: 'Do not pause for Enter between beats (--live)' },
    'allow-online': { type: 'boolean', description: 'Let the review beat run online on the hosted chain (--live)' },
    'kill-after': { type: 'string', description: 'Seconds after the first src/ change before the kill (--live)', default: '6' },
    'no-eval': { type: 'boolean', description: 'Approve the proposed skill without measuring it first (--live)' },
    take: { type: 'string', description: 'Record the finished live run as take n under demo/recordings (--live)' },
    'offline-plan': { type: 'boolean', description: 'Plan on the local model instead of the hosted chain (--live)' },
    repo: { type: 'string', description: 'Repository for seed and record (default: the git top level)' },
    out: { type: 'string', description: 'Recording file to write (record)' },
  },
  async run({ args }) {
    const outLine = (s: string) => process.stdout.write(`${s}\n`);
    const fail = (err: unknown): never => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    };
    if (args.action === 'seed') {
      try {
        const root = args.repo ? resolve(args.repo) : repoRoot();
        const r = await seedDemo(root);
        for (const id of r.created) outLine(`Seeded ${id} in ${root}.`);
        for (const id of r.existing) outLine(`${id} already exists in ${root}; left as it was.`);
        outLine(`T-0040 merge: ${r.merge.slice(0, 12)} (Stint-Task: T-0040)`);
        return;
      } catch (err) {
        fail(err);
      }
    }
    if (args.action === 'record') {
      if (!args.repo || !args.out) {
        process.stderr.write('stint demo record needs --repo <path> and --out <file>\n');
        process.exit(2);
      }
      try {
        const r = await recordWorkspace({ repo: args.repo, out: args.out });
        outLine(`Wrote ${r.out}: ${r.events} events, ${r.patches.length} patches, live ${r.header.live}.`);
        outLine(`Replay it with: stint demo --path ${r.out}`);
        return;
      } catch (err) {
        fail(err);
      }
    }
    if (args.action) {
      process.stderr.write(`stint demo has no action ${args.action}; use seed, record, --live, or no action to replay\n`);
      process.exit(2);
    }
    if (args.live) {
      try {
        const killAfter = Number(args['kill-after']);
        keepAwake();
        const from = args.from && args.from !== '0:00' ? args.from : undefined;
        if (from && !(BEATS as readonly string[]).includes(from)) throw new Error(`--from with --live names a beat: ${BEATS.join(', ')}`);
        const take = args.take !== undefined ? Number(args.take) : undefined;
        if (take !== undefined && (!Number.isInteger(take) || take < 1)) throw new Error('--take is a take number, such as 2');
        await runLiveDemo({
          auto: args.auto,
          allowOnline: args['allow-online'],
          killAfterSeconds: Number.isFinite(killAfter) ? killAfter : 6,
          noEval: args['no-eval'],
          ...(from ? { from: from as Beat } : {}),
          ...(args['offline-plan'] ? { offlinePlan: true } : {}),
          ...(take ? { take: { n: take, repo: args.repo ? resolve(args.repo) : repoRoot() } } : {}),
        });
        return;
      } catch (err) {
        fail(err);
      }
    }
    const path = args.path ?? DEFAULT_RECORDING;
    const rec = loadRecording(path);
    const from = parseClock(args.from);
    const speed = Number(args.speed);
    const out = (s: string) => process.stdout.write(`${s}\n`);
    const header = { version: rec.header.version, title: rec.header.title, recordedAt: rec.header.recordedAt, live: rec.header.live, events: rec.lines.length };
    if (args.json) out(JSON.stringify(header));
    else out(`${rec.header.live ? `Replay of a live run on ${rec.header.recordedAt.slice(0, 10)}` : 'Replay, hand-written'}: ${rec.header.title}`);

    const root = freshFixture();
    await seedDemoConfig(root);
    const d = await startDaemon({ root, quiet: true, handleSignals: Boolean(args.keep), autoReview: true });
    if (!args.json) out(`Watch it at ${d.url}`);
    if (args.open) {
      const opener = process.platform === 'darwin' ? 'open' : Bun.which('xdg-open') ? 'xdg-open' : null;
      if (opener) Bun.spawn([opener, d.url], { stdout: 'ignore', stderr: 'ignore' });
    }
    const stream = new AbortController();
    let printed = 0;
    let lastAt = 0;
    const consume = (async () => {
      for await (const m of readSSE(`${d.url}/api/stream`, stream.signal)) {
        if (m.event === 'heartbeat') continue;
        const e = JSON.parse(m.data) as StreamEvent;
        const at = e.payload.replayAt ?? 0;
        if (at < from) continue;
        lastAt = at;
        printed++;
        if (args.json) {
          out(JSON.stringify({ at: formatClock(at), task: e.task, seq: e.seq, type: e.type, ...(e.run ? { run: e.run } : {}), ...(e.adapter ? { adapter: e.adapter } : {}), ...(e.payload.beat ? { beat: e.payload.beat } : {}), ...(e.type === 'human.command' ? { command: e.payload.command } : {}), ...(e.type === 'run.finished' ? { endedBy: e.payload.endedBy } : {}) }));
        } else if (e.payload.beat) {
          out(`${formatClock(at).padStart(5)}  ${e.payload.beat}`);
        }
      }
    })();

    const auth = { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' };
    await Bun.sleep(50);
    const play = await fetch(`${d.url}/api/demo/play`, { method: 'POST', headers: auth, body: JSON.stringify({ path, speed, from: args.from }) });
    if (play.status !== 202) {
      process.stderr.write(`could not start the replay: ${await play.text()}\n`);
      await d.stop();
      rmSync(root, { recursive: true, force: true });
      process.exit(1);
    }
    let status = { playing: true, done: false, total: 0 };
    while (status.playing) {
      await Bun.sleep(100);
      status = (await (await fetch(`${d.url}/api/demo/status`)).json()) as typeof status;
    }
    await Bun.sleep(150);
    stream.abort();
    await consume.catch(() => undefined);
    const tasks = (await (await fetch(`${d.url}/api/tasks`)).json()) as { tasks: Array<{ task: { id: string; status: string }; cost: { usd: number | null } }> };
    const summary = { done: status.done, printed, lastAt: formatClock(lastAt), tasks: tasks.tasks.map((t) => ({ id: t.task.id, status: t.task.status, usd: t.cost.usd })), url: d.url };
    if (args.json) out(JSON.stringify(summary));
    else out(`\nReplay ${status.done ? 'finished' : 'stopped'}: ${summary.tasks.map((t) => `${t.id} ${t.status} $${(t.usd ?? 0).toFixed(2)}`).join(', ')}`);
    if (args.keep) {
      out(`The daemon keeps running at ${d.url} (Ctrl-C to stop).`);
      return;
    }
    await d.stop();
    rmSync(root, { recursive: true, force: true });
    process.exit(status.done ? 0 : 1);
  },
});
