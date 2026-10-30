import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, DEFAULT_CONFIG } from '@stint-dev/core';
import { startDaemon } from '@stint-dev/daemon';
import { fakeAdapter, withFixtureRepo } from '../../daemon/test/helpers';

const STINT = join(import.meta.dir, '..', 'bin', 'stint');

test('stint review --host ollama reviews the verified change on this machine and prints the verdict', async () => {
  const model = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/tags') return Response.json({ models: [{ name: 'glimmer', model: 'glimmer' }] });
      if (path === '/api/chat') return Response.json({ message: { content: JSON.stringify({ version: 'stint.review/1', verdict: 'approve', summary: 'The limiter reads its limit from config.', findings: [], blockers: [] }) }, prompt_eval_count: 100, eval_count: 20 });
      return new Response('no', { status: 404 });
    },
  });
  await withFixtureRepo(async (repo) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<Config['hosts']['ollama']>), baseURL: `http://127.0.0.1:${model.port}/v1`, models: { glimmer: 'glimmer' } };
    config.routes.reviewer = ['ollama/glimmer'];
    config.prices['ollama/glimmer'] = { input: 0, cached: 0, output: 0 };
    mkdirSync(join(repo, '.stint'), { recursive: true });
    writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
    const d = await startDaemon({ root: repo, quiet: true, adapters: [{ ...fakeAdapter('edit'), id: 'muse-code' }] });
    try {
      const t = await d.ws.createTask({ title: 'Rate-limit incoming webhooks', goal: 'Answer 429 over the limit.', acceptance: ['429'], testCommand: 'true' });
      await fetch(`${d.url}/api/tasks/${t.id}/assign`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ adapter: 'muse-code', role: 'implementer' }) });
      for (let i = 0; i < 600 && (await d.ws.readTask(t.id)).status !== 'reviewing'; i++) await Bun.sleep(50);
      // the daemon runs in this process, so the CLI is spawned without blocking it
      const cli = Bun.spawn(['bun', STINT, 'review', t.id, '--host', 'ollama', '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
      const [out, err] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
      expect(err).toBe('');
      expect(await cli.exited).toBe(0);
      expect(out).toBe(`${t.id} reviewed by glimmer on this machine, $0.00: approve, 0 findings\nNo actionable findings.\n`);
    } finally {
      await d.stop();
    }
  });
  model.stop(true);
}, 60_000);
