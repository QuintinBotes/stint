import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, newTask, withFixtureRepo } from '../../daemon/test/helpers';

test('stint hand T-0042 stint-agent --ask on a fake adapter creates handoffs/h1.json, emits handoff.created then run.started with handoffFrom h1', async () => {
  await withFixtureRepo(async (repo) => {
    const next = { ...fakeAdapter('edit'), id: 'stint-agent' };
    const d = await startDaemon({ root: repo, quiet: true, adapters: [next] });
    try {
      const t = await d.ws.createTask(newTask);
      // a run that ended before this daemon could build its packet
      const ev = d.ws.events(t.id);
      await ev.append({ task: t.id, run: 'r1', adapter: 'muse-code', vendor: 'meta', type: 'run.started', payload: { role: 'implementer', model: 'muse-spark-1.3', host: 'local-cli' } });
      await ev.append({ task: t.id, run: 'r1', adapter: 'muse-code', vendor: 'meta', type: 'run.finished', payload: { endedBy: 'killed', inFlight: 'write_file', cost: { inputTokens: 10, cachedTokens: 0, outputTokens: 1, usd: 0 } } });
      const cli = Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), 'hand', t.id, 'stint-agent', '--ask', 'Check the limiter first.', '--repo', repo, '--json'], { stdout: 'pipe', stderr: 'pipe' });
      const out = await new Response(cli.stdout).text();
      expect(await cli.exited).toBe(0);
      expect(JSON.parse(out)).toMatchObject({ packet: 'h1', run: 'r2' });
      expect(existsSync(join(await d.ws.taskDir(t.id), 'handoffs', 'h1.json'))).toBe(true);
      const types = (await ev.read()).map((e) => e.type);
      expect(types.indexOf('handoff.created')).toBeLessThan(types.indexOf('run.started', 2));
      const started = (await ev.read()).filter((e) => e.type === 'run.started').at(-1);
      expect(started?.payload.handoffFrom).toBe('h1');
      for (let i = 0; i < 200 && next.seen.length === 0; i++) await Bun.sleep(25);
      const prompt = await Bun.file(next.seen[0]?.promptPath as string).text();
      expect(prompt).toContain('Check the limiter first.');
      expect(prompt).toContain('In-flight step unknown: write_file');
    } finally {
      // let the handed run finish verifying before the fixture copy goes away
      for (let i = 0; i < 400 && (await d.ws.readTask('T-0001')).status !== 'reviewing'; i++) await Bun.sleep(25);
      await d.stop();
    }
  });
}, 60_000);

test('stint packet prints the packet and its token count', async () => {
  await withFixtureRepo(async (repo) => {
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
    try {
      const t = await d.ws.createTask(newTask);
      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      for (let i = 0; i < 600 && (await d.ws.handoffs(t.id).names()).length === 0; i++) await Bun.sleep(50);
      const cli = Bun.spawnSync(['bun', join(import.meta.dir, '..', 'bin', 'stint'), 'packet', t.id, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
      expect(cli.exitCode).toBe(0);
      expect(cli.stdout.toString()).toContain('## Ask of next');
      expect(cli.stderr.toString()).toMatch(/^\d+ tokens, \d+ bytes, sha256:/);
    } finally {
      await d.stop();
    }
  });
}, 60_000);
