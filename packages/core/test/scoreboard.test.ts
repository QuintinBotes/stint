import { expect, test } from 'bun:test';
import type { StintEvent, Task } from '../src/index';
import { ALL_TAGS, scoreboard } from '../src/node';

let clock = Date.parse('2026-10-26T09:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();
const ev = (task: string, type: string, payload: Record<string, unknown>, extra: Partial<StintEvent> = {}) => ({ task, type, payload, ts: tick(), vendor: 'daemon', ...extra }) as unknown as StintEvent;

/** One implementer run: started, finished, and verified green or red. */
function run(task: string, n: number, adapter: string, model: string | null, green: boolean, usd: number | null): StintEvent[] {
  const r = `r${n}`;
  return [
    ev(task, 'run.started', { role: 'implementer', model, host: 'local-cli' }, { run: r, adapter }),
    ev(task, 'run.finished', { endedBy: 'completed', cost: { inputTokens: 1, cachedTokens: 0, outputTokens: 1, usd } }, { run: r, adapter }),
    ev(task, 'verification.ran', { status: green ? 'green' : 'red' }, { run: r }),
  ];
}
const task = (id: string, tags: string[]) => ({ id, tags }) as unknown as Task;

test('The scoreboard computes pass rate and cost per resolved task from runs', () => {
  const a = [...run('T-0001', 1, 'muse-code', 'muse-spark-1.3', false, 0.1), ...run('T-0001', 2, 'stint-agent', 'muse-spark-1.3', true, 0.05), ev('T-0001', 'merge.completed', { commit: 'a'.repeat(40) })];
  const b = [...run('T-0002', 1, 'stint-agent', 'muse-spark-1.3', true, 0.07), ev('T-0002', 'merge.completed', { commit: 'b'.repeat(40) }), ev('T-0002', 'outcome.reverted', { commit: 'c'.repeat(40) })];
  const c = [...run('T-0003', 1, 'stint-agent', 'muse-spark-1.3', true, null), ...run('T-0003', 2, 'muse-code', 'muse-spark-1.3', true, 0.2)];
  const rows = scoreboard([
    { task: task('T-0001', ['api']), events: a },
    { task: task('T-0002', ['api']), events: b },
    { task: task('T-0003', ['ui']), events: c },
  ]);
  const row = (tag: string, agent: string) => rows.find((r) => r.tag === tag && r.agent === agent);

  expect(row(ALL_TAGS, 'stint-agent')).toMatchObject({ runs: 3, attempts: 3, passed: 3, passRate: 1, pass3: true, resolved: 2, costPerResolved: 0.06, reverts: 1 });
  expect(row(ALL_TAGS, 'muse-code')).toMatchObject({ runs: 2, attempts: 2, passed: 1, passRate: 0.5, pass3: null, resolved: 0, costPerResolved: null });
  expect(row('api', 'stint-agent')).toMatchObject({ attempts: 2, passRate: 1, resolved: 2 });
  expect(row('api', 'muse-code')).toMatchObject({ attempts: 1, passRate: 0 });
  // an unpriced run on a resolved task makes its cost per task unknown, not zero
  const d = [...run('T-0004', 1, 'codex', null, true, null), ev('T-0004', 'merge.completed', { commit: 'd'.repeat(40) })];
  expect(scoreboard([{ task: task('T-0004', []), events: d }]).find((r) => r.agent === 'codex')?.costPerResolved).toBeNull();
});

test('pass^3 is false when one of the last three attempts failed, and an adopted run is not counted twice', () => {
  const t = [...run('T-0005', 1, 'muse-code', null, true, 0), ...run('T-0005', 2, 'muse-code', null, false, 0), ...run('T-0005', 3, 'muse-code', null, true, 0), ...run('T-0005', 4, 'muse-code', null, true, 0)];
  const adopted = [ev('T-0006', 'run.started', { role: 'implementer', model: null, adoptedFrom: 'T-0005 r4' }, { run: 'r1', adapter: 'muse-code' }), ev('T-0006', 'run.finished', { endedBy: 'completed', cost: { usd: 0 } }, { run: 'r1', adapter: 'muse-code' }), ev('T-0006', 'verification.ran', { status: 'green' }, { run: 'r1' })];
  const rows = scoreboard([
    { task: task('T-0005', []), events: t },
    { task: task('T-0006', []), events: adopted },
  ]);
  expect(rows.find((r) => r.tag === ALL_TAGS && r.agent === 'muse-code')).toMatchObject({ attempts: 4, passed: 3, pass3: false });
});
