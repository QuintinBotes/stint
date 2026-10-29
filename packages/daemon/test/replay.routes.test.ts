import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, post, tempDir } from './helpers';

test('R-006 Req 3: POST /api/demo/pause holds the replay before its next event, and POST /api/demo/continue plays the rest', async () => {
  const tmp = tempDir();
  try {
    Bun.spawnSync(['git', '-C', tmp.dir, 'init', '-q']);
    Bun.spawnSync(['git', '-C', tmp.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const { app, ws } = await makeApp(tmp.dir);
    const path = join(tmp.dir, 'r.jsonl');
    const header = { version: 'stint.recording/1', title: 'route test', recordedAt: '2026-10-26T15:00:00Z', live: false, tasks: [{ id: 'T-0001', title: 'Pause', goal: 'g', acceptance: ['a'], testCommand: 'true' }] };
    const ev = (seq: number, type: string, payload: object, at: number) => ({ id: `01KAB3XQ7Z8M4N2P6R9S0T1V${seq}${seq}`, seq, ts: '2026-10-26T15:00:00Z', task: 'T-0001', type, payload, at });
    const rows = [header, ev(1, 'task.created', { title: 'Pause', goal: 'g', acceptance: ['a'], testCommand: 'true' }, 0), ev(2, 'agent.message', { text: 'before' }, 600), ev(3, 'agent.message', { text: 'after' }, 700)];
    writeFileSync(path, rows.map((l) => JSON.stringify(l)).join('\n'));
    const texts = async () => ((await ws.listTasks()).length ? (await ws.events('T-0001').read()).map((e) => (typeof e.payload.text === 'string' ? e.payload.text : e.type)) : []);
    const status = async () => (await (await app.request('/api/demo/status')).json()) as { playing: boolean; paused: boolean; done: boolean };

    expect((await post(app, '/api/demo/play', { path, speed: 1 })).status).toBe(202);
    for (let i = 0; i < 100 && (await texts()).length === 0; i++) await Bun.sleep(10);
    expect(((await (await post(app, '/api/demo/pause', {})).json()) as { paused: boolean }).paused).toBe(true);
    await Bun.sleep(900);
    expect(await texts()).toEqual(['task.created']);
    expect(await status()).toMatchObject({ playing: true, paused: true, done: false });

    expect(((await (await post(app, '/api/demo/continue', {})).json()) as { paused: boolean }).paused).toBe(false);
    for (let i = 0; i < 200 && !(await status()).done; i++) await Bun.sleep(10);
    expect(await texts()).toEqual(['task.created', 'before', 'after']);
    expect(await status()).toMatchObject({ playing: false, paused: false, done: true });
  } finally {
    tmp.cleanup();
  }
}, 30_000);
