import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countTokens, renderHandoff, taskBundle } from '@stint-dev/core/node';
import { DEFAULT_RECORDING, Replayer, gitOk } from '../src/index';
import { auth, makeApp, readSSE, tempDir, withFixtureRepo } from './helpers';

describe('replay', () => {
  test('Playing the hand-written recording at speed 0 leaves .stint/tasks/ with T-0040, T-0042, T-0043, a verified events.jsonl chain per task, and taskBundle(T-0042) with a killed r2 and a handoff of under 600 tokens', async () => {
    await withFixtureRepo(async (repo) => {
      const { ws, app } = await makeApp(repo);
      const r = new Replayer(ws);
      r.load(DEFAULT_RECORDING);
      const status = await r.play({ speed: 0 });
      expect(status.done).toBe(true);
      expect((await ws.listTasks()).map((t) => t.id)).toEqual(['T-0040', 'T-0042', 'T-0043']);
      for (const id of ['T-0040', 'T-0042', 'T-0043']) expect(await ws.events(id).verify()).toEqual({ ok: true });

      const b = await taskBundle(ws, 'T-0042');
      expect(b.runs.find((x) => x.run === 'r2')?.endedBy).toBe('killed');
      const h1 = await ws.handoffs('T-0042').read('h1');
      expect(h1?.from.endedBy).toBe('killed');
      expect(countTokens(renderHandoff(h1 as never))).toBeLessThan(600);
      expect(b.task.status).toBe('done');
      expect(b.verification?.passed).toBe(33);
      expect(b.review?.findings.map((f) => f.id)).toEqual(['F1', 'F2']);
      expect(b.cost.usd?.toFixed(2)).toBe('0.61');
      expect((await ws.decisions('T-0042').read()).map((d) => d.id)).toEqual(['D1', 'D2', 'D3']);
      expect((await ws.readTask('T-0040')).status).toBe('done');

      // the git effects are real: the packet names the commit the replay made, and main carries the trailers
      expect((await gitOk(repo, ['rev-parse', 'stint/T-0042~1'])).trim()).toBe(h1?.diffRef.head as string);
      expect(await gitOk(repo, ['log', '--format=%B', '-n', '3', 'main'])).toContain('Stint-Task: T-0042');
      const diff = (await (await app.request('/api/tasks/T-0042/diff?format=json')).json()) as Array<{ path: string }>;
      expect(diff.map((d) => d.path)).toContain('src/lib/limiter.ts');
    });
  }, 60_000);

  test('A client on /api/tasks/T-0042/stream receives the replayed events in order with correct seq', async () => {
    await withFixtureRepo(async (repo) => {
      const { app } = await makeApp(repo);
      const play = await app.request('/api/demo/play', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 0 }) });
      expect(play.status).toBe(202);
      let res: Response | null = null;
      for (let i = 0; i < 200; i++) {
        res = await app.request('/api/tasks/T-0042/stream');
        if (res.status === 200) break;
        await Bun.sleep(10);
      }
      const frames = await readSSE(res as Response, (f) => f.some((x) => x.event === 'task.status' && x.data.includes('"to":"done"')), 20_000);
      const seqs = frames.filter((f) => f.id).map((f) => Number(f.id));
      expect(seqs.length).toBeGreaterThan(50);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
      const types = frames.map((f) => f.event);
      expect(types.indexOf('handoff.created')).toBeGreaterThan(types.indexOf('run.started'));
      expect(frames.filter((f) => f.event !== 'heartbeat').every((f) => JSON.parse(f.data).payload.replay === true)).toBe(true);
      const health = (await (await app.request('/api/health')).json()) as { mode: string; replay: { live: boolean } };
      expect(health.mode).toBe('replay');
      expect(health.replay.live).toBe(false);
    });
  }, 60_000);

  test('pause: true lines stop the replay until continue', async () => {
    const tmp = tempDir();
    try {
      Bun.spawnSync(['git', '-C', tmp.dir, 'init', '-q']);
      Bun.spawnSync(['git', '-C', tmp.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init']);
      const { ws } = await makeApp(tmp.dir);
      const path = join(tmp.dir, 'r.jsonl');
      const header = { version: 'stint.recording/1', title: 'pause test', recordedAt: '2026-10-26T15:00:00Z', live: false, tasks: [{ id: 'T-0001', title: 'Pause', goal: 'g', acceptance: ['a'], testCommand: 'true' }] };
      const ev = (seq: number, type: string, payload: object, extra: object = {}) => ({ id: `01KAB3XQ7Z8M4N2P6R9S0T1V${seq}${seq}`, seq, ts: '2026-10-26T15:00:00Z', task: 'T-0001', type, payload, at: seq * 10, ...extra });
      const rows = [header, ev(1, 'task.created', { title: 'Pause', goal: 'g', acceptance: ['a'], testCommand: 'true' }), ev(2, 'agent.message', { text: 'before' }), ev(3, 'agent.message', { text: 'after' }, { pause: true })];
      writeFileSync(path, rows.map((l) => JSON.stringify(l)).join('\n'));
      const r = new Replayer(ws);
      r.load(path);
      const done = r.play({ speed: 100 });
      await Bun.sleep(150);
      expect(r.getStatus().paused).toBe(true);
      const texts = async () => (await ws.events('T-0001').read()).map((e) => (typeof e.payload.text === 'string' ? e.payload.text : e.type));
      expect(await texts()).toEqual(['task.created', 'before']);
      r.continue();
      await done;
      expect(await texts()).toEqual(['task.created', 'before', 'after']);
    } finally {
      tmp.cleanup();
    }
  });
});
