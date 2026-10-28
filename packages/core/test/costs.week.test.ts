import { afterEach, expect, test } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Cost, Workspace, costs, localDay, weekOf } from '../src/node';
import { tempDir } from './fixture';

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

type Line = { run: string; type: string; ts: string; payload?: Record<string, unknown> };
const priced = (usd: number | null, extra: Partial<Cost> = {}): Cost => ({ inputTokens: 1000, cachedTokens: 0, outputTokens: 100, usd, ...extra });

/** A task whose log has these lines at these times, written as the daemon would have, so `ts` is the run's real clock. */
async function workspaceWith(lines: Line[]): Promise<{ ws: Workspace; dir: string; cleanup: () => void }> {
  const { dir, cleanup } = tempDir('stint-costs-week-');
  const ws = await Workspace.open(dir);
  const t = await ws.createTask({ id: 'T-0001', title: 'Week cost', goal: 'Count each run once, in its week.', acceptance: ['counted once'], testCommand: 'true', baseCommit: 'be1bee8d153659647701b8f5886f0a5c73cf276a' });
  const path = join(await ws.taskDir(t.id), 'events.jsonl');
  let seq = (await ws.events(t.id).read()).length;
  for (const l of lines) {
    seq += 1;
    const e = { id: `01M5WBKEC0GGGGGGGGGGGG${String(seq).padStart(4, '0')}`, seq, ts: l.ts, task: t.id, run: l.run, adapter: 'stint-agent', vendor: 'meta', type: l.type, payload: l.payload ?? {} };
    appendFileSync(path, `${JSON.stringify(e)}\n`);
  }
  return { ws, dir, cleanup };
}

const run = (r: string, started: string, ended: string | null, cost: Cost, endedBy = 'completed'): Line[] => [
  { run: r, type: 'run.started', ts: started, payload: { role: 'implementer', host: 'meta-api', model: 'muse-spark-1.3' } },
  ...(ended ? [{ run: r, type: 'run.finished', ts: ended, payload: { endedBy, cost } }] : []),
];

// Sunday 25 Oct to Monday 2 Nov 2026 around the week edges; Johannesburg is UTC+2 all year, New York moves from -4 to -5 on 1 Nov.
const EDGES = [
  ...run('r1', '2026-10-25T21:00:00Z', '2026-10-25T21:30:00Z', priced(0.1)),
  ...run('r2', '2026-10-25T21:50:00Z', '2026-10-25T22:10:00Z', priced(0.2)),
  ...run('r3', '2026-11-01T21:00:00Z', '2026-11-01T21:59:00Z', priced(0.4)),
  ...run('r4', '2026-11-01T21:30:00Z', '2026-11-01T22:00:00Z', priced(0.8)),
  ...run('r5', '2026-10-27T09:00:00Z', null, priced(9)),
];

test('A week runs from Monday 00:00 to Sunday 24:00 local time, named by its Monday', () => {
  process.env.TZ = 'Africa/Johannesburg';
  expect(weekOf('2026-10-25T21:59:59.999Z')).toBe('2026-10-19'); // Sunday 23:59:59.999 local
  expect(weekOf('2026-10-25T22:00:00Z')).toBe('2026-10-26'); // Monday 00:00 local
  expect(localDay('2026-10-25T22:00:00Z')).toBe('2026-10-26');
  process.env.TZ = 'UTC';
  expect(weekOf('2026-10-25T22:00:00Z')).toBe('2026-10-19');
  expect(weekOf('2026-11-01T23:59:59Z')).toBe('2026-10-26');
});

test('costs by week and day use the local zone; a run counts in the week it ended; a run still going counts nothing', async () => {
  const { ws, cleanup } = await workspaceWith(EDGES);
  try {
    process.env.TZ = 'Africa/Johannesburg';
    const weeks = (await costs(ws, { group: 'week' })).map((r) => [r.key, r.usd, r.runs]);
    // r2 started on Sunday 23:50 and ended on Monday 00:10: it is the new week's spend
    expect(weeks).toEqual([['2026-10-19', 0.1, 1], ['2026-10-26', 0.6, 2], ['2026-11-02', 0.8, 1]]);
    expect((await costs(ws, { group: 'day' })).map((r) => r.key)).toEqual(['2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02']);
    expect((await costs(ws, { group: 'day-host' })).map((r) => r.key)[1]).toBe('2026-10-26|meta-api');

    process.env.TZ = 'America/New_York';
    // the same log, six hours behind: every run ended on a Sunday afternoon or evening
    expect((await costs(ws, { group: 'week' })).map((r) => [r.key, r.usd, r.runs])).toEqual([['2026-10-19', 0.3, 2], ['2026-10-26', 1.2, 2]]);
  } finally {
    cleanup();
  }
});

test('A run with no price is counted as unpriced, not as $0; killed and failed runs that were priced count', async () => {
  const { ws, cleanup } = await workspaceWith([
    ...run('r1', '2026-10-27T09:00:00Z', '2026-10-27T09:10:00Z', priced(0.25)),
    ...run('r2', '2026-10-27T09:20:00Z', '2026-10-27T09:30:00Z', { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: null, estimated: true }, 'killed'),
    ...run('r3', '2026-10-27T09:40:00Z', '2026-10-27T09:50:00Z', priced(0.05), 'failed'),
    ...run('r4', '2026-10-27T10:00:00Z', '2026-10-27T10:10:00Z', priced(0.15), 'killed'),
  ]);
  try {
    const [week] = await costs(ws, { group: 'week' });
    expect(week).toMatchObject({ usd: 0.45, runs: 4, unpriced: 1, estimated: true });
    expect((await costs(ws, { group: 'task' }))[0]).toMatchObject({ usd: 0.45, unpriced: 1 });
  } finally {
    cleanup();
  }
});

test('A run counts once, however many events repeat its cost: the packet, the review and the plan add nothing', async () => {
  const { ws, cleanup } = await workspaceWith([
    { run: 'r1', type: 'run.started', ts: '2026-10-27T09:00:00Z', payload: { role: 'planner', host: 'meta-api', model: 'muse-wonder-1.0' } },
    { run: 'r1', type: 'run.finished', ts: '2026-10-27T09:01:00Z', payload: { endedBy: 'completed', cost: priced(0.05), plan: { cost: priced(0.05) } } },
    ...run('r2', '2026-10-27T09:10:00Z', '2026-10-27T09:20:00Z', priced(0.3)),
    { run: 'r2', type: 'handoff.created', ts: '2026-10-27T09:21:00Z', payload: { packet: { cost: priced(0.3) } } },
    { run: 'r3', type: 'run.started', ts: '2026-10-27T09:30:00Z', payload: { role: 'reviewer', host: 'ollama', model: 'muse-glimmer:30b-mlx' } },
    { run: 'r3', type: 'run.finished', ts: '2026-10-27T09:31:00Z', payload: { endedBy: 'completed', cost: priced(0) } },
    { run: 'r3', type: 'review.recorded', ts: '2026-10-27T09:31:01Z', payload: { review: { cost: priced(0) } } },
  ]);
  try {
    const sum = (rows: Array<{ usd: number | null }>) => Math.round(rows.reduce((s, r) => s + (r.usd ?? 0), 0) * 10_000) / 10_000;
    for (const group of ['task', 'run', 'day', 'week', 'host', 'model', 'day-host'] as const) {
      const rows = await costs(ws, { group });
      expect([group, sum(rows), rows.reduce((s, r) => s + r.runs, 0)]).toEqual([group, 0.35, 3]);
    }
  } finally {
    cleanup();
  }
});
