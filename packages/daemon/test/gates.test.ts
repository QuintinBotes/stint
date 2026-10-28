import { expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { phaseGates } from '../src/index';
import { makeApp, newTask, tempDir, withFixtureRepo } from './helpers';

function goldenResults(repo: string, passPowK: number): void {
  mkdirSync(join(repo, 'bench'), { recursive: true });
  writeFileSync(
    join(repo, 'bench', 'golden-results.json'),
    `${JSON.stringify({ version: 'stint.golden/1', replay: true, synthetic: true, k: 3, passAt1: 0.95, passPowK, cost: { usd: 0.4, inputTokens: 1, cachedTokens: 0, outputTokens: 1 }, tasks: [{ name: 'a' }, { name: 'b' }], createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

test('a repository with no golden results of its own, and not the demo fixture, says so', async () => {
  const tmp = tempDir();
  try {
    Bun.spawnSync(['git', 'init', '-q'], { cwd: tmp.dir });
    const { app } = await makeApp(tmp.dir);
    const empty = (await (await app.request('/api/phase-gates')).json()) as Awaited<ReturnType<typeof phaseGates>>;
    expect(empty.phase2.met).toBe(false);
    expect(empty.phase2.detail).toContain('No sample task results yet');
    expect(empty.golden).toBeNull();
  } finally {
    tmp.cleanup();
  }
});

test('phase 2 opens when the golden set passes pass^3 >= 80% with no tamper escapes, and a tampered merge closes it', async () => {
  await withFixtureRepo(async (repo) => {
    const { app, ws } = await makeApp(repo);
    const res = await app.request('/api/phase-gates');
    expect(res.status).toBe(200);
    // the demo fixture has no results of its own, so it shows Stint's golden set, measured on it, as the bench does
    const stint = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', '..', 'bench', 'golden-results.json'), 'utf8')) as { k: number; passPowK: number };
    const borrowed = (await res.json()) as Awaited<ReturnType<typeof phaseGates>>;
    expect(borrowed.golden).toMatchObject({ k: stint.k, passPowK: stint.passPowK });

    goldenResults(repo, 0.9);
    const open = await phaseGates(ws);
    expect(open.phase2).toMatchObject({ met: true, passPowK: 0.9, k: 3, tamperEscapes: 0 });
    expect(open.golden?.passAt1).toBe(0.95);

    const t = await ws.createTask(newTask);
    await ws.events(t.id).append({ task: t.id, run: 'r1', vendor: 'daemon', type: 'acceptance.tampered', payload: { run: 'r1', files: ['test/a.test.ts'] } });
    await ws.events(t.id).append({ task: t.id, vendor: 'daemon', type: 'merge.completed', payload: { commit: 'abc1234', into: 'main' } });
    const escaped = await phaseGates(ws);
    expect(escaped.phase2.met).toBe(false);
    expect(escaped.phase2.tamperEscapes).toBe(1);
  });
}, 60_000);

test('phase 3 opens when one risk tier has been shadow-approved for two weeks with no reverts', async () => {
  await withFixtureRepo(async (repo) => {
    const { ws } = await makeApp(repo);
    const t = await ws.createTask(newTask);
    const dir = await ws.taskDir(t.id);
    // shadow records carry their own times; write the two-week-old one as a raw log line
    const lines = (await Bun.file(join(dir, 'events.jsonl')).text()).trim().split('\n');
    const seq = lines.length + 1;
    const old = { id: '01M5WBQCB8GGGGGGGGGGGGGGGG', seq, ts: new Date(Date.now() - 15 * 86_400_000).toISOString(), task: t.id, vendor: 'daemon', type: 'autoapprove.shadow', payload: { tier: 'low', wouldApprove: true, humanDecision: 'approved' } };
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(old)}\n`);
    const nowLine = { ...old, id: '01M5WBQCB9GGGGGGGGGGGGGGGG', seq: seq + 1, ts: new Date().toISOString() };
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(nowLine)}\n`);

    const gates = await phaseGates(ws);
    expect(gates.phase3.met).toBe(true);
    expect(gates.phase3.tier).toBe('low');
    expect(gates.phase3.shadowDays).toBeGreaterThanOrEqual(14);
    expect(gates.phase3.reverts).toBe(0);
  });
}, 60_000);
