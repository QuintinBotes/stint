import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RECORDING, formatClock, loadRecording, parseClock, startDaemon } from '@stint-dev/daemon';
import { defineCommand } from 'citty';
import { readSSE } from './sse';

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
  meta: { name: 'demo', description: 'Replay the demo through a daemon on a fresh copy of the fixture; no keys needed' },
  args: {
    speed: { type: 'string', description: '1 is real time, 0 is instant', default: '1' },
    from: { type: 'string', description: 'Start at mm:ss (earlier events are applied silently)', default: '0:00' },
    path: { type: 'string', description: 'Recording file (default demo/recording.jsonl)' },
    keep: { type: 'boolean', description: 'Keep the daemon running for the UI after the replay ends' },
    open: { type: 'boolean', description: 'Open the UI in the browser' },
    json: { type: 'boolean', description: 'One JSON line per event, then a summary line' },
  },
  async run({ args }) {
    const path = args.path ?? DEFAULT_RECORDING;
    const rec = loadRecording(path);
    const from = parseClock(args.from);
    const speed = Number(args.speed);
    const out = (s: string) => process.stdout.write(`${s}\n`);
    const header = { version: rec.header.version, title: rec.header.title, recordedAt: rec.header.recordedAt, live: rec.header.live, events: rec.lines.length };
    if (args.json) out(JSON.stringify(header));
    else out(`${rec.header.live ? `Replay of a live run on ${rec.header.recordedAt.slice(0, 10)}` : 'Replay, hand-written'}: ${rec.header.title}`);

    const root = freshFixture();
    const d = await startDaemon({ root, quiet: true, handleSignals: Boolean(args.keep) });
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
