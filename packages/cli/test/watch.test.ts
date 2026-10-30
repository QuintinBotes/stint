import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { StintEvent } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, newTask, withFixtureRepo } from '../../daemon/test/helpers';
import { feed, render } from '../src/watch';

const STINT = join(import.meta.dir, '..', 'bin', 'stint');
// the daemon runs in this process, so the CLI is spawned without blocking it
async function stint(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(['bun', STINT, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}
let seq = 0;
const ev = (ts: string, type: string, run: string | undefined, adapter: string | undefined, payload: Record<string, unknown>) =>
  ({ id: `e${++seq}`, seq, ts: `2026-10-30T${ts}.000Z`, task: 'T-0042', run, adapter, vendor: 'meta', type, payload }) as unknown as StintEvent;

test('The feed says what happened to the task, a line per event, in the shapes of the 30 October live take', () => {
  // the feed prints local time; this test reads it in UTC
  const zone = process.env.TZ;
  process.env.TZ = 'UTC';
  const next = feed();
  const lines = [
    ev('09:50:40', 'run.started', 'r2', 'muse-code', { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' }),
    ev('09:50:52', 'agent.tool_call', 'r2', 'muse-code', { tool: 'bash', args: {} }),
    ev('09:50:58', 'file.changed', 'r2', undefined, { path: 'src/config.ts', added: 4, removed: 0 }),
    ev('09:51:21', 'run.finished', 'r2', 'muse-code', { endedBy: 'killed', model: 'muse-spark-1.3', inFlight: 'write_todos' }),
    ev('09:51:30', 'handoff.created', 'r2', undefined, { name: 'h1', tokens: 570, reason: 'killed' }),
    ev('09:51:30', 'handoff.created', 'r2', undefined, { name: 'h2', tokens: 281, reason: 'handed', to: { adapter: 'stint-agent', role: 'implementer' } }),
    ev('09:51:31', 'run.started', 'r3', 'stint-agent', { role: 'implementer', host: 'local-cli', handoffFrom: 'h1' }),
    ev('09:51:40', 'agent.tool_call', 'r3', 'stint-agent', { tool: 'read_file', args: { path: 'src/config.ts' } }),
    ev('09:54:02', 'verification.ran', 'r3', undefined, { status: 'green', passed: 31, failed: 0, tamper: null }),
    ev('09:54:05', 'run.finished', 'r3', 'stint-agent', { endedBy: 'completed', host: 'meta-api', model: 'muse-spark-1.3', cost: { usd: 0.0912 } }),
    ev('13:59:31', 'run.started', 'r5', 'openai-compatible', { role: 'reviewer', host: 'ollama', model: 'muse-glimmer:30b-mlx' }),
    ev('14:00:36', 'review.recorded', 'r5', 'openai-compatible', { verdict: 'approve', findings: 0, offline: true }),
    ev('14:00:37', 'run.finished', 'r5', 'openai-compatible', { endedBy: 'completed', host: 'ollama', model: 'muse-glimmer:30b-mlx', cost: { usd: 0 } }),
    ev('14:00:37', 'cost.recorded', undefined, undefined, { for: 'digest' }),
    ev('14:05:00', 'run.refused', 'r6', undefined, { code: 'dirty_tree', message: 'the main tree has uncommitted changes to tracked files' }),
    ev('14:09:24', 'merge.completed', undefined, undefined, { into: 'main', commit: '429ea9a44ae844d89140b27bdafb034d15addcc6' }),
  ]
    .map(next)
    .filter((l) => l !== null)
    .map((l) => render(l, false));
  expect(lines).toEqual([
    '09:50:40  r2   Muse Code on Muse Spark 1.3 started',
    '09:50:58  r2   src/config.ts +4 -0',
    '09:51:21  r2   ✗ Muse Code killed after 41 s, in the middle of write_todos',
    '09:51:30  r2   Packet h1: 570 tokens, built from the log and the diff',
    '09:51:30  r2   Packet h2 for Stint agent: 281 tokens',
    '09:51:31  r3   Stint agent started from packet h1, never the transcript',
    '09:51:40  r3   read_file src/config.ts',
    '09:54:02  r3   ✓ Tests run by Stint: 31 passed, tests unchanged, 0 failed',
    '09:54:05  r3   Stint agent on Muse Spark 1.3 finished in 2 min 34 s, $0.09',
    '13:59:31  r5   Muse Glimmer 30B on this machine reviews it',
    '14:00:36  r5   Review: approve, 0 findings, offline',
    '14:00:37  r5   Muse Glimmer 30B on this machine finished in 1 min 6 s, $0.00',
    '14:05:00  r6   ✗ Run refused: the main tree has uncommitted changes to tracked files',
    '14:09:24       ✓ Merged into main as 429ea9a',
  ]);
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

test('stint stop stops the run that is going, as Stop the run does, and says where the packet is', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('sleep'), id: 'muse-code' }] });
    try {
      const t = await d.ws.createTask(newTask);
      const none = await stint('stop', t.id, '--repo', repo);
      expect(none.err).toBe(`${t.id} has no run going\n`);
      expect(none.code).toBe(1);

      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      for (let i = 0; i < 200 && !(await d.ws.events(t.id).read()).some((e) => e.type === 'agent.tool_call'); i++) await Bun.sleep(25);
      const cli = await stint('stop', t.id, '--repo', repo);
      expect(cli.err).toBe('');
      expect(cli.code).toBe(0);
      expect(cli.out).toBe(`Stopped ${t.id} r1. Its packet is built from the log and the diff: stint packet ${t.id}\n`);
      const finished = (await d.ws.events(t.id).read()).find((e) => e.type === 'run.finished');
      expect(finished?.payload.endedBy).toBe('killed');
    } finally {
      for (let i = 0; i < 200 && !(await d.ws.events('T-0001').read()).some((e) => e.type === 'handoff.created'); i++) await Bun.sleep(25);
      await d.stop();
    }
  });
}, 60_000);

test('stint watch follows a task live: the run, its edit, its packet and the tests Stint runs', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
    const t = await d.ws.createTask(newTask);
    const watch = Bun.spawn(['bun', STINT, 'watch', t.id, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
    try {
      // the watcher reads the log, then follows the stream from its end
      await Bun.sleep(1500);
      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      const reader = watch.stdout.getReader();
      let out = '';
      // one read stays pending across the waits, so no chunk is dropped
      let pending = reader.read();
      const until = Date.now() + 40_000;
      while (!(out.includes('Tests run by Stint') && out.includes('Packet h1')) && Date.now() < until) {
        const got = await Promise.race([pending, Bun.sleep(500).then(() => null)]);
        if (!got) continue;
        if (got.done) break;
        out += new TextDecoder().decode(got.value);
        pending = reader.read();
      }
      expect(out).toMatch(/ r1 {3}Muse Code on .+ started\n/);
      expect(out).toContain('r1   write_file src/lib/limiter.ts');
      expect(out).toMatch(/r1 {3}Packet h1: \d+ tokens/);
      expect(out).toMatch(/r1 {3}[✓✗] Tests run by Stint: \d+ passed/);
    } finally {
      watch.kill();
      for (let i = 0; i < 400 && (await d.ws.readTask(t.id)).status === 'building'; i++) await Bun.sleep(25);
      await d.stop();
    }
  });
}, 60_000);
