import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Adapter, DEFAULT_CONFIG } from '@stint-dev/core';
import { runsFromEvents } from '@stint-dev/core/node';
import { startDaemon } from '@stint-dev/daemon';
import { flowConfig, startFakeModels } from '../../../apps/web/e2e/flows/fakes';
import { tempDir, withFixtureRepo } from '../../core/test/fixture';
import { fakeModels } from '../../daemon/test/autopilot.fixtures';
import { fakeAdapter } from '../../daemon/test/helpers';
import { buildFix } from '../src/doctor';
import { fromBead } from '../src/tasks';

const stint = async (repo: string, ...args: string[]) => {
  const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'bin', 'stint'), ...args, '--repo', repo], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
};

test('stint list prints each task with its status, stint changes sends one back, and stint run --all starts every planned task', async () => {
  const models = startFakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(flowConfig(models.port)));
      const d = await startDaemon({ root: repo, quiet: true, adapters: [] });
      try {
        expect((await stint(repo, 'list')).stdout).toBe('No tasks yet. Make one with: stint new "<title>"\n');
        const a = await d.ws.createTask({ title: 'Add a health endpoint', goal: 'GET /health answers 200.', acceptance: ['GET /health answers 200'], testCommand: 'true' });
        const b = await d.ws.createTask({ title: 'Add a ready endpoint', goal: 'GET /ready answers 200.', acceptance: ['GET /ready answers 200'], testCommand: 'true' });

        // autopilot never ran on it, so it is sent back to wait for a person
        const sent = await stint(repo, 'changes', a.id, '--reason', 'Answer HEAD as well');
        expect(sent.stdout).toBe(`${a.id} is sent back and waits for you; what should change is the next run's ask.\n`);
        expect(await d.ws.readTask(a.id)).toMatchObject({ status: 'rejected', pendingAsk: 'Answer HEAD as well' });
        expect((await stint(repo, 'list')).stdout).toBe(`${a.id}  rejected           Add a health endpoint\n${b.id}  planned            Add a ready endpoint\n`);
        expect(JSON.parse((await stint(repo, 'list', '--json')).stdout).map((t: { id: string; status: string }) => [t.id, t.status])).toEqual([
          [a.id, 'rejected'],
          [b.id, 'planned'],
        ]);

        expect((await stint(repo, 'run', '--all')).stdout).toBe(`${b.id} on autopilot. Each stops at your approval.\n`);
        expect((await d.ws.events(b.id).read()).some((e) => e.type === 'autopilot.started')).toBe(true);
        expect((await d.ws.events(a.id).read()).some((e) => e.type === 'autopilot.started')).toBe(false);
        expect((await stint(repo, 'run', '--all', '--stop')).stdout).toBe('Every task is off autopilot.\n');
        const none = await stint(repo, 'run');
        expect([none.code, none.stderr]).toEqual([2, 'Name a task, or give --all for every planned task: stint run T-0001\n']);
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 120_000);

test('stint new --from-bead copies the title and description from bd show --json', () => {
  const tmp = tempDir();
  const path = process.env.PATH;
  try {
    const bin = join(tmp.dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'bd'), `#!/bin/sh\necho '[{"id":"bd-7","title":"Rate-limit webhooks","description":"Answer 429 per tenant."}]'\n`);
    chmodSync(join(bin, 'bd'), 0o755);
    process.env.PATH = `${bin}:${path}`;
    expect(fromBead('bd-7', tmp.dir)).toEqual({ title: 'Rate-limit webhooks', description: 'Answer 429 per tenant.' });
  } finally {
    process.env.PATH = path;
    tmp.cleanup();
  }
});

test('stint run --wait on a "Needs you" stop prints the daemon\'s reason as it is, then why each implementer could not build and the fix, and exits 3', async () => {
  const models = fakeModels();
  try {
    await withFixtureRepo(async (repo) => {
      const config = structuredClone(DEFAULT_CONFIG);
      config.hosts.ollama = { ...(config.hosts.ollama as NonNullable<typeof config.hosts.ollama>), baseURL: models.url, models: { fake: 'fake' } };
      config.routes.planner = ['ollama/fake'];
      config.routes.reviewer = ['ollama/fake'];
      config.prices['ollama/fake'] = { input: 0, cached: 0, output: 0 };
      config.autopilot = { implementers: ['muse-code', 'stint-agent'], maxHops: 1, parallel: 1 };
      mkdirSync(join(repo, '.stint'), { recursive: true });
      writeFileSync(join(repo, '.stint', 'config.json'), JSON.stringify(config));
      const missing: Adapter = { ...fakeAdapter('edit'), id: 'muse-code', available: async () => ({ ok: false, reason: 'the muse CLI is not installed' }) };
      // the Stint agent as a laptop without keys saw it: every host skipped or silent
      const silent: Adapter = {
        ...fakeAdapter('edit'),
        id: 'stint-agent',
        run: async (ctx) => {
          await ctx.emit({ type: 'provider.fallback', payload: { role: 'implementer', from: 'meta-api/muse-spark-1.3', to: 'ollama/muse-glimmer:30b-mlx', reason: 'META_API_KEY not set' } });
          await ctx.emit({ type: 'agent.message', payload: { text: 'The Stint agent stopped: no host in the chain could answer', stderr: true } });
          return { endedBy: 'failed', cost: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, usd: 0 } };
        },
      };
      const d = await startDaemon({ root: repo, quiet: true, adapters: [missing, silent] });
      try {
        const t = await d.ws.createTask({ title: 'Add a health endpoint', goal: 'GET /health answers 200.', acceptance: ['GET /health answers 200'], testCommand: 'true' });
        const r = await stint(repo, 'run', t.id, '--wait');
        const events = await d.ws.events(t.id).read();
        const stop = events.find((e) => e.type === 'autopilot.stopped')?.payload as { reason: string; needsYou: boolean };
        const last = runsFromEvents(events).filter((x) => x.adapter === 'stint-agent').at(-1);
        expect(stop.needsYou).toBe(true);
        expect(r.code).toBe(3);
        expect(r.stdout.split('\n').slice(1)).toEqual([
          `${t.id}: ${stop.reason}`,
          '  muse-code: the muse CLI is not installed',
          `  stint-agent ${last?.run} failed: The Stint agent stopped: no host in the chain could answer; it skipped meta-api/muse-spark-1.3 (META_API_KEY not set)`,
          `  fix: ${buildFix()}`,
          '',
        ]);
      } finally {
        await d.stop();
      }
    });
  } finally {
    models.stop();
  }
}, 120_000);
