import { expect, test } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '@stint-dev/core/node';
import { tempDir } from '../../core/test/fixture';

const bin = join(import.meta.dir, '..', 'bin', 'stint');
const ZONE = 'Africa/Johannesburg';
const cost = (usd: number | null) => ({ inputTokens: 1000, cachedTokens: 0, outputTokens: 100, usd, ...(usd === null ? { estimated: true } : {}) });

test('stint costs --by week prints each local Monday-to-Sunday week once, and says how many runs had no price', async () => {
  const { dir, cleanup } = tempDir('stint-cli-costs-');
  try {
    const ws = await Workspace.open(dir);
    const t = await ws.createTask({ id: 'T-0001', title: 'Week cost', goal: 'Count each run once.', acceptance: ['counted once'], testCommand: 'true', baseCommit: 'be1bee8d153659647701b8f5886f0a5c73cf276a' });
    const path = join(await ws.taskDir(t.id), 'events.jsonl');
    let seq = 1;
    // r1 ends on Sunday 23:30 in Johannesburg, r2 (priced) and r3 (killed, no usage) on Monday 00:10 and 00:20
    for (const [run, ended, usd] of [['r1', '2026-10-25T21:30:00Z', 0.1], ['r2', '2026-10-25T22:10:00Z', 0.2], ['r3', '2026-10-25T22:20:00Z', null]] as const) {
      for (const type of ['run.started', 'run.finished']) {
        seq += 1;
        const payload = type === 'run.started' ? { role: 'implementer', host: 'meta-api', model: 'muse-spark-1.3' } : { endedBy: usd === null ? 'killed' : 'completed', cost: cost(usd) };
        appendFileSync(path, `${JSON.stringify({ id: `01M5WBKEC0GGGGGGGGGGGG${String(seq).padStart(4, '0')}`, seq, ts: ended, task: t.id, run, adapter: 'stint-agent', vendor: 'meta', type, payload })}\n`);
      }
    }
    const env = { ...process.env, TZ: ZONE };
    const json = Bun.spawnSync(['bun', bin, 'costs', '--by', 'week', '--json', '--repo', dir], { stdout: 'pipe', stderr: 'pipe', env });
    expect(json.exitCode, json.stderr.toString()).toBe(0);
    expect(JSON.parse(json.stdout.toString())).toMatchObject([
      { key: '2026-10-19', usd: 0.1, runs: 1, unpriced: 0 },
      { key: '2026-10-26', usd: 0.2, runs: 2, unpriced: 1, estimated: true },
    ]);
    const text = Bun.spawnSync(['bun', bin, 'costs', '--by', 'week', '--repo', dir], { stdout: 'pipe', stderr: 'pipe', env });
    expect(text.exitCode, text.stderr.toString()).toBe(0);
    const lines = text.stdout.toString().trim().split('\n');
    expect(lines[0]).toEndWith('$0.10');
    expect(lines[1]).toStartWith('2026-10-26');
    expect(lines[1]).toEndWith('≈$0.20, 1 run unpriced');
  } finally {
    cleanup();
  }
});
